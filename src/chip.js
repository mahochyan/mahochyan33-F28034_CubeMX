/* R3 package-driven chip renderer. Package JSON is the only geometry source. */
(function () {
  const NS = 'http://www.w3.org/2000/svg';
  const nodeByPin = new Map();
  const V = { base: 1280, scale: 1, tx: 0, ty: 0 };
  let svgEl = null;

  function svgNode(tag, attrs) {
    const node = document.createElementNS(NS, tag);
    Object.entries(attrs || {}).forEach(([key, value]) => node.setAttribute(key, value));
    return node;
  }

  function visibleFunctionsFor(def) {
    return [...new Set(
      def?.official_functions || [def?.primary_signal].filter(Boolean),
    )];
  }

  function allFunctionsFor(def) {
    return [...new Set(
      DeviceLoader.routeEntries(def).map(item => item.function),
    )];
  }

  function layout() {
    const pkg = Store.packageData;
    if (!pkg?.sides || !pkg?.geometry) {
      throw new Error('package JSON is missing sides/geometry');
    }
    const g = pkg.geometry;
    const body = g.body;
    const result = new Map();
    Object.entries(pkg.sides).forEach(([side, pins]) => {
      const vertical = side === 'left' || side === 'right';
      const span = vertical ? body.height : body.width;
      const step = span / pins.length;
      pins.forEach((pin, index) => {
        const center = (vertical ? body.y : body.x) + step * (index + 0.5);
        let rect;
        if (side === 'left') {
          rect = { x: body.x - g.pin_length, y: center - g.pin_width / 2,
                   width: g.pin_length, height: g.pin_width };
        } else if (side === 'right') {
          rect = { x: body.x + body.width, y: center - g.pin_width / 2,
                   width: g.pin_length, height: g.pin_width };
        } else if (side === 'top') {
          rect = { x: center - g.pin_width / 2, y: body.y - g.pin_length,
                   width: g.pin_width, height: g.pin_length };
        } else if (side === 'bottom') {
          rect = { x: center - g.pin_width / 2, y: body.y + body.height,
                   width: g.pin_width, height: g.pin_length };
        } else {
          throw new Error(`unknown package side ${side}`);
        }
        result.set(Number(pin), { side, center, rect });
      });
    });
    return result;
  }

  function identityGeometry(geo) {
    const r = geo.rect;
    const cx = r.x + r.width / 2;
    const cy = r.y + r.height / 2;
    return {
      x: cx, y: cy, rotate: geo.side === 'top' || geo.side === 'bottom' ? -90 : 0,
      anchor: 'middle',
    };
  }

  function outerGeometry(geo, gap) {
    const r = geo.rect;
    if (geo.side === 'left') {
      return { x: r.x - gap, y: r.y + r.height / 2, rotate: 0, anchor: 'end' };
    }
    if (geo.side === 'right') {
      return { x: r.x + r.width + gap, y: r.y + r.height / 2, rotate: 0, anchor: 'start' };
    }
    if (geo.side === 'top') {
      return { x: r.x + r.width / 2, y: r.y - gap, rotate: -90, anchor: 'start' };
    }
    return { x: r.x + r.width / 2, y: r.y + r.height + gap, rotate: 90, anchor: 'start' };
  }

  function buildSvg() {
    const pkg = Store.packageData;
    const canvas = pkg.geometry.canvas;
    V.base = canvas;
    const body = pkg.geometry.body;
    const positions = layout();
    const svg = svgNode('svg', {
      id: 'chip-svg', viewBox: `0 0 ${canvas} ${canvas}`,
      'font-family': 'Consolas,Menlo,monospace',
      'data-package': pkg.package, 'data-view': pkg.view,
    });
    const style = svgNode('style');
    style.textContent = `
      .pin{cursor:pointer}.pin.fixed{cursor:default}
      .pad{fill:#3a4150;stroke:#0d1117;stroke-width:1}
      .fixed .pad{fill:#262a31}.st-avail .pad{fill:#2f6fde;stroke:#7fb0ff}
      .st-sel .pad{fill:#2ea44f;stroke:#7fe0a0}.st-err .pad{fill:#d43a3a}
      .cur .pad,.pin:hover .pad{stroke:#fff;stroke-width:2}
      .identity{fill:#e6edf3;font-size:9px;font-weight:600;pointer-events:none}
      .outer-function{fill:#8b949e;font-size:8.5px;pointer-events:none}
      .pin:hover .outer-function{fill:#9aa7ff}.hit{fill:transparent;pointer-events:all}
    `;
    svg.appendChild(style);
    svg.appendChild(svgNode('rect', {
      id: 'chip-body', x: body.x, y: body.y, width: body.width, height: body.height,
      rx: 16, fill: '#161b22', stroke: '#30363d', 'stroke-width': 2,
    }));
    svg.appendChild(svgNode('circle', {
      cx: body.x + 26, cy: body.y + 26, r: 9, fill: 'none',
      stroke: '#8b949e', 'stroke-width': 2,
    }));
    const title = svgNode('text', {
      x: body.x + body.width / 2, y: body.y + body.height / 2 - 8,
      'text-anchor': 'middle', fill: '#e6edf3', 'font-size': 26, 'font-weight': 700,
    });
    title.textContent = 'TMS320F28034';
    svg.appendChild(title);
    const subtitle = svgNode('text', {
      x: body.x + body.width / 2, y: body.y + body.height / 2 + 20,
      'text-anchor': 'middle', fill: '#8b949e', 'font-size': 15,
    });
    subtitle.textContent = `${pkg.package} · ${pkg.description} · ${pkg.view} view`;
    svg.appendChild(subtitle);

    [...positions.entries()].sort((a, b) => a[0] - b[0]).forEach(([pin, geo]) => {
      const def = Store.pinDef(pin);
      if (!def) return;
      const fixed = !def.configurable;
      const group = svgNode('g', {
        class: `pin${fixed ? ' fixed' : ''}`, 'data-pin': pin,
        'data-side': geo.side, 'data-signal': def.primary_signal,
        'data-configurable': fixed ? '0' : '1',
      });
      const visibleFunctions = visibleFunctionsFor(def);
      const allFunctions = allFunctionsFor(def);
      group.setAttribute('data-function-count', allFunctions.length);
      const shortFunctions = visibleFunctions.length <= 3
        ? visibleFunctions.join(' / ')
        : `${visibleFunctions.slice(0, 3).join(' / ')} +${visibleFunctions.length - 3}`;
      const tooltip = svgNode('title');
      tooltip.textContent = `Pin${pin} ${def.primary_signal}` +
        (visibleFunctions.length ? `\n${visibleFunctions.join(' / ')}` : '');
      group.appendChild(tooltip);
      group.appendChild(svgNode('rect', {
        class: 'pad', rx: 2, ...geo.rect,
      }));
      const hitPad = 3;
      group.appendChild(svgNode('rect', {
        class: 'hit',
        x: geo.rect.x - hitPad, y: geo.rect.y - hitPad,
        width: geo.rect.width + hitPad * 2, height: geo.rect.height + hitPad * 2,
      }));
      const ident = identityGeometry(geo);
      const idText = svgNode('text', {
        class: 'identity', x: ident.x, y: ident.y,
        'text-anchor': ident.anchor, 'dominant-baseline': 'middle',
        transform: `rotate(${ident.rotate} ${ident.x} ${ident.y})`,
      });
      idText.textContent = `${pin} ${def.primary_signal}`;
      group.appendChild(idText);
      if (shortFunctions) {
        const out = outerGeometry(geo, pkg.geometry.outer_label_gap);
        const text = svgNode('text', {
          class: 'outer-function', x: out.x, y: out.y,
          'text-anchor': out.anchor, 'dominant-baseline': 'middle',
          transform: `rotate(${out.rotate} ${out.x} ${out.y})`,
        });
        text.textContent = shortFunctions;
        group.appendChild(text);
      }
      group.addEventListener('click', event => {
        event.stopPropagation();
        if (!Chip._moved) onPinClick(pin);
      });
      nodeByPin.set(pin, group);
      svg.appendChild(group);
    });
    return svg;
  }

  function mount(container) {
    container.innerHTML = '';
    nodeByPin.clear();
    svgEl = buildSvg();
    container.appendChild(svgEl);
    wireZoomPan(container);
    reset();
    repaint();
    return nodeByPin.size;
  }

  function onPinClick(pin) {
    const def = Store.pinDef(pin);
    Store.selectPin(pin);
    const functions = allFunctionsFor(def);
    Bus.emit('chip:functions', { pin, functions });
    if (def?.configurable) {
      if (!functions.length) {
        setStatus(
          `P0：Pin${pin} 标记为 configurable=true，但功能列表为空`,
          true,
        );
        return;
      }
      setStatus(`Pin${pin} ${def.primary_signal}：请在功能树选择功能`);
    } else {
      setStatus(`Pin${pin} ${def?.primary_signal || ''}：固定脚，只显示详情`);
    }
  }

  function repaint() {
    nodeByPin.forEach((group, pin) => {
      group.classList.remove('st-avail', 'st-sel', 'st-err', 'cur');
      const state = Store.pinState(pin);
      if (state && !['default', 'fixed'].includes(state)) group.classList.add(`st-${state}`);
      if (Store.selectedPin === pin) group.classList.add('cur');
    });
  }
  function focusPin(pin) {
    const group = nodeByPin.get(Number(pin));
    if (!group) return;
    group.classList.add('cur');
    group.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  }
  function applyView() {
    if (!svgEl) return;
    const width = V.base / V.scale;
    const x = V.tx - (width - V.base) / 2;
    const y = V.ty - (width - V.base) / 2;
    svgEl.setAttribute('viewBox', `${x} ${y} ${width} ${width}`);
  }
  function zoom(factor) {
    V.scale = Math.min(8, Math.max(1, V.scale * factor));
    if (V.scale === 1) { V.tx = 0; V.ty = 0; }
    applyView();
  }
  function reset() { V.scale = 1; V.tx = 0; V.ty = 0; applyView(); }
  function wireZoomPan(container) {
    container.addEventListener('wheel', event => {
      event.preventDefault();
      zoom(event.deltaY < 0 ? 1.15 : 1 / 1.15);
    }, { passive: false });
    let drag = null;
    container.addEventListener('pointerdown', event => {
      drag = { x: event.clientX, y: event.clientY, tx: V.tx, ty: V.ty };
    });
    container.addEventListener('pointermove', event => {
      if (!drag) return;
      const dx = event.clientX - drag.x;
      const dy = event.clientY - drag.y;
      if (Math.hypot(dx, dy) < 5) return;
      Chip._moved = true;
      const rect = container.getBoundingClientRect();
      const scale = V.base / V.scale / Math.min(rect.width, rect.height);
      V.tx = drag.tx - dx * scale; V.ty = drag.ty - dy * scale; applyView();
    });
    const stop = () => { drag = null; setTimeout(() => { Chip._moved = false; }, 0); };
    container.addEventListener('pointerup', stop);
    container.addEventListener('pointercancel', stop);
  }

  window.Chip = {
    mount, repaint, focusPin, reset, count: () => nodeByPin.size,
    zoomIn: () => zoom(1.2), zoomOut: () => zoom(1 / 1.2), _moved: false,
  };
})();
