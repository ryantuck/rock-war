// Obelisk-victory reach: can `army` complete an obelisk victory during its
// NEXT turn? Engines use this to see the threat coming (one-ply and
// own-turn search never model the opponent's turn) and to value setting up
// their own finish.
//
// Analytical estimate, no state cloning — cheap enough to run inside every
// position evaluation. For each obelisk the army doesn't control, it plays
// a greedy simulation on a light copy of the cells: repeatedly commit the
// affordable plan that most reduces the control deficit (count < 2, value
// below the first tier, not strictly ahead), under playTurn's budget rules
// (2 actions per contingent within its strength, spending budget before the
// type's obelisk pool; past the cap, extra actions fully funded by the pool;
// abilities only within the cap). Plans are 1-2 actions aimed at the target
// obelisk's adjacent territories ("ring"):
//   spawn into an own ring cell · move in from 1 or 2 steps away (or along
//   the ring to spread) · attack an enemy ring cell, from adjacent or after
//   a move · controlled obelisks' abilities: water bounce, fire damage, air
//   swap (optionally after moving a stack-mate out), earth level-up.
// Sources standing in a held obelisk's ring are only used if that obelisk
// stays controlled — the finish must keep everything already held.
//
// Validated against a real-rules search of the next turn (depth 4, pruned
// to obelisk-relevant actions): no false alarms, ~90%+ of finishes seen.
//
// Returns { held, need, deficit, lethal }: deficit 0 means the army can
// take the win next turn; Infinity when it holds fewer than need-1
// obelisks (not a next-turn threat).

import {
  contingents, obeliskBonuses, obeliskCells, obeliskStatus, neighbors,
  canAddPiece, moveCost, isFib, fibAdjacent, other, obeliskElementBonus, FIBS,
} from '../game.js';

const NONE = Object.freeze({ held: 0, need: Infinity, deficit: Infinity, lethal: false });

// Control status of an obelisk on a (possibly simulated) cells array.
function statusOn(cells, ring, army, tier0) {
  const enemy = other(army);
  let cX = 0, sX = 0, cY = 0, sY = 0;
  for (const i of ring) {
    const c = cells[i];
    if (c.army === army) { cX++; for (const p of c.pieces) sX += p; }
    else if (c.army === enemy) { cY++; for (const p of c.pieces) sY += p; }
  }
  return { cX, sX, cY, sY, controlled: cX >= 2 && sX >= tier0 && sX > sY };
}

// Distance (in missing units) from controlling the obelisk.
function deficitOf(st, tier0) {
  return Math.max(0, 2 - st.cX) + Math.max(0, tier0 - st.sX) + Math.max(0, st.sY + 1 - st.sX);
}

const sum = (ps) => ps.reduce((s, p) => s + p, 0);
const removeOne = (ps, p) => { const q = [...ps]; q.splice(q.indexOf(p), 1); return q; };
const setCell = (cs, i, army, pieces) => {
  const out = cs.slice();
  out[i] = { army: pieces.length ? army : null, pieces };
  return out;
};
const movePiece = (cs, a, r, army, p) =>
  setCell(setCell(cs, a, army, removeOne(cs[a].pieces, p)), r, army, [...cs[r].pieces, p]);

export function obeliskReach(state, army, trace = null) {
  const { config } = state;
  if (config.obeliskVictory === false) return NONE;
  const obs = config.obelisks ?? [];
  const need = config.obeliskVictoryCount ?? obs.length;
  if (obs.length === 0 || need <= 0) return NONE;
  const tier0 = (config.obeliskTiers ?? [3])[0];
  const enemy = other(army);

  const rings = obs.map((ob) => obeliskCells(config, ob.corner));
  const statuses = obs.map((ob) => obeliskStatus(state, ob));
  const heldIdx = [];
  statuses.forEach((st, k) => { if (st.controller === army) heldIdx.push(k); });
  const held = heldIdx.length;
  if (held >= need) return { held, need, deficit: 0, lethal: true };
  if (held < need - 1) return { held, need, deficit: Infinity, lethal: false };

  // Turn resources: per-contingent action slots and budget, army bonus pools.
  const conts = contingents(state, army);
  const contOf = new Map();
  conts.forEach((c, k) => { for (const t of c.terrs) contOf.set(t, k); });
  const cap = config.maxActionsPerContingent ?? 2;
  const pools0 = obeliskBonuses(state, army);
  const earthTax = obeliskElementBonus(state, enemy, 'earth');
  const minAtk = config.minAttackValue ?? 1;
  const scouts0 = state.sideboard[army][1] || 0;
  const used = state.abilitiesUsedThisTurn ?? [];
  const abilities0 = [];
  if (config.obeliskAbilities) {
    obs.forEach((ob, k) => {
      const st = statuses[k];
      if (st.controller !== army || st.bonus === 0 || used.includes(ob.element)) return;
      abilities0.push({ element: ob.element, k, maxFuel: st.bonus });
    });
  }

  let best = Infinity;
  for (let k = 0; k < obs.length && best > 0; k++) {
    if (statuses[k].controller === army) continue;
    best = Math.min(best, simulate(k));
  }
  return { held, need, deficit: best, lethal: best === 0 };

  function simulate(k) {
    const ringArr = rings[k];
    const ring = new Set(ringArr);
    let cells = state.cells.map((c) => ({ army: c.army, pieces: [...c.pieces] }));
    const owner = new Map(contOf);
    const slots = conts.map(() => cap);
    const budget = conts.map((c) => c.strength);
    const pools = { ...pools0 };
    let scouts = scouts0;
    let abilities = [...abilities0];
    let deficit = deficitOf(statusOn(cells, ringArr, army, tier0), tier0);
    const heldSafe = (cs) => heldIdx.every((h) => statusOn(cs, rings[h], army, tier0).controlled);

    // Spend plan for a sequence of steps [{type, cost, ability}] by contingent c:
    // each step takes a slot if one is left (budget first, then its pool),
    // otherwise it must be a pool-funded extra action (never an ability).
    function afford(c, steps) {
      if (c === undefined) return null;
      let s = slots[c], b = budget[c];
      const p = { ...pools };
      for (const st of steps) {
        if (s > 0) {
          if (st.ability) { s--; continue; }
          if (st.cost > b + (p[st.type] || 0)) return null;
          const fromB = Math.min(b, st.cost);
          b -= fromB; p[st.type] = (p[st.type] || 0) - (st.cost - fromB); s--;
        } else {
          if (st.ability || st.cost > (p[st.type] || 0)) return null;
          p[st.type] -= st.cost;
        }
      }
      return { c, slots: s, budget: b, pools: p };
    }

    for (let iter = 0; iter < 8 && deficit > 0; iter++) {
      let pick = null;
      // cand: { cont, steps, apply(cells) -> cells, tos: [cells entered], spawn, ability }
      const consider = (cand) => {
        const plan = afford(cand.cont, cand.steps);
        if (!plan) return;
        const next = cand.apply(cells);
        if (!next || !heldSafe(next)) return;
        const nd = deficitOf(statusOn(next, ringArr, army, tier0), tier0);
        const gain = deficit - nd;
        if (gain <= 0) return;
        const rank = gain * 10 - cand.steps.length;
        if (!pick || rank > pick.rank) pick = { rank, cand, plan, next, nd };
      };
      const canEnter = (i, p) => cells[i].army !== enemy && canAddPiece(config, cells[i], p);
      const stepCost = (p, i) => { const c = moveCost(p, cells[i]); return c >= 1 && isFib(c) ? c : 0; };

      // Spawns into own ring cells.
      if (scouts > 0) {
        for (const r of ringArr) {
          if (cells[r].army !== army || !canAddPiece(config, cells[r], 1)) continue;
          consider({ cont: owner.get(r), steps: [{ type: 'spawn', cost: 1 }], spawn: true, tos: [],
            apply: (cs) => setCell(cs, r, army, [...cs[r].pieces, 1]) });
        }
      }
      cells.forEach((c, a) => {
        if (c.army !== army) return;
        const cont = owner.get(a);
        for (const p of new Set(c.pieces)) {
          for (const n of neighbors(config, a)) {
            // One step into (or along) the ring.
            if (ring.has(n) && canEnter(n, p)) {
              const cost = stepCost(p, n);
              if (cost) consider({ cont, steps: [{ type: 'move', cost }], tos: [n], apply: (cs) => movePiece(cs, a, n, army, p) });
            }
            if (ring.has(a) || ring.has(n) || !canEnter(n, p)) continue;
            const c1 = stepCost(p, n);
            if (!c1) continue;
            for (const r of neighbors(config, n)) {
              if (!ring.has(r)) continue;
              // Two steps in.
              if (canEnter(r, p)) {
                const c2 = stepCost(p, r);
                if (c2) consider({ cont, steps: [{ type: 'move', cost: c1 }, { type: 'move', cost: c2 }], tos: [n, r],
                  apply: (cs) => movePiece(movePiece(cs, a, n, army, p), n, r, army, p) });
              }
              // Move adjacent, then attack.
              const rc = cells[r];
              if (rc.army === enemy && p >= minAtk && p >= sum(rc.pieces)) {
                const tie = p === sum(rc.pieces);
                consider({ cont, steps: [{ type: 'move', cost: c1 }, { type: 'attack', cost: p + earthTax }], tos: tie ? [n] : [n, r],
                  apply: (cs) => {
                    const out = movePiece(cs, a, n, army, p);
                    return setCell(setCell(out, n, army, removeOne(out[n].pieces, p)), r, army, tie ? [] : [p]);
                  } });
              }
            }
          }
          // Attack an adjacent enemy ring cell (devolved parts conserve value).
          for (const r of neighbors(config, a)) {
            const rc = cells[r];
            if (!ring.has(r) || rc.army !== enemy || p < minAtk || p < sum(rc.pieces)) continue;
            const tie = p === sum(rc.pieces);
            consider({ cont, steps: [{ type: 'attack', cost: p + earthTax }], tos: tie ? [] : [r],
              apply: (cs) => setCell(setCell(cs, a, army, removeOne(cs[a].pieces, p)), r, army, tie ? [] : [p]) });
          }
        }
      });
      // Abilities of controlled obelisks (fuel = largest allowed piece in its ring).
      for (const ab of abilities) {
        let fc = -1, F = 0;
        for (const t of rings[ab.k]) {
          if (cells[t].army !== army) continue;
          for (const p of cells[t].pieces) if (p <= ab.maxFuel && p > F) { F = p; fc = t; }
        }
        if (fc < 0) continue;
        const spend = (cs) => setCell(cs, fc, army, removeOne(cs[fc].pieces, F));
        const cont = owner.get(fc);
        const abStep = { type: 'ability', cost: 0, ability: true };
        for (const r of ringArr) {
          const rc = cells[r];
          if (ab.element === 'water' && rc.army === enemy) {
            for (const v of new Set(rc.pieces)) {
              if (v <= F) consider({ cont, steps: [abStep], ability: ab, tos: [], apply: (cs) => setCell(spend(cs), r, enemy, removeOne(cs[r].pieces, v)) });
            }
          } else if (ab.element === 'fire' && rc.army === enemy) {
            const left = Math.max(0, sum(rc.pieces) - F);
            const parts = left === 0 ? [] : [FIBS.filter((f) => f <= left).pop()];
            consider({ cont, steps: [abStep], ability: ab, tos: [], apply: (cs) => setCell(spend(cs), r, enemy, parts) });
          } else if (ab.element === 'air' && rc.army === enemy && rc.pieces.length === 1 && rc.pieces[0] <= F) {
            cells.forEach((mc, m) => {
              if (mc.army !== army || m === fc || ring.has(m)) return;
              const swap = (cs, mm) => {
                const out = spend(cs);
                const mine = out[mm].pieces, theirs = out[r].pieces;
                return setCell(setCell(out, mm, enemy, theirs), r, army, mine);
              };
              if (mc.pieces.length === 1 && mc.pieces[0] <= F) {
                consider({ cont, steps: [abStep], ability: ab, tos: [r], apply: (cs) => swap(cs, m) });
              } else if (mc.pieces.length === 2) {
                // Move one stack-mate out first so the other stands alone.
                for (const q of new Set(mc.pieces)) {
                  const stay = removeOne(mc.pieces, q)[0];
                  if (stay > F) continue;
                  for (const n of neighbors(config, m)) {
                    if (!canEnter(n, q)) continue;
                    const cq = stepCost(q, n);
                    if (!cq) continue;
                    consider({ cont, steps: [{ type: 'move', cost: cq }, abStep], ability: ab, tos: [n, r],
                      apply: (cs) => swap(movePiece(cs, m, n, army, q), m) });
                    break;
                  }
                }
              }
            });
          } else if (ab.element === 'earth' && rc.army === army) {
            for (const p of new Set(rc.pieces)) {
              if (r === fc && p === F && rc.pieces.filter((x) => x === p).length < 2) continue;
              if (!fibAdjacent(F, p) || (state.sideboard[army][F + p] || 0) <= 0) continue;
              if (!removeOne(rc.pieces, p).every((x) => fibAdjacent(x, F + p))) continue;
              consider({ cont, steps: [abStep], ability: ab, tos: [],
                apply: (cs) => { const out = spend(cs); return setCell(out, r, army, [...removeOne(out[r].pieces, p), F + p]); } });
            }
          }
        }
      }

      if (!pick) break;
      const { cand, plan, next } = pick;
      if (trace) trace.push({ obelisk: obs[k].element, steps: cand.steps.map((x) => x.type), tos: cand.tos, deficit: pick.nd });
      slots[plan.c] = plan.slots;
      budget[plan.c] = plan.budget;
      Object.assign(pools, plan.pools);
      if (cand.spawn) scouts--;
      if (cand.ability) abilities = abilities.filter((x) => x !== cand.ability);
      for (const t of cand.tos) owner.set(t, plan.c);
      cells = next;
      deficit = pick.nd;
    }
    return deficit;
  }
}

// How dangerous a reach deficit is, on a 0..1 scale: a next-turn finish
// (deficit 0) is the full threat; one or two units short still pays a
// fading share, so one-ply search gets a gradient to push the threat back
// (or, for its own reach, to walk a multi-action finish one step at a time).
export function reachDanger(deficit) {
  if (deficit <= 0) return 1;
  if (deficit === 1) return 0.3;
  if (deficit === 2) return 0.1;
  return 0;
}
