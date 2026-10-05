// Smart Escape: validation + routing. Pure functions, no DOM.
(function (root) {
  'use strict';

  const TYPES = ['room', 'junction', 'exit'];

  // Returns an array of {key, params} errors; empty array means valid.
  function validate(data) {
    const errs = [];
    const err = (key, params) => errs.push({ key, params: params || {} });

    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      err('errNotObject');
      return errs;
    }
    if (typeof data.building !== 'string' || !data.building.trim()) err('errBuilding');

    if (!Array.isArray(data.nodes)) { err('errNodesArray'); return errs; }
    if (!Array.isArray(data.edges)) { err('errEdgesArray'); return errs; }
    if (data.nodes.length < 2 || data.nodes.length > 60) err('errNodeCount', { n: data.nodes.length });
    if (data.edges.length < 1 || data.edges.length > 150) err('errEdgeCount', { n: data.edges.length });

    const nodeById = new Map();
    data.nodes.forEach((n, i) => {
      if (!n || typeof n !== 'object') { err('errNodeShape', { i }); return; }
      if (typeof n.id !== 'string' || !n.id) { err('errNodeId', { i }); return; }
      if (nodeById.has(n.id)) err('errDupNode', { id: n.id });
      nodeById.set(n.id, n);
      if (typeof n.label !== 'string' || !n.label.trim()) err('errNodeLabel', { id: n.id });
      if (!TYPES.includes(n.type)) err('errNodeType', { id: n.id });
      if (typeof n.x !== 'number' || !isFinite(n.x) || typeof n.y !== 'number' || !isFinite(n.y)) err('errNodeXY', { id: n.id });
    });

    const types = [...nodeById.values()].map(n => n.type);
    if (!types.some(t => t === 'room' || t === 'junction')) err('errNeedRoom');
    if (!types.includes('exit')) err('errNeedExit');

    const edgeIds = new Set();
    const pairs = new Set();
    data.edges.forEach((e, i) => {
      if (!e || typeof e !== 'object') { err('errEdgeShape', { i }); return; }
      if (typeof e.id !== 'string' || !e.id) { err('errEdgeId', { i }); return; }
      if (edgeIds.has(e.id)) err('errDupEdge', { id: e.id });
      edgeIds.add(e.id);
      if (!nodeById.has(e.from) || !nodeById.has(e.to)) { err('errEdgeEnds', { id: e.id }); return; }
      if (e.from === e.to) err('errSelfLoop', { id: e.id });
      const key = [e.from, e.to].sort().join('\u0000');
      if (pairs.has(key)) err('errDupPair', { id: e.id });
      pairs.add(key);
      if (!Number.isInteger(e.cost) || e.cost <= 0) err('errCost', { id: e.id });
    });

    const st = data.initial_state;
    if (!st || typeof st !== 'object' || Array.isArray(st)) {
      err('errState');
    } else {
      ['blocked_nodes', 'blocked_edges', 'closed_exits'].forEach(k => {
        if (!Array.isArray(st[k])) { err('errStateArray', { k }); return; }
        st[k].forEach(id => {
          if (k === 'blocked_edges') {
            if (!edgeIds.has(id)) err('errStateRef', { k, id });
          } else {
            const n = nodeById.get(id);
            const ok = n && (k === 'closed_exits' ? n.type === 'exit' : n.type !== 'exit');
            if (!ok) err('errStateRef', { k, id });
          }
        });
      });
    }
    return errs;
  }

  // Lexicographic comparison of node-ID sequences.
  function lexLess(a, b) {
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) {
      if (a[i] !== b[i]) return a[i] < b[i];
    }
    return a.length < b.length;
  }

  function better(c1, p1, c2, p2) {
    return c1 < c2 || (c1 === c2 && lexLess(p1, p2));
  }

  // state: {blockedNodes:Set, blockedEdges:Set, closedExits:Set}
  // Returns {status:'ok', path, edges, exit, cost} | {status:'noStart'|'startBlocked'|'noRoute'}
  function findRoute(data, state, start) {
    const r = search(data, state, start);
    if (r.status) return r;
    const list = exitRoutes(r);
    if (!list.length) return { status: 'noRoute' };
    return Object.assign({ status: 'ok' }, list[0]);
  }

  // Best route to every reachable open exit, sorted by cost then exit ID.
  function routesByExit(data, state, start) {
    const r = search(data, state, start);
    return r.status ? [] : exitRoutes(r);
  }

  function exitRoutes(r) {
    const list = [];
    for (const [id, b] of r.best) {
      if (r.nodeById.get(id).type === 'exit') list.push({ exit: id, cost: b.cost, path: b.path, edges: b.edges });
    }
    return list.sort((a, b) => a.cost - b.cost || (a.exit < b.exit ? -1 : 1));
  }

  function search(data, state, start) {
    const nodeById = new Map(data.nodes.map(n => [n.id, n]));
    const s = nodeById.get(start);
    if (!s || s.type === 'exit') return { status: 'noStart' };
    if (state.blockedNodes.has(start)) return { status: 'startBlocked' };

    const usable = id => {
      const n = nodeById.get(id);
      if (n.type === 'exit') return !state.closedExits.has(id);
      return !state.blockedNodes.has(id);
    };

    const adj = new Map(data.nodes.map(n => [n.id, []]));
    data.edges.forEach(e => {
      if (state.blockedEdges.has(e.id) || !usable(e.from) || !usable(e.to)) return;
      adj.get(e.from).push({ to: e.to, cost: e.cost, id: e.id });
      adj.get(e.to).push({ to: e.from, cost: e.cost, id: e.id });
    });

    // Dijkstra with (cost, path) ordering. Graph ≤ 60 nodes, so O(V^2) selection is fine.
    const best = new Map([[start, { cost: 0, path: [start], edges: [] }]]);
    const done = new Set();
    for (;;) {
      let u = null;
      for (const [id, b] of best) {
        if (done.has(id)) continue;
        if (u === null || better(b.cost, b.path, best.get(u).cost, best.get(u).path)) u = id;
      }
      if (u === null) break;
      done.add(u);
      if (nodeById.get(u).type === 'exit') continue; // reaching an exit ends the route
      const bu = best.get(u);
      for (const a of adj.get(u)) {
        if (done.has(a.to)) continue;
        const c = bu.cost + a.cost;
        const p = bu.path.concat(a.to);
        const cur = best.get(a.to);
        if (!cur || better(c, p, cur.cost, cur.path)) {
          best.set(a.to, { cost: c, path: p, edges: bu.edges.concat(a.id) });
        }
      }
    }

    return { best, nodeById };
  }

  const api = { validate, findRoute, routesByExit, lexLess };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Router = api;
})(this);
