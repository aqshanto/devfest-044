// Smart Escape UI: state, rendering, events.
(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const SVG = 'http://www.w3.org/2000/svg';

  let lang = 'en';
  try { lang = localStorage.getItem('se-lang') === 'bn' ? 'bn' : 'en'; } catch (e) { /* storage unavailable */ }

  let data = null;        // validated dataset
  let state = null;       // {blockedNodes, blockedEdges, closedExits}
  let start = null;       // selected start node id
  let mode = 'start';     // map click mode: 'start' | 'hazard'
  let errors = null;      // last import errors
  let lastRouteKey = '';
  let nodeEls = new Map();
  let edgeEls = new Map();
  let pos = new Map();    // node id -> {x, y} in SVG units

  function t(key, params) {
    let s = I18N[lang][key] ?? I18N.en[key] ?? key;
    if (params) for (const k in params) s = s.split('{' + k + '}').join(params[k]);
    return s;
  }

  function el(tag, attrs, parent) {
    const e = document.createElementNS(SVG, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }

  function freshState() {
    const s = data.initial_state;
    return {
      blockedNodes: new Set(s.blocked_nodes),
      blockedEdges: new Set(s.blocked_edges),
      closedExits: new Set(s.closed_exits),
    };
  }

  // ---------- Loading ----------
  function loadText(text) {
    let obj;
    try { obj = JSON.parse(text); } catch (e) { showErrors([{ key: 'errParse', params: {} }]); return; }
    const errs = Router.validate(obj);
    if (errs.length) { showErrors(errs); return; }
    errors = null;
    data = obj;
    state = freshState();
    start = null;
    lastRouteKey = '';
    buildMap();
    render();
  }

  function showErrors(errs) {
    errors = errs;
    render();
  }

  // ---------- Map construction (once per dataset) ----------
  function buildMap() {
    const svg = $('#map');
    svg.innerHTML = '';
    nodeEls = new Map();
    edgeEls = new Map();

    // Uniformly scale supplied coordinates so node sizes stay readable on any dataset.
    const xs = data.nodes.map(n => n.x), ys = data.nodes.map(n => n.y);
    const minX = Math.min(...xs), minY = Math.min(...ys);
    const span = Math.max(Math.max(...xs) - minX, Math.max(...ys) - minY);
    const k = span > 0 ? 640 / span : 1;
    const pad = 50;
    pos = new Map(data.nodes.map(n => [n.id, { x: (n.x - minX) * k + pad, y: (n.y - minY) * k + pad }]));
    const w = (Math.max(...xs) - minX) * k + pad * 2;
    const h = (Math.max(...ys) - minY) * k + pad * 2 + 16;
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);

    const gEdges = el('g', {}, svg);
    el('polyline', { id: 'routeLine', class: 'route-line', points: '' }, svg);
    const gCosts = el('g', {}, svg);
    const gNodes = el('g', {}, svg);

    data.edges.forEach(e => {
      const a = pos.get(e.from), b = pos.get(e.to);
      const g = el('g', { class: 'edge', 'data-id': e.id }, gEdges);
      el('line', { class: 'vis', x1: a.x, y1: a.y, x2: b.x, y2: b.y }, g);
      el('line', { class: 'hit', x1: a.x, y1: a.y, x2: b.x, y2: b.y }, g);
      // Cost labels sit in a layer above the route line so they stay readable.
      const c = el('g', { class: 'edge' }, gCosts);
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      const txt = String(e.cost);
      const bw = 10 + txt.length * 7;
      el('rect', { class: 'cost-bg', x: mx - bw / 2, y: my - 10, width: bw, height: 20, rx: 6 }, c);
      el('text', { class: 'cost-tx', x: mx, y: my }, c).textContent = txt;
      [g, c].forEach(x => {
        el('title', {}, x).textContent = `${e.id}: ${e.from} – ${e.to} (${e.cost})`;
        x.addEventListener('click', () => toggleEdge(e.id));
      });
      edgeEls.set(e.id, [g, c]);
    });

    data.nodes.forEach(n => {
      const p = pos.get(n.id);
      const g = el('g', { class: 'node ' + n.type, transform: `translate(${p.x},${p.y})`, tabindex: 0, role: 'button', 'aria-label': `${n.id} ${n.label}` }, gNodes);
      const body = el('g', { class: 'body' }, g);
      el('circle', { class: 'ring', r: n.type === 'exit' ? 24 : 21 }, body);
      if (n.type === 'room') el('rect', { class: 'shape', x: -16, y: -16, width: 32, height: 32, rx: 7 }, body);
      else el('circle', { class: 'shape', r: n.type === 'exit' ? 19 : 15 }, body);
      el('path', { class: 'xmark', d: 'M-6,-6 L6,6 M6,-6 L-6,6' }, body);
      el('text', { class: 'nid' }, body).textContent = n.id;
      el('text', { class: 'nlabel', y: n.type === 'exit' ? 34 : 31 }, g).textContent = n.label;
      el('title', {}, g).textContent = `${n.id} · ${n.label} (${n.type})`;
      g.addEventListener('click', () => onNodeClick(n));
      g.addEventListener('keydown', ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); onNodeClick(n); } });
      nodeEls.set(n.id, g);
    });
  }

  // ---------- Interactions ----------
  function onNodeClick(n) {
    if (mode === 'start') {
      if (n.type === 'exit' || state.blockedNodes.has(n.id)) { flash(n.id); return; }
      setStart(n.id);
    } else {
      toggleNode(n.id);
    }
  }

  function setStart(id) {
    start = id || null;
    const g = start && nodeEls.get(start);
    if (g) { g.classList.remove('start'); void g.getBBox(); }
    render();
  }

  function toggleNode(id) {
    const n = data.nodes.find(x => x.id === id);
    const set = n.type === 'exit' ? state.closedExits : state.blockedNodes;
    set.has(id) ? set.delete(id) : set.add(id);
    flash(id);
    render();
  }

  function toggleEdge(id) {
    state.blockedEdges.has(id) ? state.blockedEdges.delete(id) : state.blockedEdges.add(id);
    render();
  }

  function flash(id) {
    const g = nodeEls.get(id);
    if (!g) return;
    g.classList.remove('flash');
    void g.getBBox();
    g.classList.add('flash');
  }

  // ---------- Rendering ----------
  function renderStatic() {
    document.documentElement.lang = lang;
    document.title = t('title');
    document.querySelectorAll('[data-i18n]').forEach(e => { e.textContent = t(e.dataset.i18n); });
    $('#modeStart').setAttribute('aria-checked', mode === 'start');
    $('#modeHazard').setAttribute('aria-checked', mode === 'hazard');
  }

  function renderErrors() {
    const box = $('#errors');
    if (!errors) { box.hidden = true; return; }
    box.hidden = false;
    box.innerHTML = '';
    const p = document.createElement('strong');
    p.textContent = t('errTitle');
    const ul = document.createElement('ul');
    errors.slice(0, 12).forEach(er => {
      const li = document.createElement('li');
      li.textContent = t(er.key, er.params);
      ul.appendChild(li);
    });
    box.append(p, ul);
  }

  function renderStartSelect() {
    const sel = $('#start');
    sel.innerHTML = '';
    const ph = new Option(t('startPlaceholder'), '');
    sel.add(ph);
    if (!data) { sel.disabled = true; return; }
    sel.disabled = false;
    data.nodes.filter(n => n.type !== 'exit').forEach(n => {
      const blocked = state.blockedNodes.has(n.id);
      const o = new Option(`${n.id} · ${n.label}${blocked ? ' (' + t('blocked') + ')' : ''}`, n.id);
      o.disabled = blocked && n.id !== start;
      sel.add(o);
    });
    sel.value = start || '';
  }

  function hzButton(text, pressed, onClick) {
    const b = document.createElement('button');
    b.textContent = text;
    b.setAttribute('aria-pressed', pressed);
    b.addEventListener('click', onClick);
    return b;
  }

  function renderHazards() {
    const hn = $('#hzNodes'), he = $('#hzExits'), hd = $('#hzEdges');
    hn.innerHTML = he.innerHTML = hd.innerHTML = '';
    if (!data) return;
    data.nodes.forEach(n => {
      if (n.type === 'exit') {
        const c = state.closedExits.has(n.id);
        const b = hzButton(`${n.id} · ${c ? t('closed') : t('open')}`, c, () => toggleNode(n.id));
        b.title = `${n.label}: ${c ? t('reopen') : t('close')}`;
        he.appendChild(b);
      } else {
        const bl = state.blockedNodes.has(n.id);
        const b = hzButton(n.id, bl, () => toggleNode(n.id));
        b.title = `${n.label}: ${bl ? t('unblock') : t('block')}`;
        hn.appendChild(b);
      }
    });
    data.edges.forEach(e => {
      const bl = state.blockedEdges.has(e.id);
      const b = hzButton(`${e.from}–${e.to} (${e.cost})`, bl, () => toggleEdge(e.id));
      b.title = `${e.id}: ${bl ? t('unblock') : t('block')}`;
      hd.appendChild(b);
    });
  }

  function renderMapState(route) {
    const onNodes = new Set(route && route.status === 'ok' ? route.path : []);
    const onEdges = new Set(route && route.status === 'ok' ? route.edges : []);
    data.nodes.forEach(n => {
      const g = nodeEls.get(n.id);
      g.classList.toggle('blocked', state.blockedNodes.has(n.id));
      g.classList.toggle('closed', state.closedExits.has(n.id));
      g.classList.toggle('start', n.id === start);
      g.classList.toggle('on-route', onNodes.has(n.id));
    });
    data.edges.forEach(e => {
      const dead = state.blockedNodes.has(e.from) || state.blockedNodes.has(e.to) || state.closedExits.has(e.from) || state.closedExits.has(e.to);
      edgeEls.get(e.id).forEach(g => {
        g.classList.toggle('blocked', state.blockedEdges.has(e.id));
        g.classList.toggle('dead', dead);
        g.classList.toggle('on-route', onEdges.has(e.id));
      });
    });

    const line = $('#routeLine');
    const key = route && route.status === 'ok' ? route.path.join('>') : '';
    if (key === lastRouteKey) return;
    lastRouteKey = key;
    if (!key) { line.setAttribute('points', ''); return; }
    const pts = route.path.map(id => pos.get(id));
    line.setAttribute('points', pts.map(p => `${p.x},${p.y}`).join(' '));
    let len = 0;
    for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    line.style.setProperty('--len', len);
    line.style.strokeDasharray = len;
    line.classList.remove('draw');
    void line.getBBox();
    line.classList.add('draw');
  }

  function renderResult(route) {
    const st = $('#status'), res = $('#result');
    let cls = 'warn', msg;
    if (!data) msg = t('stNoData');
    else if (!route || route.status === 'noStart') msg = t('stSelectStart');
    else if (route.status === 'startBlocked') { cls = 'err'; msg = t('stStartBlocked'); }
    else if (route.status === 'noRoute') { cls = 'err'; msg = t('stNoRoute'); }
    else { cls = 'ok'; msg = t('stOk'); }
    if (st.textContent !== msg) {
      st.className = 'status';
      void st.offsetWidth;
    }
    st.className = 'status ' + cls;
    st.textContent = msg;

    if (!route || route.status !== 'ok') { res.hidden = true; return; }
    res.hidden = false;
    const p = $('#rPath');
    p.innerHTML = '';
    route.path.forEach((id, i) => {
      if (i) { const a = document.createElement('span'); a.className = 'arrow'; a.textContent = '→'; p.appendChild(a); }
      const c = document.createElement('span');
      c.className = 'chip';
      c.style.animationDelay = (i * 30) + 'ms';
      c.textContent = id;
      c.title = data.nodes.find(n => n.id === id).label;
      p.appendChild(c);
    });
    const ex = data.nodes.find(n => n.id === route.exit);
    $('#rExit').textContent = `${ex.id} · ${ex.label}`;
    $('#rCost').textContent = `${route.cost}  (${route.edges.length} ${t('corridors')})`;
  }

  function render() {
    renderStatic();
    renderErrors();
    $('#empty').hidden = !!data;
    $('#buildingName').textContent = data ? data.building : '—';
    renderStartSelect();
    renderHazards();
    const route = data && start ? Router.findRoute(data, state, start) : null;
    if (data) renderMapState(route);
    renderResult(route);
  }

  // ---------- Wiring ----------
  $('#file').addEventListener('change', ev => {
    const f = ev.target.files[0];
    if (!f) return;
    f.text().then(loadText);
    ev.target.value = '';
  });
  $('#sample').addEventListener('click', () => {
    fetch('building.json').then(r => { if (!r.ok) throw new Error(); return r.text(); })
      .then(loadText)
      .catch(() => showErrors([{ key: 'sampleFail', params: {} }]));
  });
  $('#reset').addEventListener('click', () => {
    if (!data) return;
    state = freshState();
    render();
  });
  $('#lang').addEventListener('click', () => {
    lang = lang === 'en' ? 'bn' : 'en';
    try { localStorage.setItem('se-lang', lang); } catch (e) { /* ignore */ }
    render();
  });
  $('#modeStart').addEventListener('click', () => { mode = 'start'; render(); });
  $('#modeHazard').addEventListener('click', () => { mode = 'hazard'; render(); });
  $('#start').addEventListener('change', ev => setStart(ev.target.value));

  render();
  // Auto-load the bundled sample for a ready-to-use demo (silently skipped on file://).
  fetch('building.json').then(r => r.ok ? r.text() : null).then(txt => { if (txt && !data) loadText(txt); }).catch(() => {});
})();
