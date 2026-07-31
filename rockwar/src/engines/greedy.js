// Greedy heuristic engine: scores every legal action and takes the best one.
// No search — just material, tempo, and position heuristics. Weights are
// exposed so you can tune behavior while iterating on rules.

import { legalPlacements, neighbors, xy, other, armyPieceCount, armyStrengthOnBoard, canAddPiece, combatRuleOf, obeliskCells, obeliskStatus } from '../game.js';

const DEFAULT_WEIGHTS = {
  killPerPoint: 12,     // per point of enemy material destroyed
  capture: 6,           // taking an enemy territory
  trade: 8,             // base value of forcing combat (mutual destruction)
  devolvePenalty: 5,    // attacking through a stiff defense splits our piece
  ability: { fire: 8, water: 10, earth: 8, air: 4 }, // base scores per obelisk ability
  evolve: 10,           // consolidating into a bigger piece
  evolvePerPoint: 3,
  advancePerStep: 5,    // moving one step closer to the nearest enemy
  consolidate: 4,       // moving onto a friendly piece (enables evolve)
  expand: 3,            // moving into an empty territory (spawn real estate)
  spawnUnlock: 12,      // expanding when no cell can currently accept a scout
  obeliskAdj: 2,        // per uncontrolled obelisk touching a cell we move/spawn into
  obeliskControl: 8,    // an action that would complete obelisk control
  presencePenalty: 25,  // evolving down to <=2 board pieces is a trap
  spawnLockPenalty: 40, // evolving into a position where no cell can accept a
                        // scout (1 only stacks with 1 or 2) freezes the army
  spawn: 8,
  spawnDecayTurns: 30,  // spawning matters less as the game goes on...
  spawnFloor: 3,        // ...but board presence never stops mattering
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

// Deployable strength: board material plus sideboard scouts. Bigger sideboard
// pieces only re-enter through evolves, which need board pairs — without
// scouts they're frozen assets, so they don't count toward fighting strength.
function totalStrength(state, army) {
  return armyStrengthOnBoard(state, army) + (state.sideboard[army][1] || 0);
}

// Score the obelisk value of putting `pieceValue` onto cell `target`:
// a pull toward any obelisk we don't yet control, plus a big bonus when the
// action would complete control (>=2 cells, >= first tier, strictly ahead).
// A move that starts from a cell adjacent to the same obelisk contributes no
// pull at all — shuttling within the adjacency set is not progress, and
// crediting it created engines that shuffled one piece forever chasing
// phantom control.
function obeliskPull(state, army, target, pieceValue, W, from = null) {
  const { config } = state;
  const tiers = config.obeliskTiers ?? [3, 5, 8, 13, 21, 34];
  let s = 0;
  for (const ob of config.obelisks ?? []) {
    const adj = obeliskCells(config, ob.corner);
    if (!adj.includes(target)) continue;
    if (from !== null && adj.includes(from)) continue; // shuttle, not progress
    const st = obeliskStatus(state, ob);
    if (st.controller === army) continue; // already ours
    s += W.obeliskAdj;
    const newCount = st.count[army] + (state.cells[target].army === army ? 0 : 1);
    const newScore = st.score[army] + pieceValue;
    if (newCount >= 2 && newScore >= tiers[0] && newScore > st.score[other(army)]) {
      s += W.obeliskControl;
    }
  }
  return s;
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
        for (const ob of config.obelisks ?? []) {
          if (obeliskCells(config, ob.corner).includes(i)) score += 1.5;
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
          const rule = combatRuleOf(state.config);
          const attackerDies = rule === 'mutual' ||
            ((rule === 'margin' || rule === 'devolve') && a.piece === defSum);
          if (a.piece < defSum) {
            score -= 100; // attack would be repelled — never worth it
          } else if (attackerDies) {
            // Tie or mutual rule: we die with them — value as a trade, only
            // from a position of strength.
            const mine = totalStrength(state, army);
            const theirs = totalStrength(state, other(army));
            score += (defSum - a.piece) * W.killPerPoint + (mine >= theirs ? W.trade : -W.trade);
            if (armyPieceCount(state, army) <= 1) score -= 1000;
          } else if (rule === 'devolve') {
            // Defenders die and we keep our value (possibly split into
            // constituents) — attacking is material-profitable; devolution
            // only costs concentration and the tempo to re-evolve.
            const devolves = defSum > a.piece * (state.config.devolveThreshold ?? 0.5);
            score += defSum * W.killPerPoint + W.capture - (devolves ? W.devolvePenalty : 0);
          } else {
            score += defSum * W.killPerPoint + W.capture;
          }
        } else if (a.type === 'evolve') {
          const cell = state.cells[a.at];
          const sum = cell.pieces[0] + cell.pieces[1];
          score += W.evolve + sum * W.evolvePerPoint;
          if (armyPieceCount(state, army) <= 2) score -= W.presencePenalty;
          // Would this evolve leave us nowhere to spawn? A scout only stacks
          // with a 1 or 2, so a board of lone 3s/5s is frozen forever.
          if ((state.sideboard[army][1] || 0) > 0 && sum > 2) {
            const elsewhere = state.cells.some(
              (c, i) => i !== a.at && c.army === army && canAddPiece(state.config, c, 1)
            );
            if (!elsewhere) score -= W.spawnLockPenalty;
          }
        } else if (a.type === 'move') {
          const before = distToNearestEnemy(state, army, a.from);
          const after = distToNearestEnemy(state, army, a.to);
          score += (before - after) * W.advancePerStep;
          score += obeliskPull(state, army, a.to, a.piece, W, a.from);
          const target = state.cells[a.to];
          if (target.pieces.length > 0) {
            // Stacking is only worth it if it sets up an available evolve and
            // doesn't collapse our board presence into a single stack.
            const sum = target.pieces[0] + a.piece;
            const canEvolve = (state.sideboard[army][sum] || 0) > 0;
            if (canEvolve && armyPieceCount(state, army) > 2) score += W.consolidate;
          } else if (state.cells[a.from].pieces.length === 2) {
            // Splitting a pair into an empty cell genuinely grows our footprint
            // (moving a lone piece just relocates it).
            score += W.expand;
            // If no cell of ours can accept a scout, expansion re-opens spawning.
            if (state.sideboard[army][1] > 0 &&
                !state.cells.some((c) => c.army === army && canAddPiece(state.config, c, 1))) {
              score += W.spawnUnlock;
            }
          }
        } else if (a.type === 'spawn') {
          const decay = Math.max(0, 1 - state.turn / W.spawnDecayTurns);
          score += Math.max(W.spawn * decay, W.spawnFloor);
          score += obeliskPull(state, army, a.to, 1, W);
        } else if (a.type === 'coordAttack') {
          // Sum the per-territory outcomes: ties trade, breaks kill, stiff
          // defenses devolve us. Coordination's retreat-denial upside isn't
          // modeled here — the flat bonus stands in for it.
          const rule = combatRuleOf(state.config);
          const byTarget = new Map();
          for (const st of a.strikes) {
            byTarget.set(st.to, (byTarget.get(st.to) || 0) + st.piece);
          }
          let killed = 0;
          let lost = 0;
          let devols = 0;
          for (const [t, S] of byTarget) {
            const D = state.cells[t].pieces.reduce((s, x) => s + x, 0);
            killed += D;
            if (rule === 'mutual' || ((rule === 'margin' || rule === 'devolve') && S === D)) lost += S;
            else if (rule === 'devolve' && D > S * (state.config.devolveThreshold ?? 0.5)) devols++;
          }
          score += (killed - lost) * W.killPerPoint - devols * W.devolvePenalty + W.capture;
          if (lost > 0) {
            const mine = totalStrength(state, army);
            const theirs = totalStrength(state, other(army));
            score += mine >= theirs ? W.trade : -W.trade;
            if (armyPieceCount(state, army) <= a.strikes.length) score -= 1000;
          }
        } else if (a.type === 'ability') {
          // Water bounces cost us nothing permanent; fire is an even trade at
          // range; earth neutralizes an attacker; air repositions.
          score += W.ability[a.element] ?? 5;
        }

        if (score > bestScore) { bestScore = score; best = a; }
      }

      if (bestScore < W.passThreshold) return null;
      return best;
    },

    // If the attack would connect (attacker >= our total), save what we can,
    // biggest pieces first. Under 'devolve' the attacker survives in some
    // form no matter what, so saving material always comes first. Under
    // 'mutual', deliberately leave the smallest piece behind — it takes the
    // attacker down with it. Under 'margin', an exact tie kills the attacker,
    // so stand and trade. Otherwise stand only when the attack is repelled.
    planRetreats(state, attackInfo, options, rng) {
      const total = options.reduce((s, o) => s + o.piece, 0);
      if (attackInfo.piece < total) return []; // attack fails; don't budge
      const rule = combatRuleOf(state.config);
      if ((rule === 'margin' || rule === 'devolve') && attackInfo.piece === total) {
        return []; // exact tie kills the attacker too — stand and trade
      }
      const sorted = [...options].sort((a, b) => b.piece - a.piece);
      const retreaters = rule === 'mutual' ? sorted.slice(0, -1) : sorted;
      const plan = [];
      for (const opt of retreaters) {
        const dest = opt.dests[0] ?? opt.emptyDests[0];
        if (dest !== undefined) plan.push({ piece: opt.piece, dest });
      }
      return plan;
    },

    // On the opponent's turn, fire off any ability whose flat value clears
    // the bar — abilities cost no tempo as reactions, so use them freely.
    chooseReaction(state, army, opts, rng) {
      let best = null;
      let bestScore = 6; // air (4) stays holstered; the rest are worth it
      for (const o of opts) {
        const s = (W.ability[o.element] ?? 5) + rng() * 0.1;
        if (s > bestScore) { bestScore = s; best = o; }
      }
      return best;
    },

    // First-turn handicap: act with the strongest contingent(s).
    chooseContingents(state, conts, limit, rng) {
      return [...conts].sort((a, b) => b.strength - a.strength).slice(0, limit);
    },
  };
}
