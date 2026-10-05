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
  let hc = false;
  let walkIdx = -1;       // active walkthrough step, -1 = none
  let walkTimer = null;
  let previewExit = null; // exit whose alternative route is previewed
  try { hc = localStorage.getItem('se-hc') === '1'; } catch (e) { /* ignore */ }
  let dark = false;
  try { dark = localStorage.getItem('se-dark') === '1'; } catch (e) { /* ignore */ }
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
    el('polyline', { id: 'altLine', class: 'alt-line', points: '' }, svg);
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
    document.documentElement.classList.toggle('hc', hc);
    $('#hc').setAttribute('aria-pressed', hc);
    document.documentElement.classList.toggle('dark', dark);
    $('#theme').setAttribute('aria-pressed', dark);
    $('#png').disabled = !data;
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
    stopWalk();
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

    if (!route || route.status !== 'ok') { res.hidden = true; $('#walk').hidden = true; $('#alts').hidden = true; drawAlt(null); return; }
    res.hidden = false;
    renderSteps(route);
    renderAlts();
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

  function renderAlts() {
    const list = Router.routesByExit(data, state, start);
    if (!list.some(r => r.exit === previewExit)) previewExit = null;
    $('#alts').hidden = list.length < 2;
    const box = $('#altList');
    box.innerHTML = '';
    list.forEach((r, i) => {
      const ex = data.nodes.find(n => n.id === r.exit);
      const b = document.createElement('button');
      b.className = 'alt';
      b.setAttribute('aria-pressed', previewExit === r.exit);
      if (i === 0) { const tag = document.createElement('span'); tag.className = 'tag'; tag.textContent = t('best'); b.appendChild(tag); }
      b.appendChild(document.createTextNode(`${ex.id} · ${ex.label} — ${t('cost')}: ${r.cost}`));
      const sm = document.createElement('small');
      sm.textContent = r.path.join(' → ');
      b.appendChild(sm);
      b.addEventListener('click', () => { previewExit = previewExit === r.exit ? null : r.exit; render(); });
      box.appendChild(b);
    });
    drawAlt(list.find(r => r.exit === previewExit) || null);
  }

  function drawAlt(r) {
    const line = $('#altLine');
    if (!line) return;
    line.setAttribute('points', r ? r.path.map(id => { const p = pos.get(id); return `${p.x},${p.y}`; }).join(' ') : '');
  }

  function renderSteps(route) {
    $('#walk').hidden = false;
    $('#play').textContent = walkTimer ? t('stop') : t('play');
    const label = id => data.nodes.find(n => n.id === id).label;
    const ol = $('#steps');
    ol.innerHTML = '';
    const items = [t('stepStart', { id: route.path[0], label: label(route.path[0]) })];
    let total = 0;
    route.edges.forEach((eid, i) => {
      const e = data.edges.find(x => x.id === eid);
      const to = route.path[i + 1];
      total += e.cost;
      const isLast = i === route.edges.length - 1;
      items.push(t('stepGo', { edge: eid, cost: e.cost, id: to, label: label(to), total }));
      if (isLast) items.push(t('stepExit', { id: to, label: label(to), total }));
    });
    items.forEach((txt, i) => {
      const li = document.createElement('li');
      li.textContent = txt;
      li.classList.toggle('active', i === walkIdx);
      ol.appendChild(li);
    });
  }

  // Walkthrough playback: highlight each step and pulse its node on the map.
  function walkNodeAt(route, i) {
    if (i === 0) return route.path[0];
    return route.path[Math.min(i, route.path.length - 1)];
  }
  function stopWalk() {
    clearInterval(walkTimer);
    walkTimer = null;
    walkIdx = -1;
  }
  function togglePlay() {
    const route = data && start ? Router.findRoute(data, state, start) : null;
    if (!route || route.status !== 'ok') return;
    if (walkTimer) { stopWalk(); render(); return; }
    const steps = route.edges.length + 2;
    walkIdx = 0;
    const tick = () => {
      if (walkIdx >= steps) { stopWalk(); render(); return; }
      const g = nodeEls.get(walkNodeAt(route, walkIdx));
      if (g) { g.classList.remove('walk'); void g.getBBox(); g.classList.add('walk'); }
      render();
      walkIdx++;
    };
    walkTimer = setInterval(tick, 700);
    tick();
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
    saveSession();
  }

  // Save progress (dataset, hazards, start) in this browser so a reload resumes where you left off.
  function saveSession() {
    if (!data) return;
    try {
      localStorage.setItem('se-session', JSON.stringify({
        data, start, mode,
        bn: [...state.blockedNodes], be: [...state.blockedEdges], ce: [...state.closedExits],
      }));
    } catch (e) { /* storage full or unavailable */ }
  }

  function restoreSession() {
    let s = null;
    try { s = JSON.parse(localStorage.getItem('se-session')); } catch (e) { return false; }
    if (!s || !s.data || Router.validate(s.data).length) return false;
    loadText(JSON.stringify(s.data));
    const nodes = new Map(data.nodes.map(n => [n.id, n]));
    const edges = new Set(data.edges.map(e => e.id));
    state.blockedNodes = new Set((s.bn || []).filter(id => nodes.has(id) && nodes.get(id).type !== 'exit'));
    state.blockedEdges = new Set((s.be || []).filter(id => edges.has(id)));
    state.closedExits = new Set((s.ce || []).filter(id => nodes.has(id) && nodes.get(id).type === 'exit'));
    start = nodes.has(s.start) && nodes.get(s.start).type !== 'exit' ? s.start : null;
    mode = s.mode === 'hazard' ? 'hazard' : 'start';
    render();
    return true;
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
  $('#hc').addEventListener('click', () => {
    hc = !hc;
    try { localStorage.setItem('se-hc', hc ? '1' : '0'); } catch (e) { /* ignore */ }
    render();
  });
  $('#theme').addEventListener('click', () => {
    dark = !dark;
    try { localStorage.setItem('se-dark', dark ? '1' : '0'); } catch (e) { /* ignore */ }
    render();
  });
  $('#png').addEventListener('click', exportPng);
  // Drag & drop a JSON file onto the map to import it.
  const wrap = $('.map-wrap');
  wrap.addEventListener('dragover', ev => { ev.preventDefault(); wrap.dataset.drop = t('dropHere'); wrap.classList.add('drag'); });
  wrap.addEventListener('dragleave', () => wrap.classList.remove('drag'));
  wrap.addEventListener('drop', ev => {
    ev.preventDefault();
    wrap.classList.remove('drag');
    const f = ev.dataTransfer.files[0];
    if (f) f.text().then(loadText);
  });
  $('#play').addEventListener('click', togglePlay);

  // Export the current map (with route and hazards) as a PNG, inlining computed styles.
  function exportPng() {
    if (!data) return;
    const src = $('#map');
    const clone = src.cloneNode(true);
    const props = ['fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-linecap', 'opacity',
      'font-size', 'font-weight', 'font-family', 'text-anchor', 'dominant-baseline', 'transform', 'transform-origin', 'transform-box'];
    const a = src.querySelectorAll('*'), b = clone.querySelectorAll('*');
    a.forEach((n, i) => {
      const cs = getComputedStyle(n);
      b[i].setAttribute('style', props.map(p => `${p}:${cs.getPropertyValue(p)}`).join(';') + ';animation:none');
    });
    clone.querySelectorAll('title').forEach(x => x.remove());
    const vb = src.viewBox.baseVal;
    const bg = document.createElementNS(SVG, 'rect');
    bg.setAttribute('width', vb.width); bg.setAttribute('height', vb.height);
    bg.setAttribute('fill', getComputedStyle(document.querySelector('.map-card')).backgroundColor);
    clone.insertBefore(bg, clone.firstChild);
    clone.setAttribute('xmlns', SVG);
    clone.setAttribute('width', vb.width); clone.setAttribute('height', vb.height);
    const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(clone)], { type: 'image/svg+xml' }));
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = vb.width * 2; c.height = vb.height * 2;
      const ctx = c.getContext('2d');
      ctx.scale(2, 2);
      ctx.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);
      const link = document.createElement('a');
      link.download = `smart-escape-${start || 'map'}.png`;
      link.href = c.toDataURL('image/png');
      link.click();
    };
    img.src = url;
  }
  $('#modeStart').addEventListener('click', () => { mode = 'start'; render(); });
  $('#modeHazard').addEventListener('click', () => { mode = 'hazard'; render(); });
  $('#start').addEventListener('change', ev => setStart(ev.target.value));

  render();
  // Resume a saved session unless the URL asks for a specific demo state.
  const hasUrlState = /[?&](start|block|close)=/.test(location.search);
  if (!hasUrlState && restoreSession()) return;
  // Auto-load the bundled sample for a ready-to-use demo (silently skipped on file://).
  fetch('building.json').then(r => r.ok ? r.text() : null).then(txt => {
    if (!txt || data) return;
    loadText(txt);
    applyUrlState();
  }).catch(() => {});

  // Shareable demo state: ?start=R1&block=C2,L04&close=E1 (applies on top of initial_state).
  function applyUrlState() {
    if (!data) return;
    const q = new URLSearchParams(location.search);
    const ids = k => (q.get(k) || '').split(',').filter(Boolean);
    const nodes = new Map(data.nodes.map(n => [n.id, n]));
    const edgeIds = new Set(data.edges.map(e => e.id));
    ids('block').forEach(id => {
      if (edgeIds.has(id)) state.blockedEdges.add(id);
      else if (nodes.has(id) && nodes.get(id).type !== 'exit') state.blockedNodes.add(id);
    });
    ids('close').forEach(id => { if (nodes.has(id) && nodes.get(id).type === 'exit') state.closedExits.add(id); });
    const s = q.get('start');
    if (s && nodes.has(s) && nodes.get(s).type !== 'exit') start = s;
    if (q.get('lang') === 'bn' || q.get('lang') === 'en') lang = q.get('lang');
    render();
  }
})();
