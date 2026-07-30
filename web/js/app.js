/* R3 application coordinator. Only committed ProjectConfig reaches the backend. */
(function () {
  let previewTimer = null;

  async function boot() {
    setStatus('正在加载 R3 设备数据库…');
    try {
      const cfg = await api('/api/config');
      Store.setConfig(cfg);
      buildDeviceSelect(cfg);
      await loadDevice(cfg.default_device);
      Store.restore();
      Tree.build(document.getElementById('funcTree'));
      Chip.mount(document.getElementById('chipMount'));
      Detail.renderAssigned();
      wireTabs();
      wireButtons();
      wireEvents();
      await refreshPreview();
      document.getElementById('dataSource').textContent =
        `SPRS584Q · ${cfg.build_id} · ${cfg.app_mode.toUpperCase()}`;
      setStatus(`R3 已就绪 · ${Chip.count()} 个 PN80 pad · ${cfg.app_mode.toUpperCase()} 模式`);
    } catch (err) {
      setStatus(`启动失败：${err.message}`, true);
      console.error(err);
    }
  }

  function buildDeviceSelect(cfg) {
    const select = document.getElementById('deviceSelect');
    select.innerHTML = cfg.devices.map(item =>
      `<option value="${item.device}">${item.device} · ${item.status}</option>`).join('');
    select.value = cfg.default_device;
    select.addEventListener('change', async () => {
      await loadDevice(select.value);
      Tree.build(document.getElementById('funcTree'));
      Chip.mount(document.getElementById('chipMount'));
      Detail.renderAssigned();
      schedulePreview();
    });
  }

  async function loadDevice(device) {
    Store.setDevice(device, null);
    const info = await api(`/api/device/${encodeURIComponent(device)}`);
    Store.setDevice(device, info);
    const packageName = info.default_package || 'PN80';
    const [pinmux, constraints, index, wizards, packageData] = await Promise.all([
      api(`/api/device/${encodeURIComponent(device)}/pinmux`),
      api(`/api/device/${encodeURIComponent(device)}/constraints`),
      api(`/api/device/${encodeURIComponent(device)}/index`),
      api(`/api/device/${encodeURIComponent(device)}/wizards`),
      api(`/api/device/${encodeURIComponent(device)}/package/${packageName.toLowerCase()}`),
    ]);
    Store.setPinmux(pinmux);
    Store.setConstraints(constraints);
    Store.setIndex(index);
    Store.setWizards(wizards);
    Store.setPackage(packageData);
  }

  function wireTabs() {
    document.querySelectorAll('.tabs').forEach(tabs => {
      tabs.querySelectorAll('.tab').forEach(button => {
        button.addEventListener('click', () => activateTab(tabs.closest('section'), button.dataset.tab));
      });
    });
  }
  function activateTab(section, name) {
    section.querySelectorAll(':scope > .tabs .tab').forEach(button =>
      button.classList.toggle('active', button.dataset.tab === name));
    section.querySelectorAll(':scope > .tab-page').forEach(page =>
      page.classList.toggle('active', page.id === `tab-${name}`));
  }

  function activeModule() {
    const pin = Store.selectedPin != null && Store.getPin(Store.selectedPin);
    return pin?.module || pin?.function || null;
  }

  async function refreshPreview() {
    try {
      const result = await api('/api/preview', {
        method: 'POST',
        body: {
          device: Store.device,
          project_config: Store.exportConfig(),
          active_module: activeModule(),
        },
      });
      Detail.setPreview(result);
      Detail.renderCheck(result);
      return result;
    } catch (err) {
      if (err.payload) Detail.renderCheck(err.payload);
      const panel = document.getElementById('codePanel');
      panel.innerHTML = `<code>// 后端拒绝预览：${String(err.message)}</code>`;
      throw err;
    }
  }
  function schedulePreview() {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(() => {
      refreshPreview().catch(err => setStatus(`预览被拒绝：${err.message}`, true));
    }, 120);
  }

  async function exportZip() {
    setStatus('正在用与预览相同的生成核心创建 ZIP…');
    const response = await fetch('/api/export.zip', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        device: Store.device,
        project_config: Store.exportConfig(),
        active_module: activeModule(),
      }),
    });
    if (!response.ok) {
      const payload = await response.json();
      Detail.renderCheck(payload);
      throw new Error(payload.error?.message || 'ZIP export failed');
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${Store.device}_generated_r3.zip`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    setStatus(`ZIP 导出成功 · ${blob.size} bytes · 服务器无 staging 残留`);
  }

  function downloadText(name, text) {
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url; anchor.download = name; anchor.click(); URL.revokeObjectURL(url);
  }

  function wireButtons() {
    document.getElementById('zoomIn')?.addEventListener('click', Chip.zoomIn);
    document.getElementById('zoomOut')?.addEventListener('click', Chip.zoomOut);
    document.getElementById('zoomReset')?.addEventListener('click', Chip.reset);
    document.getElementById('btnValidate')?.addEventListener('click', async () => {
      try {
        const result = await api('/api/validate', {
          method: 'POST',
          body: { device: Store.device, project_config: Store.exportConfig() },
        });
        Detail.renderCheck(result);
        activateTab(document.getElementById('pane-right'), 'check');
        setStatus(result.ok ? '校验通过' : `${result.blocking} 个阻断项`, !result.ok);
      } catch (err) { setStatus(`校验失败：${err.message}`, true); }
    });
    document.getElementById('btnExport')?.addEventListener('click', () =>
      exportZip().catch(err => setStatus(`ZIP 导出失败：${err.message}`, true)));
    document.getElementById('btnClearAll')?.addEventListener('click', () => {
      if (window.confirm('清空整个 committed ProjectConfig？')) Store.clearProject();
    });
    document.getElementById('btnExportJSON')?.addEventListener('click', () =>
      downloadText(`${Store.device}_project_config.json`, Store.exportJSON()));
    document.getElementById('importJSON')?.addEventListener('change', event => {
      const file = event.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try { Store.importJSON(reader.result); setStatus('ProjectConfig 已导入'); }
        catch (err) { setStatus(`导入失败：${err.message}`, true); }
      };
      reader.readAsText(file); event.target.value = '';
    });
    document.getElementById('btnCopyCode')?.addEventListener('click', () => {
      navigator.clipboard?.writeText(document.getElementById('codePanel').innerText);
      setStatus('当前代码文件已复制');
    });
  }

  function wireEvents() {
    Bus.on('pin:selected', pin => {
      Detail.renderPin(pin); Detail.renderRegs(pin); Chip.repaint(); schedulePreview();
    });
    Bus.on('function:active', () => { Chip.repaint(); Tree.repaint(); });
    Bus.on('project:committed', () => {
      Chip.repaint(); Tree.repaint(); Detail.renderAssigned();
      if (Store.selectedPin != null) Detail.renderPin(Store.selectedPin);
      schedulePreview();
    });
    Bus.on('draft:replace-request', payload => {
      const discard = window.confirm('当前 inline 草稿尚未保存。确定放弃草稿并切换功能吗？');
      if (discard) {
        Store.forceBeginDraft(payload.next);
        const node = document.querySelector(
          `.function-node[data-function="${CSS.escape(payload.next.functionId)}"]`);
        if (node) Wizard.mountInline(node.querySelector('.inline-editor'));
      }
    });
  }

  window.activateTab = (selector, name) => {
    const section = typeof selector === 'string' ? document.querySelector(selector) : selector;
    if (section) activateTab(section, name);
  };
  document.addEventListener('DOMContentLoaded', boot);
})();
