// Scout placement heuristics shared by the greedy and lookahead families.
//
// Styles (engine option `placement`):
//   'single'        one contingent: central, next to our own scouts, toward
//                   obelisk territories (the original heuristic, unchanged)
//   'split'         two contingents (the engines' default): open a second
//                   group away from the first, then grow the smaller one;
//                   never merge them
//   '...-stack'     either of the above, also doubling up on our own lone
//                   scouts (up to two pairs) when the rules allow it
//                   (placementStacking) — a (1,1) pair evolves to a soldier
//                   from turn 1. Without '-stack', engines never stack.

import { legalPlacements, neighbors, xy, other, obeliskCells, contingents } from '../game.js';

export const PLACEMENT_STYLES = ['single', 'single-stack', 'split', 'split-stack'];
const MAX_STACKS = 2;

export function choosePlacement(state, army, rng, style = 'single') {
  const { config } = state;
  const split = style.startsWith('split');
  const stack = style.endsWith('-stack');
  const cx = (config.width - 1) / 2;
  const cy = (config.height - 1) / 2;
  const rings = (config.obelisks ?? []).map((ob) => obeliskCells(config, ob.corner));
  const enemy = other(army);
  const stacks = state.cells.filter((c) => c.army === army && c.pieces.length === 2).length;
  // Contingent id per own territory, for split placement.
  const groups = split ? contingents(state, army) : [];
  const groupOf = new Map();
  groups.forEach((g, k) => { for (const t of g.terrs) groupOf.set(t, k); });
  const smallest = groups.length ? groups.reduce((m, g, k) => (g.strength < groups[m].strength ? k : m), 0) : -1;

  let best = null;
  let bestScore = -Infinity;
  for (const i of legalPlacements(state)) {
    const [x, y] = xy(config, i);
    let score = -(Math.abs(x - cx) + Math.abs(y - cy));
    const isStack = state.cells[i].army === army;
    const adjGroups = new Set();
    let ownAdj = 0;
    for (const n of neighbors(config, i)) {
      if (state.cells[n].army === army) { ownAdj++; if (split) adjGroups.add(groupOf.get(n)); }
      if (state.cells[n].army === enemy) score -= 0.5;
    }
    for (const ring of rings) if (ring.includes(i)) score += 1.5;
    if (isStack) {
      // Doubling up adds value, not territory: only when the style asks.
      score += stack && stacks < MAX_STACKS ? 4 : -100;
    } else if (!split || groups.length === 0) {
      score += 2 * ownAdj; // original clustering pull
    } else if (groups.length < 2) {
      // Open the second group: not touching the first, a little away from it.
      score += ownAdj === 0 ? 3 + Math.min(2, distToOwn(state, army, i) - 1) * 0.5 : -3;
    } else if (adjGroups.size >= 2) {
      score -= 6; // would merge the two groups
    } else if (adjGroups.size === 1) {
      score += [...adjGroups][0] === smallest ? 3 : 1.5; // grow, smaller first
    } else {
      score -= 2; // a third group spreads too thin
    }
    score += rng() * 0.1; // tiebreak
    if (score > bestScore) { bestScore = score; best = i; }
  }
  return best;
}

function distToOwn(state, army, i) {
  const { config } = state;
  const [x, y] = xy(config, i);
  let d = Infinity;
  state.cells.forEach((c, j) => {
    if (c.army !== army) return;
    const [x2, y2] = xy(config, j);
    d = Math.min(d, Math.abs(x - x2) + Math.abs(y - y2));
  });
  return d;
}
