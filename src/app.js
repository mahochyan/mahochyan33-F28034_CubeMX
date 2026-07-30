/* R3.2 static application coordinator. All validation/generation stays in-browser. */
(function () {
  'use strict';

  let previewTimer = null;
  let latestPreview = null;

  async function boot() {
    setStatus('正在加载 R3.2 静态器件数据…');
    try {
      const data = await DeviceLoader.loadDeviceData('TMS320F28034');
      Store.setConfig({
        build_id: 'R3.2-STATIC',
        default_device: data.device,
        devices: [{ device: data.device, status: 'golden' }],
      });
      Store.setDevice(data.device, data.deviceInfo);
      Store.setPinmux(data.pinmux);
      Store.setFamily(data.family);
      Store.setConstraints(data.constraints);
      Store.setIndex(data.reverseIndex);
      Store.setWizards(data.wizards);
      Store.setPackage(data.packageData);
      buildDeviceSelect(data.device);
      Store.restore();
      Tree.build(document.getElementById('funcTree'));
      Chip.mount(document.getElementById('chipMount'));
      Detail.renderAssigned();
      wireTabs();
      wireButtons();
      wireEvents();
      Search.init();
      refreshPreview();
      document.getElementById('dataSource').textContent =
        'SPRS584Q · MUX golden 127/127 · STATIC';
      setStatus(`R3.2 静态版已就绪 · ${Chip.count()} 个 PNT80 pad`);
      document.documentElement.dataset.appReady = 'true';
    } catch (error) {
      setStatus(`启动失败：${error.message}`, true);
      console.error(error);
    }
  }

  function buildDeviceSelect(device) {
    const select = document.getElementById('deviceSelect');
    select.innerHTML = `<option value="${device}">${device} · golden</option>`;
    select.value = device;
    select.disabled = true;
  }

  function wireTabs() {
    document.querySelectorAll('.tabs').forEach(tabs => {
      tabs.querySelectorAll('.tab').forEach(button => {
        button.addEventListener('click', () =>
          activateTab(tabs.closest('section'), button.dataset.tab));
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

  function validation() {
    return ConstraintChecker.validateProject(
      Store.exportConfig(), Store.pinmux, Store.family,
    );
  }

  function refreshPreview() {
    const checked = validation();
    if (!checked.ok) {
      latestPreview = null;
      Detail.renderCheck(checked);
      Detail.setPreview({
        files: {
          'generation_blocked.txt': checked.blocking
            .map(item => `${item.rule}: ${item.message}`).join('\n') + '\n',
        },
        recommended_file: 'generation_blocked.txt',
      });
      return checked;
    }
    latestPreview = Codegen.generateProject(Store.exportConfig(), {
      pinmux: Store.pinmux,
      family: Store.family,
      activeModule: activeModule(),
    });
    Detail.setPreview(latestPreview);
    Detail.renderCheck(latestPreview);
    return latestPreview;
  }

  function schedulePreview() {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(() => {
      try { refreshPreview(); } catch (error) {
        setStatus(`预览失败：${error.message}`, true);
        console.error(error);
      }
    }, 80);
  }

  function exportZip() {
    const checked = validation();
    Detail.renderCheck(checked);
    if (!checked.ok) {
      activateTab(document.getElementById('pane-right'), 'check');
      setStatus('校验未通过，ZIP 未生成', true);
      return;
    }
    latestPreview = Codegen.generateProject(Store.exportConfig(), {
      pinmux: Store.pinmux,
      family: Store.family,
      activeModule: activeModule(),
    });
    Detail.setPreview(latestPreview);
    ZipExporter.downloadProjectZip(
      latestPreview.files,
      'TMS320F28034_ConfigStudio_R3_2.zip',
    );
    setStatus(`已导出 ${Object.keys(latestPreview.files).length} 个文件；内容与预览逐字节一致`);
  }

  function downloadText(text, filename, type) {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  function wireButtons() {
    document.getElementById('zoomIn').addEventListener('click', Chip.zoomIn);
    document.getElementById('zoomOut').addEventListener('click', Chip.zoomOut);
    document.getElementById('zoomReset').addEventListener('click', Chip.reset);
    document.getElementById('btnClearPinFilter').addEventListener('click', () => {
      Tree.clearPinFilter();
      setStatus('已显示全部功能');
    });
    document.getElementById('btnValidate').addEventListener('click', () => {
      const result = refreshPreview();
      Detail.renderCheck(result);
      activateTab(document.getElementById('pane-right'), 'check');
      setStatus(result.ok ? 'ProjectConfig 校验通过' :
        `校验失败：${result.blocking.length} 个阻断项`, !result.ok);
    });
    document.getElementById('btnExport').addEventListener('click', exportZip);
    document.getElementById('btnClearAll').addEventListener('click', () => {
      if (window.confirm('清空整个 ProjectConfig？此操作只影响浏览器本地保存。')) {
        Store.clearProject();
        setStatus('ProjectConfig 已清空');
      }
    });
    document.getElementById('btnExportJSON').addEventListener('click', () => {
      downloadText(
        Store.exportJSON() + '\n',
        'TMS320F28034_ProjectConfig_R3_2.json',
        'application/json',
      );
      setStatus('已导出 ProjectConfig JSON');
    });
    document.getElementById('importJSON').addEventListener('change', async event => {
      const file = event.target.files?.[0];
      if (!file) return;
      try {
        Store.importJSON(await file.text());
        setStatus('ProjectConfig 已导入并原子替换');
      } catch (error) {
        setStatus(`导入失败：${error.message}`, true);
      } finally {
        event.target.value = '';
      }
    });
    document.getElementById('btnCopyCode').addEventListener('click', async () => {
      const code = document.getElementById('codePanel').textContent;
      await navigator.clipboard.writeText(code);
      setStatus('当前预览文件已复制');
    });
  }

  function wireEvents() {
    Bus.on('pin:selected', pin => {
      Detail.renderPin(pin);
      Detail.renderRegs(pin);
      Chip.repaint();
    });
    Bus.on('function:active', () => Chip.repaint());
    Bus.on('project:committed', () => {
      Chip.repaint();
      Tree.repaint();
      Detail.renderAssigned();
      schedulePreview();
    });
    Bus.on('draft:replace-request', event => {
      const proceed = window.confirm(
        `正在编辑 ${event.current.functionId}。放弃当前草稿并打开 ${event.next.functionId}？`,
      );
      if (proceed) {
        Store.forceBeginDraft(event.next);
        Tree.reveal(event.next.functionId);
        const node = document.querySelector(
          `.function-node[data-function="${CSS.escape(event.next.functionId)}"]`,
        );
        if (node) Wizard.mountInline(node.querySelector('.inline-editor'));
      }
    });
  }

  window.ConfigStudioApp = {
    validation,
    refreshPreview,
    getLatestPreview: () => latestPreview,
  };
  document.addEventListener('DOMContentLoaded', boot);
})();
