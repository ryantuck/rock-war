// Random engine: uniformly random legal choices. Baseline for rule iteration —
// if a heuristic engine can't beat this, the heuristic (or the rules) need work.

import { legalPlacements } from '../game.js';

export function makeRandomEngine({ passChance = 0.1 } = {}) {
  return {
    name: 'random',

    placeScout(state, army, rng) {
      return rng.pick(legalPlacements(state));
    },

    chooseAction(state, ctx, acts, rng) {
      if (rng() < passChance) return null;
      return rng.pick(acts);
    },

    chooseContingents(state, conts, limit, rng) {
      const pool = [...conts];
      const out = [];
      while (out.length < limit && pool.length) {
        out.push(pool.splice(rng.int(pool.length), 1)[0]);
      }
      return out;
    },

    // Retreat each piece with 50% probability, preferring own territories.
    planRetreats(state, attackInfo, options, rng) {
      const plan = [];
      for (const opt of options) {
        if (rng() < 0.5) continue;
        const dests = opt.dests.length ? opt.dests : opt.emptyDests;
        if (dests.length) plan.push({ piece: opt.piece, dest: rng.pick(dests) });
      }
      return plan;
    },
  };
}
