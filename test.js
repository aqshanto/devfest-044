// Run: node test.js — sample checks (PDF §4.1) + tie-break, disconnected and invalid-input cases.
const { validate, findRoute } = require('./router.js');
const sample = require('./building.json');

const S = (o = {}) => ({ blockedNodes: new Set(o.n || []), blockedEdges: new Set(o.e || []), closedExits: new Set(o.x || []) });
const show = r => r.status === 'ok' ? `${r.path.join('-')}; cost ${r.cost}` : r.status;
let fail = 0;
function check(name, got, want) {
  const ok = got === want;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `\n      got:  ${got}\n      want: ${want}`}`);
}

// Sample checks
check('Baseline', show(findRoute(sample, S(), 'R1')), 'R1-C1-C2-E1; cost 7');
check('Blocked junction C2', show(findRoute(sample, S({ n: ['C2'] }), 'R1')), 'R1-C1-C3-C4-E2; cost 11');
check('Exits closed', show(findRoute(sample, S({ x: ['E1', 'E2'] }), 'R1')), 'noRoute');
check('Different start R2', show(findRoute(sample, S(), 'R2')), 'R2-C3-C4-E2; cost 7');
check('Blocked start', show(findRoute(sample, S({ n: ['R1'] }), 'R1')), 'startBlocked');
check('Blocked edge L02', show(findRoute(sample, S({ e: ['L02'] }), 'R1')), 'R1-C1-C3-C4-E2; cost 11');

// Graph builder for custom cases
const g = (nodes, edges) => ({
  building: 'T',
  nodes: nodes.map(([id, type]) => ({ id, label: id, type, x: 0, y: 0 })),
  edges: edges.map(([from, to, cost], i) => ({ id: 'e' + i, from, to, cost })),
  initial_state: { blocked_nodes: [], blocked_edges: [], closed_exits: [] },
});

// Equal cost to two exits -> smallest exit ID
const tieExit = g([['S', 'room'], ['EB', 'exit'], ['EA', 'exit']], [['S', 'EB', 3], ['S', 'EA', 3]]);
check('Tie: smallest exit ID', show(findRoute(tieExit, S(), 'S')), 'S-EA; cost 3');

// Equal cost paths to same exit -> lexicographically smallest sequence
const tiePath = g([['S', 'room'], ['B', 'junction'], ['A', 'junction'], ['E', 'exit']], [['S', 'B', 1], ['B', 'E', 1], ['S', 'A', 1], ['A', 'E', 1]]);
check('Tie: lexicographic path', show(findRoute(tiePath, S(), 'S')), 'S-A-E; cost 2');

// Cost beats hop count
const hops = g([['S', 'room'], ['A', 'junction'], ['B', 'junction'], ['E', 'exit']], [['S', 'E', 10], ['S', 'A', 1], ['A', 'B', 1], ['B', 'E', 1]]);
check('Cost not hops', show(findRoute(hops, S(), 'S')), 'S-A-B-E; cost 3');

// Closed exit cannot be crossed
const through = g([['S', 'room'], ['E1', 'exit'], ['E2', 'exit']], [['S', 'E1', 1], ['E1', 'E2', 1]]);
check('Closed exit not crossed', show(findRoute(through, S({ x: ['E1'] }), 'S')), 'noRoute');

// Disconnected graph
const disc = g([['S', 'room'], ['R', 'room'], ['E', 'exit']], [['R', 'E', 1]]);
check('Disconnected', show(findRoute(disc, S(), 'S')), 'noRoute');

// Alternatives: best route per exit, sorted by cost
const { routesByExit } = require('./router.js');
check('Alternatives per exit', routesByExit(sample, S(), 'R1').map(r => `${r.exit}:${r.cost}`).join(','), 'E1:7,E2:10');

// Validation
check('Sample is valid', validate(sample).length, 0);
const bad = (name, mut) => { const d = JSON.parse(JSON.stringify(sample)); mut(d); check('Reject: ' + name, validate(d).length > 0, true); };
bad('empty building', d => { d.building = ''; });
bad('duplicate node id', d => { d.nodes[1].id = 'R1'; });
bad('bad type', d => { d.nodes[0].type = 'hall'; });
bad('non-numeric x', d => { d.nodes[0].x = '5'; });
bad('unknown edge node', d => { d.edges[0].to = 'ZZ'; });
bad('self-loop', d => { d.edges[0].to = 'R1'; });
bad('repeated pair', d => { d.edges.push({ id: 'L99', from: 'C1', to: 'R1', cost: 1 }); });
bad('zero cost', d => { d.edges[0].cost = 0; });
bad('float cost', d => { d.edges[0].cost = 1.5; });
bad('missing initial_state', d => { delete d.initial_state; });
bad('blocked exit as node', d => { d.initial_state.blocked_nodes = ['E1']; });
bad('closed room as exit', d => { d.initial_state.closed_exits = ['R1']; });
bad('unknown blocked edge', d => { d.initial_state.blocked_edges = ['L77']; });
bad('no exit', d => { d.nodes.forEach(n => { if (n.type === 'exit') n.type = 'room'; }); });
bad('too few nodes', d => { d.nodes = d.nodes.slice(0, 1); });

console.log(fail ? `\n${fail} FAILED` : '\nAll tests passed');
process.exit(fail ? 1 : 0);
