const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

global.DeterministicJSON = require('../src/core/deterministic_json.js');
global.ConstraintChecker = require('../src/core/constraint_checker.js');
const Project = require('../src/core/project_config.js');
const Codegen = require('../src/core/codegen.js');
const Zip = require('../src/core/export_zip.js');

const root = path.resolve(__dirname, '..');
const pinmux = JSON.parse(fs.readFileSync(
  path.join(root, 'src/devices/TMS320F28034/pinmux.json'), 'utf8'));
const family = JSON.parse(fs.readFileSync(
  path.join(root, 'src/devices/TMS320F28034/family.json'), 'utf8'));

function index() {
  const result = {};
  Object.values(pinmux.pins).forEach(def => {
    (def.mux_options || []).forEach(option => {
      (result[option.function] ||= []).push({
        physical_pin: def.physical_pin,
        mux: option.mux,
        type: option.type,
        signal_verified: option.signal_verified,
        mux_value_verified: option.mux_value_verified,
        pin_config_supported: option.pin_config_supported,
        peripheral_init_supported: option.peripheral_init_supported,
      });
    });
  });
  return result;
}

const reverseIndex = index();

function pwmProject(extraDraft = {}) {
  const blank = Project.createEmptyProject();
  const editor = {
    source: 'tree',
    functionId: 'EPWM1A',
    candidatePins: reverseIndex.EPWM1A,
    selectedPin: 69,
    status: 'editing',
    draft: {
      selectedPin: 69,
      mode: 'complementary',
      frequency_hz: 100000,
      count_mode: 'up_down',
      duty: 0.5,
      aq_profile: 'set_cau_clear_cad',
      red_ns: 200,
      fed_ns: 200,
      trip_enabled: true,
      trip_source: 'TZ1',
      trip_mode: 'one_shot',
      ...extraDraft,
    },
  };
  const plan = Project.buildCommitPlan({
    project: blank, editor, pinmux, reverseIndex,
  });
  assert.equal(plan.ok, true, plan.errors?.join('; '));
  return Project.applyAtomically(blank, plan);
}

function parseStoredZip(bytes) {
  const decoder = new TextDecoder();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const files = {};
  let offset = 0;
  while (view.getUint32(offset, true) === 0x04034B50) {
    const size = view.getUint32(offset + 18, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const name = decoder.decode(bytes.slice(nameStart, nameStart + nameLength));
    files[name] = decoder.decode(bytes.slice(dataStart, dataStart + size));
    offset = dataStart + size;
  }
  return files;
}

test('every generated source carries the mandatory safety header', () => {
  const result = Codegen.generateProject(pwmProject(), { pinmux, family });
  for (const [name, content] of Object.entries(result.files)) {
    if (!/\.[ch]$/.test(name)) continue;
    assert.match(content, /LOGIC TEST ONLY/);
    assert.match(content, /NOT APPROVED FOR POWER-STAGE ENABLE/);
    assert.match(content, /给初学者/);
    assert.match(content, /禁止据此直接开启功率级/);
  }
});

test('PWM release verifies trip and follows the safe release sequence', () => {
  const result = Codegen.generateProject(pwmProject(), { pinmux, family });
  const code = result.files['pwm_init.c'];
  const order = [
    'GpioDataRegs.GPADAT.bit.GPIO12 == 0U',
    'AQCSFRC.bit.CSFA = 1U',
    'TBCLKSYNC = 0U',
    'TBCTR = 0U',
    'TBPHS.half.TBPHS = 0U',
    'TZCLR.bit.INT = 1U',
    'TZCLR.bit.CBC = 1U',
    'TZCLR.bit.OST = 1U',
    'TBCLKSYNC = 1U',
    'AQCSFRC.bit.CSFA = 0U',
  ];
  let previous = -1;
  const release = code.slice(code.indexOf('Uint16 EPWM1_ReleaseClamp'));
  for (const token of order) {
    const index = release.indexOf(token);
    assert.ok(index > previous, `${token} is out of order`);
    previous = index;
  }
  assert.match(code, /TBCLK 驱动 TBCTR 计数/);
  assert.match(release, /第 1 步：先读硬件 Trip 输入/);
  assert.match(release, /第 6 步：先恢复时间基准/);
  assert.match(release, /0 表示已成功放开钳位/);
});

test('clock generation includes PLLLOCKPRD, MCLK checks and timeout without ESTOP0', () => {
  const project = Project.createEmptyProject();
  project.system_clock = { mode: 'generated', target_mhz: 60, sysclk_hz: 60000000 };
  const result = Codegen.generateProject(project, { pinmux, family });
  const code = result.files['system_clock_init.c'];
  assert.match(code, /PLLLOCKPRD = 0xFFFFU/);
  assert.ok((code.match(/MCLKSTS/g) || []).length >= 3);
  assert.match(code, /lock_wait < 1000000UL/);
  assert.doesNotMatch(code, /ESTOP0/);
  assert.match(code, /等待 PLL 锁定/);
  assert.match(code, /返回值：0=成功/);
});

test('timer uses safe TSS/TRB/TIE ordering and never changes global interrupt state', () => {
  const project = Project.createEmptyProject();
  project.timers.TIMER0 = { period_us: 1000, start_immediately: true };
  const result = Codegen.generateProject(project, { pinmux, family });
  const code = result.files['timer_interrupt_init.c'];
  assert.ok(code.indexOf('TSS = 1U') < code.indexOf('TIE = 0U'));
  assert.ok(code.indexOf('PRD.all') < code.indexOf('TRB = 1U'));
  assert.ok(code.indexOf('TIE = 1U') < code.lastIndexOf('TSS = 0U'));
  assert.doesNotMatch(code, /\b(DINT|EINT|ERTM)\b/);
  assert.match(code, /先停止计数器并关闭其中断/);
  assert.match(code, /必须应答 PIE 第 1 组/);
});

test('ADC comments explain SOC, trigger and sample window to beginners', () => {
  const project = Project.createEmptyProject();
  project.adc = {
    soc: 0,
    channel: 'ADCINA0',
    trigger: 'SOFTWARE',
    acqps: 14,
  };
  const result = Codegen.generateProject(project, { pinmux, family });
  const code = result.files['adc_init.c'];
  assert.match(code, /SOC（Start Of Conversion/);
  assert.match(code, /SOC0 采样 ADCINA0/);
  assert.match(code, /由 SOFTWARE 启动转换/);
  assert.match(code, /采样窗口为 15 个 ADC 时钟周期/);
});

test('SCLA pinmux-only project does not generate ADC code', () => {
  const project = Project.createEmptyProject();
  const option = pinmux.pins['3'].mux_options.find(item => item.function === 'SCLA');
  project.pins['3'] = {
    physical_pin: 3,
    signal: pinmux.pins['3'].primary_signal,
    gpio_num: pinmux.pins['3'].gpio_num,
    mux: option.mux,
    function: option.function,
    type: option.type,
    signal_verified: option.signal_verified,
    mux_value_verified: option.mux_value_verified,
    pin_config_supported: option.pin_config_supported,
    peripheral_init_supported: option.peripheral_init_supported,
    generator_profile: option.generator_profile,
  };
  const result = Codegen.generateProject(project, { pinmux, family, activeModule: 'SCLA' });
  assert.match(result.files['pinmux_init.c'], /Pin3：GPIO33 切换为 SCLA/);
  assert.match(result.files['pinmux_init.c'], /MUX 决定/);
  assert.match(result.files['pinmux_init.c'], /PUD=1 是禁用内部上拉/);
  assert.equal(result.files['adc_init.c'], undefined);
  assert.ok(result.findings.some(item => item.rule === 'PINMUX_ONLY'));
});

test('ZIP entries are byte-identical to preview and ZIP is deterministic', () => {
  const result = Codegen.generateProject(pwmProject(), { pinmux, family });
  const first = Zip.createProjectZipBytes(result.files);
  const second = Zip.createProjectZipBytes(result.files);
  assert.deepEqual(first, second);
  const extracted = parseStoredZip(first);
  assert.deepEqual(extracted, result.files);
});
