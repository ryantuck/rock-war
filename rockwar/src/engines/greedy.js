// Greedy heuristic engine: scores every legal action and takes the best one.
// No search — just material, tempo, and position heuristics. Weights are
// exposed so you can tune behavior while iterating on rules.

import { legalPlacements, neighbors, xy, other } from '../game.js';

const DEFAULT_WEIGHTS = {
  killPerPoint: 12,     // per point of enemy material destroyed
  capture: 6,           // taking an enemy territory
  evolve: 10,           // consolidating into a bigger piece
  evolvePerPoint: 3,
  advancePerStep: 5,    // moving one step closer to the nearest enemy
  consolidate: 4,       // moving onto a friendly piece (enables evolve)
  spawn: 8,
  spawnDecayTurns: 30,  // spawning matters less as the game goes on
  costPenalty: 0.5,     // mild preference for cheaper actions
  passThreshold: 0,     // pass if the best score is below this
};

function manhattan(config, i, j) {
  const [x1, y1] = xy(config, i);
  const [x2, y2] = xy(config, j);
  return Math.abs(x1 - x2) + Math.abs(y1 - y2);
}

function enemyCells(state, army) {
  const out = [];
  state.cells.forEach((c, i) => { if (c.army === other(army)) out.push(i); });
  return out;
}

function distToNearestEnemy(state, army, i) {
  const es = enemyCells(state, army);
  if (es.length === 0) return 0;
  return Math.min(...es.map((e) => manhattan(state.config, i, e)));
}

export function makeGreedyEngine(opts = {}) {
  const W = { ...DEFAULT_WEIGHTS, ...opts };

  return {
    name: 'greedy',

    // Place scouts clustered together with a bias toward the center.
    placeScout(state, army, rng) {
      const { config } = state;
      const open = legalPlacements(state);
      const cx = (config.width - 1) / 2;
      const cy = (config.height - 1) / 2;
      let best = open[0];
      let bestScore = -Infinity;
      for (const i of open) {
        const [x, y] = xy(config, i);
        let score = -(Math.abs(x - cx) + Math.abs(y - cy)); // central
        for (const n of neighbors(config, i)) {
          if (state.cells[n].army === army) score += 2; // adjacent to own
          if (state.cells[n].army === other(army)) score -= 0.5;
        }
        score += rng() * 0.1; // tiebreak
        if (score > bestScore) { bestScore = score; best = i; }
      }
      return best;
    },

    chooseAction(state, ctx, acts, rng) {
      const { army } = ctx;
      let best = null;
      let bestScore = -Infinity;

      for (const a of acts) {
        let score = -a.cost * W.costPenalty + rng() * 0.1;

        if (a.type === 'attack') {
          const defCell = state.cells[a.to];
          const defSum = defCell.pieces.reduce((s, p) => s + p, 0);
          if (a.piece >= defSum) {
            // Likely kill (defenders may still retreat, but we take territory).
            score += defSum * W.killPerPoint + W.capture;
          } else {
            score -= 100; // attack would be repelled — never worth it
          }
        } else if (a.type === 'evolve') {
          const cell = state.cells[a.at];
          const sum = cell.pieces[0] + cell.pieces[1];
          score += W.evolve + sum * W.evolvePerPoint;
        } else if (a.type === 'move') {
          const before = distToNearestEnemy(state, army, a.from);
          const after = distToNearestEnemy(state, army, a.to);
          score += (before - after) * W.advancePerStep;
          if (state.cells[a.to].pieces.length > 0) score += W.consolidate;
        } else if (a.type === 'spawn') {
          score += W.spawn * Math.max(0, 1 - state.turn / W.spawnDecayTurns);
        }

        if (score > bestScore) { bestScore = score; best = a; }
      }

      if (bestScore < W.passThreshold) return null;
      return best;
    },

    // If the attack would destroy us (attacker >= our total), save what we can,
    // biggest pieces first. Otherwise stand and repel the attack.
    planRetreats(state, attackInfo, options, rng) {
      const total = options.reduce((s, o) => s + o.piece, 0);
      if (attackInfo.piece < total) return []; // attack fails; don't budge
      const plan = [];
      const sorted = [...options].sort((a, b) => b.piece - a.piece);
      for (const opt of sorted) {
        const dest = opt.dests[0] ?? opt.emptyDests[0];
        if (dest !== undefined) plan.push({ piece: opt.piece, dest });
      }
      return plan;
    },
  };
}
