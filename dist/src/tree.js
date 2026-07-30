/* R3 function tree with one inline accordion editor. */
(function () {
  const GROUPS = [
    ['epwm', 'ePWM'], ['tripzone', 'Trip Zone'], ['i2c', 'I²C'],
    ['gpio', 'GPIO'], ['adc', 'ADC'], ['spi', 'SPI'], ['sci', 'SCI'],
    ['eqep', 'eQEP'], ['ecap', 'eCAP'], ['clock', '时钟 / 同步'],
    ['comparator', '比较器'], ['lin', 'LIN'], ['can', 'eCAN'],
    ['hrcap', 'HRCAP'], ['non_mux', '非 MUX'], ['other', '其他'],
  ];
  const itemByFunction = new Map();
  let rootEl = null;
  let pinFilter = null;

  function esc(value) {
    return String(value).replace(/[&<>"]/g, char =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char]));
  }

  function configuredText(functionName) {
    const pins = Store.assignedList().filter(pin => pin.function === functionName);
    if (!pins.length) return '';
    const modules = [...new Set(pins.map(pin => pin.module).filter(Boolean))];
    if (modules.length) {
      const module = Store.project.pwm_modules[modules[0]];
      if (module) return `已配置 · Pin${[module.pin_a, module.pin_b].filter(x => x != null).join('/')}`;
    }
    return `已配置 · Pin${pins.map(pin => pin.physical_pin).join('/')}`;
  }

  function build(root) {
    rootEl = root;
    itemByFunction.clear();
    const buckets = {};
    Object.entries(Store.reverseIndex || {}).forEach(([name, entries]) => {
      const type = entries[0]?.type || 'other';
      (buckets[type] = buckets[type] || []).push({ name, entries });
    });
    root.innerHTML = '';
    GROUPS.forEach(([type, title]) => {
      const items = buckets[type];
      if (!items?.length) return;
      items.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
      const group = document.createElement('details');
      group.className = 'function-group';
      const summary = document.createElement('summary');
      summary.innerHTML = `<span>${esc(title)}</span><span class="count">${items.length}</span>`;
      group.appendChild(summary);
      items.forEach(item => {
        const node = document.createElement('div');
        node.className = 'function-node';
        node.dataset.function = item.name;
        node.innerHTML = `
          <button type="button" class="function-row">
            <span class="fname">${esc(item.name)}</span>
            <span class="npins">${item.entries.length}脚</span>
            <span class="configured-badge"></span>
          </button>
          <div class="inline-editor" hidden></div>`;
        node.querySelector('.function-row').addEventListener('click', () => {
          const fromChip = pinFilter && pinFilter.functions.includes(item.name);
          open(item.name, fromChip ? 'chip' : 'tree', fromChip ? pinFilter.pin : null);
        });
        group.appendChild(node);
        itemByFunction.set(item.name, node);
      });
      root.appendChild(group);
    });
    repaint();
  }

  function open(functionName, source, selectedPin = null) {
    const node = itemByFunction.get(functionName);
    if (!node) return;
    const ok = Store.beginDraft({ source, functionId: functionName, selectedPin });
    if (!ok) return;
    reveal(functionName);
    Wizard.mountInline(node.querySelector('.inline-editor'));
    repaint();
  }

  function closeEditors() {
    itemByFunction.forEach(node => {
      node.classList.remove('editing');
      const editor = node.querySelector('.inline-editor');
      editor.hidden = true;
      editor.innerHTML = '';
    });
  }

  function repaint() {
    itemByFunction.forEach((node, fn) => {
      const badge = node.querySelector('.configured-badge');
      const configured = configuredText(fn);
      badge.textContent = configured;
      badge.classList.toggle('visible', !!configured);
      const editing = Store.activeEditor.status === 'editing' &&
        Store.activeEditor.functionId === fn;
      node.classList.toggle('editing', editing);
      if (!editing) {
        const editor = node.querySelector('.inline-editor');
        editor.hidden = true;
      }
      if (pinFilter) {
        const allowed = pinFilter.functions.includes(fn);
        node.classList.toggle('pin-filter-hidden', !allowed);
      } else {
        node.classList.remove('pin-filter-hidden');
      }
    });
  }

  function reveal(functionName) {
    const node = itemByFunction.get(functionName);
    if (!node) return;
    const group = node.closest('details');
    if (group) group.open = true;
    node.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  function showFunctionsForPin(payload) {
    pinFilter = payload;
    repaint();
    payload.functions.forEach(name => {
      const group = itemByFunction.get(name)?.closest('details');
      if (group) group.open = true;
    });
    const first = payload.functions.find(name => itemByFunction.has(name));
    if (first) reveal(first);
  }

  function clearPinFilter() {
    pinFilter = null;
    repaint();
  }

  Bus.on('chip:functions', showFunctionsForPin);
  Bus.on('project:committed', repaint);
  Bus.on('editor:changed', editor => {
    if (editor.status !== 'editing') closeEditors();
    repaint();
  });

  window.Tree = { build, open, reveal, repaint, clearPinFilter };
})();
