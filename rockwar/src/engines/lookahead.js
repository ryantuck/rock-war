// Lookahead engine: one-ply search over a position evaluator.
//
// For every legal action it clones the state, actually applies the action
// (using the real rules engine, including combat), evaluates the resulting
// position, and subtracts the opponent's best immediate attack threat.
// This fixes greedy's two blind spots: walking into next-turn attacks, and
// not noticing when an action swings obelisk control.

import {
  legalPlacements, legalActions, applyAction, contingents, neighbors, xy,
  other, armyPieceCount, armyStrengthOnBoard, canAddPiece, obeliskBonuses,
  obeliskStatus, obeliskCells, obeliskElementBonus, combatRuleOf,
} from '../game.js';

const DEFAULT_WEIGHTS = {
  material: 10,     // per point of deployable strength difference
  pieces: 3,        // per board piece difference
  fighting: 4,      // per point of attack-capable board material (>= minAttackValue)
  territory: 1.5,   // per occupied territory difference
  obeliskHold: 5,   // per point of held bonus — control is an annuity, it
                    // pays budget every turn it's held
  obeliskProgress: 0.5, // per point of adjacency-margin toward each obelisk,
                    // so partial progress (first cell, more value) pays too
  obeliskFoothold: 2,   // having the 2-territory foothold at an obelisk
  obeliskCount: 5,      // quadratic pressure toward the control-all victory
  obeliskFadeAt: 12, // obelisk terms reach full value only while the enemy
                    // has at least this much deployable strength — budget
                    // annuities are worthless against a nearly-dead opponent
  hunt: 2,          // extra advance pressure per point of material dominance
  huntCap: 4,       // ...capped, so the hunt drive can't dwarf everything
  potential: 2,     // per point of evolve-ready pairs (sum in sideboard)
  threat: 3,        // per point the enemy's best reply attack would win
  myThreat: 6,      // per point our own best attack would win (keep pressure on)
  advance: 1.2,     // pull toward the enemy (avg distance, negated)
  spawnLock: 15,    // penalty for scouts being permanently entombed
  spawnTempo: 6,    // milder penalty when spawning is one unlocking move away
  costPenalty: 0.3, // budget spent is tempo spent
  passMargin: -3,   // act unless clearly harmful — passing doesn't freeze the
                    // game, the opponent moves next, so idling has real cost
  jitter: 0.05,     // random tiebreak
};

// Deployable strength: board material plus sideboard scouts (bigger sideboard
// pieces are frozen assets without scouts to evolve from). Permanently
// spawn-locked armies count their sideboard scouts as ZERO — a lone 3 can
// never re-open spawning; moving its only piece just relocates the lock.
function deployable(state, army) {
  const scouts = spawnAccess(state, army) === 2 ? 0 : (state.sideboard[army][1] || 0);
  return armyStrengthOnBoard(state, army) + scouts;
}

function territoryCount(state, army) {
  return state.cells.filter((c) => c.army === army).length;
}

// Attack-capable board material — scouts can't attack, so an army of scouts
// has zero fighting strength no matter its total value.
function fightingStrength(state, army) {
  const minAtk = state.config.minAttackValue ?? 1;
  let s = 0;
  for (const c of state.cells) {
    if (c.army === army) for (const p of c.pieces) if (p >= minAtk) s += p;
  }
  return s;
}

// Graded obelisk score: held control pays as an annuity, and progress toward
// control (adjacent value margin, the 2-territory foothold) pays on the way —
// a one-ply searcher can't chase a reward that only exists at the finish line.
function obeliskGradient(state, me, W) {
  const enemy = other(me);
  const topTier = (state.config.obeliskTiers ?? [3, 5, 8, 13])[3] ?? 13;
  let s = 0;
  let mine = 0;
  let theirs = 0;
  for (const ob of state.config.obelisks ?? []) {
    const st = obeliskStatus(state, ob);
    if (st.controller === me) mine++;
    else if (st.controller === enemy) theirs++;
    s += W.obeliskProgress *
      (Math.min(st.score[me], topTier) - Math.min(st.score[enemy], topTier));
    if (st.count[me] >= 2) s += W.obeliskFoothold;
    if (st.count[enemy] >= 2) s -= W.obeliskFoothold;
    if (st.controller === me) s += W.obeliskHold * st.bonus;
    else if (st.controller === enemy) s -= W.obeliskHold * st.bonus;
  }
  // Control-all victory pressure: each additional simultaneous hold matters
  // more than the last (the win itself is handled in evaluate()).
  if (state.config.obeliskVictory !== false) {
    s += W.obeliskCount * (mine * mine - theirs * theirs);
  }
  return s;
}

// Does `army` control enough obelisks for the instant win?
function controlsEnough(state, army) {
  if (state.config.obeliskVictory === false) return false;
  const obs = state.config.obelisks ?? [];
  const need = state.config.obeliskVictoryCount ?? obs.length;
  if (obs.length === 0 || need <= 0) return false;
  let held = 0;
  for (const ob of obs) if (obeliskStatus(state, ob).controller === army) held++;
  return held >= need;
}

// Evolve-ready pairs: cells whose two pieces could combine right now (the
// result is in the sideboard). This is how a one-ply evaluator learns that
// spawning next to a scout is a step toward building an attacker.
function evolvePotential(state, army) {
  let s = 0;
  for (const c of state.cells) {
    if (c.army !== army || c.pieces.length !== 2) continue;
    const sum = c.pieces[0] + c.pieces[1];
    if ((state.sideboard[army][sum] || 0) > 0) s += sum;
  }
  return s;
}

function avgDistToEnemy(state, army) {
  const mine = [];
  const theirs = [];
  state.cells.forEach((c, i) => {
    if (c.army === army) mine.push(i);
    else if (c.army === other(army)) theirs.push(i);
  });
  if (!mine.length || !theirs.length) return 0;
  let sum = 0;
  for (const m of mine) {
    const [x1, y1] = xy(state.config, m);
    let best = Infinity;
    for (const t of theirs) {
      const [x2, y2] = xy(state.config, t);
      best = Math.min(best, Math.abs(x1 - x2) + Math.abs(y1 - y2));
    }
    sum += best;
  }
  return sum / mine.length;
}

// How reachable is spawning? Scouts only stack with 1s and 2s, so:
//   0 — some cell accepts a scout right now
//   1 — one move away: a small piece (<=2) can step to an empty neighbor
//       (landing alone it hosts scouts, and leaving a stack frees a slot),
//       or a (1,1) can evolve into a scout-friendly 2
//   2 — permanently entombed: an army of lone 3s/5s/8s can shuffle forever
//       without ever creating a cell a scout may enter
// Transient fullness costs a move of tempo; permanence kills the sideboard.
function spawnAccess(state, army) {
  if ((state.sideboard[army][1] || 0) === 0) return 0; // nothing to deploy
  let oneMove = false;
  for (let i = 0; i < state.cells.length; i++) {
    const c = state.cells[i];
    if (c.army !== army) continue;
    if (canAddPiece(state.config, c, 1)) return 0;
    if (oneMove) continue;
    if (c.pieces.length === 2 && c.pieces[0] === 1 && c.pieces[1] === 1 &&
        (state.sideboard[army][2] || 0) > 0) {
      oneMove = true;
    } else if (c.pieces.some((p) => p <= 2) &&
               neighbors(state.config, i).some((n) => state.cells[n].army === null)) {
      oneMove = true;
    }
  }
  return oneMove ? 1 : 2;
}

// Best material swing the enemy could get with a single attack right now
// (no-retreat approximation; under margin rules an exact tie is an even
// trade, so only strict up-attacks count as threats).
function maxAttackThreat(state, enemy, W) {
  const { config } = state;
  const rule = combatRuleOf(config);
  const minAtk = config.minAttackValue ?? 1;
  const pool = obeliskBonuses(state, enemy);
  // Earth taxes the enemy's attacks on us; water halves what a loss costs us
  // (our fallen pieces return to the sideboard instead of dying).
  const earthTax = obeliskElementBonus(state, other(enemy), 'earth');
  const waterScale = obeliskElementBonus(state, other(enemy), 'water') > 0 ? 0.5 : 1;
  let best = 0;
  for (const cont of contingents(state, enemy)) {
    const budget = cont.strength + (pool.attack || 0);
    for (const t of cont.terrs) {
      const cell = state.cells[t];
      if (cell.army !== enemy) continue;
      for (const p of new Set(cell.pieces)) {
        if (p < minAtk || p + earthTax > budget) continue;
        for (const n of neighbors(config, t)) {
          const nc = state.cells[n];
          if (!nc.army || nc.army === enemy) continue;
          const defSum = nc.pieces.reduce((s, x) => s + x, 0);
          if (p > defSum) best = Math.max(best, defSum * waterScale);
          else if (p === defSum && rule === 'attacker-survives') {
            best = Math.max(best, defSum * waterScale);
          }
        }
      }
    }
  }
  return best;
}

function evaluate(state, me, W) {
  const enemy = other(me);
  const myPieces = armyPieceCount(state, me);
  const theirPieces = armyPieceCount(state, enemy);
  if (theirPieces === 0 && myPieces > 0) return 1e6;
  if (myPieces === 0 && theirPieces > 0) return -1e6;
  if (myPieces === 0 && theirPieces === 0) return 0;
  if (controlsEnough(state, me)) return 1e6;
  if (controlsEnough(state, enemy)) return -1e6;
  const myDep = deployable(state, me);
  const enemyDep = deployable(state, enemy);
  let score = 0;
  score += W.material * (myDep - enemyDep);
  score += W.pieces * (myPieces - theirPieces);
  score += W.fighting * (fightingStrength(state, me) - fightingStrength(state, enemy));
  score += W.territory * (territoryCount(state, me) - territoryCount(state, enemy));
  // Obelisk annuities fade as the enemy fades — against a nearly-dead
  // opponent, holding budget bonuses must never outbid finishing the game.
  score += Math.min(1, enemyDep / W.obeliskFadeAt) * obeliskGradient(state, me, W);
  score += W.potential * (evolvePotential(state, me) - evolvePotential(state, enemy));
  // Hunt drive: material dominance converts into pressure to close distance
  // and finish, so a won game gets won instead of drifting to the turn cap.
  const hunt = W.hunt * Math.min(W.huntCap, Math.max(0, myDep / Math.max(1, enemyDep) - 1));
  score -= (W.advance + hunt) * avgDistToEnemy(state, me);
  const accessMe = spawnAccess(state, me);
  const accessEnemy = spawnAccess(state, enemy);
  if (accessMe === 1) score -= W.spawnTempo;
  else if (accessMe === 2) score -= W.spawnLock;
  if (accessEnemy === 1) score += W.spawnTempo;
  else if (accessEnemy === 2) score += W.spawnLock;
  score -= W.threat * maxAttackThreat(state, enemy, W);
  score += W.myThreat * maxAttackThreat(state, me, W);
  return score;
}

// Principled defender policy used both when this engine defends for real and
// for the defenders inside simulations: stand when the attack fails or is an
// exact-tie trade (margin rule), otherwise save what can be saved — under
// 'mutual', leave the smallest piece to take the attacker down; under
// 'devolve' the attacker survives regardless, so material comes first.
function retreatPolicy(state, attackInfo, options) {
  const total = options.reduce((s, o) => s + o.piece, 0);
  if (attackInfo.piece < total) return [];
  const rule = combatRuleOf(state.config);
  if ((rule === 'margin' || rule === 'devolve') && attackInfo.piece === total) return [];
  const sorted = [...options].sort((a, b) => b.piece - a.piece);
  const retreaters = rule === 'mutual' ? sorted.slice(0, -1) : sorted;
  const plan = [];
  for (const opt of retreaters) {
    const dest = opt.dests[0] ?? opt.emptyDests[0];
    if (dest !== undefined) plan.push({ piece: opt.piece, dest });
  }
  return plan;
}

export function makeLookaheadEngine(opts = {}) {
  const W = { ...DEFAULT_WEIGHTS, ...opts };
  const simStub = { planRetreats: (s, info, options) => retreatPolicy(s, info, options) };
  const simEngines = { A: simStub, B: simStub };

  return {
    name: 'lookahead',

    // Same opening as greedy: clustered scouts near the center.
    placeScout(state, army, rng) {
      const { config } = state;
      const cx = (config.width - 1) / 2;
      const cy = (config.height - 1) / 2;
      let best = null;
      let bestScore = -Infinity;
      for (const i of legalPlacements(state)) {
        const [x, y] = xy(config, i);
        let score = -(Math.abs(x - cx) + Math.abs(y - cy));
        for (const n of neighbors(config, i)) {
          if (state.cells[n].army === army) score += 2;
          if (state.cells[n].army === other(army)) score -= 0.5;
        }
        for (const ob of config.obelisks ?? []) {
          if (obeliskCells(config, ob.corner).includes(i)) score += 1.5;
        }
        score += rng() * 0.1;
        if (score > bestScore) { bestScore = score; best = i; }
      }
      return best;
    },

    chooseAction(state, ctx, acts, rng) {
      const me = ctx.army;
      const baseline = evaluate(state, me, W) + W.passMargin;
      let best = null;
      let bestScore = baseline;
      for (const a of acts) {
        const clone = structuredClone({ ...state, log: [], events: null, captureSnapshots: false });
        applyAction(clone, me, a, simEngines, rng);
        const s = evaluate(clone, me, W) - W.costPenalty * a.cost + rng() * W.jitter;
        if (W.debug) console.log('  cand', JSON.stringify(a), '->', s.toFixed(2), '(baseline', baseline.toFixed(2) + ')');
        if (s > bestScore) { bestScore = s; best = a; }
      }
      return best;
    },

    planRetreats(state, attackInfo, options, rng) {
      return retreatPolicy(state, attackInfo, options);
    },

    // On the opponent's turn: simulate each available ability and fire the
    // best one if it genuinely improves our position (reactions are free, but
    // the fuel scout isn't — demand a real gain, not jitter).
    chooseReaction(state, army, opts, rng) {
      const baseline = evaluate(state, army, W) + 1;
      let best = null;
      let bestScore = baseline;
      for (const o of opts) {
        const clone = structuredClone({ ...state, log: [], events: null, captureSnapshots: false });
        applyAction(clone, army, o, simEngines, rng);
        const s = evaluate(clone, army, W) + rng() * W.jitter;
        if (s > bestScore) { bestScore = s; best = o; }
      }
      return best;
    },

    chooseContingents(state, conts, limit, rng) {
      return [...conts].sort((a, b) => b.strength - a.strength).slice(0, limit);
    },
  };
}
