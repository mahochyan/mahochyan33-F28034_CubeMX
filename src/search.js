/* search.js — global search across pins / functions / registers / wizards,
 * including Chinese keywords (R1 §12). Selecting a result locates the pin on
 * the chip, syncs the tree/detail, or opens the matching wizard.
 */
(function () {
  let items = [];
  let activeIdx = -1;
  let debounce = null;
  let inputEl, panelEl;

  /* Chinese keyword -> canonical function / action (R1 §12). */
  const CN_MAP = [
    [/输出低|置低|拉低/, { fn: null, action: 'gpio_out_low', label: 'GPIO 输出低' }],
    [/输出高|置高|拉高/, { fn: null, action: 'gpio_out_high', label: 'GPIO 输出高' }],
    [/上拉/, { fn: null, action: 'gpio_pullup', label: '内部上拉' }],
    [/禁用.*上拉|去.*上拉/, { fn: null, action: 'gpio_no_pullup', label: '禁用内部上拉' }],
    [/死区/, { fn: null, wizard: 'epwm_complementary', label: 'ePWM 死区 (Dead Band)' }],
    [/互补/, { fn: null, wizard: 'epwm_complementary', label: 'ePWM 互补输出' }],
    [/看门狗|喂狗/, { fn: null, wizard: 'watchdog', label: '看门狗' }],
    [/时钟|60m|pll|锁相环/, { fn: null, wizard: 'system_clock', label: '系统时钟 60MHz PLL' }],
    [/定时|中断|20us|5ms/, { fn: null, wizard: 'timer_interrupt', label: 'CPU Timer 中断' }],
    [/采样/, { fn: null, wizard: 'adc_soc', label: 'ADC 采样' }],
    [/跳闸|保护|trip|封锁|过流/, { fn: null, wizard: 'tripzone_ost', label: 'Trip Zone 一次性封锁' }],
  ];

  /* Register symbol -> friendly label (for register search). */
  const REG_LABELS = {
    GPACLEAR: 'GPIO A 清零寄存器', GPASET: 'GPIO A 置位寄存器', GPADAT: 'GPIO A 数据寄存器',
    GPAMUX1: 'GPIO A MUX1', GPAMUX2: 'GPIO A MUX2', GPBMUX1: 'GPIO B MUX1',
    GPADIR: 'GPIO A 方向', GPAPUD: 'GPIO A 上拉禁用', TBPRD: 'ePWM 周期', CMPA: 'ePWM 比较 A',
    DBRED: '死区上升沿', DBFED: '死区下降沿', TZCTL: 'Trip 动作', TZSEL: 'Trip 源选择',
    PLLCR: 'PLL 控制', PLLSTS: 'PLL 状态', PCLKCR0: '外设时钟 0', PCLKCR1: '外设时钟 1',
    WDCR: '看门狗控制', PIEIER1: 'PIE 中断使能 1', ADCSOC0CTL: 'ADC SOC0 控制',
  };

  function init() {
    inputEl = document.getElementById('globalSearch');
    panelEl = document.getElementById('searchPanel');

    inputEl.addEventListener('input', () => {
      clearTimeout(debounce);
      const q = inputEl.value.trim();
      if (!q) { hide(); return; }
      debounce = setTimeout(() => run(q), 160);
    });

    inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { hide(); inputEl.blur(); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
      else if (e.key === 'Enter') { e.preventDefault(); if (activeIdx >= 0 && items[activeIdx]) choose(items[activeIdx]); }
    });

    document.addEventListener('click', (e) => {
      if (!panelEl.contains(e.target) && e.target !== inputEl) hide();
    });
  }

  function run(q) {
    const local = localResults(q);
    items = dedup(local);
    activeIdx = items.length ? 0 : -1;
    render(q);
  }

  function localResults(q) {
    const ql = q.toLowerCase();
    const out = [];
    // Chinese keyword map
    CN_MAP.forEach(([re, meta]) => {
      if (re.test(ql)) {
        out.push({ kind: meta.wizard ? 'wizard' : 'action', label: meta.label,
                   wizard: meta.wizard, action: meta.action, fn: meta.fn });
      }
    });
    // register symbols
    Object.keys(REG_LABELS).forEach(sym => {
      if (sym.toLowerCase().includes(ql)) {
        out.push({ kind: 'register', label: `${sym} — ${REG_LABELS[sym]}`, register: sym });
      }
    });
    Object.values(Store.pinmux?.pins || {}).forEach(def => {
      const pinMatch = String(def.physical_pin) === ql ||
        `pin${def.physical_pin}`.toLowerCase().includes(ql) ||
        String(def.primary_signal || '').toLowerCase().includes(ql);
      if (pinMatch) {
        out.push({
          kind: 'pin',
          physical_pin: def.physical_pin,
          signal: def.primary_signal,
          configurable: !!def.configurable,
        });
      }
      (def.mux_options || []).forEach(option => {
        if (String(option.function).toLowerCase().includes(ql)) {
          out.push({
            kind: 'mux',
            physical_pin: def.physical_pin,
            signal: def.primary_signal,
            function: option.function,
            mux: option.mux,
            configurable: !!def.configurable,
          });
        }
      });
    });
    // wizard titles
    if (window.Wizard && Store.device) {
      // cheap: match against known wizard titles via CN label list already covered.
    }
    return out;
  }

  function dedup(arr) {
    const seen = new Set();
    return arr.filter(it => {
      const key = `${it.kind}|${it.physical_pin || ''}|${it.function || ''}|${it.label || ''}|${it.register || ''}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 80);
  }

  function render(q) {
    if (!items.length) {
      panelEl.innerHTML = `<div class="search-empty">没有匹配 “${esc(q)}” 的引脚 / 功能 / 寄存器 / 向导</div>`;
      panelEl.classList.remove('hidden');
      return;
    }
    panelEl.innerHTML = items.map((it, i) => {
      let body;
      if (it.kind === 'pin' || it.kind === 'mux') {
        body = `<span class="pinno">#${it.physical_pin}</span>
          <span class="sig">${esc(it.signal)}</span>
          ${it.function ? `<span class="fn">${esc(it.function)}${it.mux != null ? ' · MUX' + it.mux : ''}</span>` : ''}
          <span class="kind">${it.configurable ? (it.kind === 'mux' ? '复用功能' : '引脚') : '固定脚'}</span>`;
      } else if (it.kind === 'wizard') {
        body = `<span class="kind-badge k-wiz">向导</span><span class="sig">${esc(it.label)}</span>`;
      } else if (it.kind === 'register') {
        body = `<span class="kind-badge k-reg">寄存器</span><span class="sig mono">${esc(it.label)}</span>`;
      } else {
        body = `<span class="kind-badge k-act">操作</span><span class="sig">${esc(it.label)}</span>`;
      }
      return `<div class="search-item ${i === activeIdx ? 'active' : ''}" data-i="${i}">${body}</div>`;
    }).join('');
    panelEl.classList.remove('hidden');
    panelEl.querySelectorAll('.search-item').forEach(row => {
      row.addEventListener('click', () => choose(items[parseInt(row.getAttribute('data-i'), 10)]));
      row.addEventListener('mouseenter', () => {
        activeIdx = parseInt(row.getAttribute('data-i'), 10);
        markActive();
      });
    });
  }

  function move(d) {
    if (!items.length) return;
    activeIdx = (activeIdx + d + items.length) % items.length;
    markActive();
    const el = panelEl.querySelector('.search-item.active');
    if (el) el.scrollIntoView({ block: 'nearest' });
  }
  function markActive() {
    panelEl.querySelectorAll('.search-item').forEach((row, i) => {
      row.classList.toggle('active', i === activeIdx);
    });
  }

  function choose(it) {
    hide();
    if (it.kind === 'wizard' && it.wizard) {
      activateMidTab('tree');
      window.setStatus(`${it.label}：请在功能树选择对应功能后使用 inline 阶梯向导`);
      return;
    }
    if (it.kind === 'register') {
      window.setStatus(`寄存器：${it.label}（在「寄存器」页选中对应引脚查看位域）`);
      return;
    }
    if (it.kind === 'action') {
      window.setStatus(it.label + '：请先在芯片图选择 GPIO 引脚，再从功能树打开 inline 向导');
      activateMidTab('tree');
      return;
    }
    // pin / mux
    inputEl.value = it.function || it.signal;
    Store.selectPin(it.physical_pin);
    Chip.focusPin(it.physical_pin);
    if (it.function && window.Tree) Tree.open(it.function, 'tree', it.physical_pin);
    window.setStatus(`定位：pin ${it.physical_pin} ${it.signal}${it.function ? ' · ' + it.function : ''}`);
  }

  function activateMidTab(name) {
    const pane = document.getElementById('pane-mid');
    if (!pane) return;
    pane.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b.getAttribute('data-tab') === name));
    pane.querySelectorAll('.tab-page').forEach(pg => pg.classList.toggle('active', pg.id === 'tab-' + name));
  }

  function hide() { panelEl.classList.add('hidden'); items = []; activeIdx = -1; }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  window.Search = { init };
})();
