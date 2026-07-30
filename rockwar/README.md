# Rock War (v2 sandbox)

A self-contained implementation of the board game with two AI engines, a CLI
batch simulator, and a browser frontend — built for iterating on rules fast.
No dependencies, no build step; the same ES modules run in Node and the browser.

## Run it

```sh
cd rockwar

# Batch-simulate games from the CLI
node src/sim.js --games 500 --a greedy --b random --seed 42
node src/sim.js --games 500 --a greedy --b greedy
node src/sim.js --games 100 --a greedy --b random --verbose   # per-game lines
node src/sim.js --games 500 --a greedy --b random --config my-rules.json

# Frontend (ES modules need a server; any static server works)
python3 -m http.server 8000
# then open http://localhost:8000
```

The frontend lets you watch games turn-by-turn or auto-play, edit the rules
config as JSON (applies on New game), and run batches of hundreds of games
in-browser with the same stats as the CLI.

## Rules as implemented

- **Board**: 5×5 grid of 25 territories, orthogonal adjacency.
- **Armies**: each side's sideboard holds 8×1 (scouts), 5×2 (warriors),
  3×3 (chieftains), 2×5 (warlords), 1×8 (behemoth) — fibonacci counts of
  fibonacci values, 45 points total.
- **Placement**: snake order (A B B A), one scout per slot onto any empty
  territory, until each army has placed `initialScouts` (default 2). Remaining
  sideboard pieces — including the other scouts — enter play by spawning and
  evolving. Then A moves first.
- **Territories** hold at most 2 pieces, which must be fibonacci-adjacent:
  (1,1), (1,2), (2,3), (3,5), (5,8).
- **Contingents**: a maximal contiguous group of one army's territories.
  Its strength is the sum of its piece values.
- **Turns**: on your turn, each of your contingents (snapshotted at turn start)
  takes up to 2 actions whose fibonacci-valued costs sum to at most the
  contingent's strength. Territories a contingent captures or moves into
  mid-turn count as part of it for its remaining action.
- **Actions**:
  - *Spawn* (cost 1): place a scout from the sideboard into one of the
    contingent's territories.
  - *Move* (cost = |mover − occupant|, empty counts as 0, scouts always cost 1):
    move a piece to an adjacent empty or friendly territory, respecting the
    2-piece / fib-adjacency limits. Example: a 3 into open territory costs 3; a
    3 onto a friendly 2 costs 1.
  - *Evolve* (cost = smaller constituent, configurable): combine the two
    co-located pieces into their fibonacci sum (1+1→2, 1+2→3, 2+3→5). Both
    constituents return to the sideboard; the new piece must be available there.
  - *Attack* (cost = attacking piece's value): strike an adjacent enemy
    territory with one piece. **Scouts cannot attack** (`minAttackValue: 2`),
    and attacking requires the piece's value to be **≥ the target
    territory's total** — weaker attacks could never connect, so they are
    simply illegal.
- **Combat**: the defender may retreat each piece for free into an adjacent
  territory it occupies (respecting stacking limits), plus up to 1 scout per
  attack may retreat into an adjacent *empty* territory. Then the defenders
  that stayed all die (a legal attack always starts ≥ the full stack, and
  retreats only lower the defense), and the attacker's fate depends on how
  stiff the broken defense was (devolve rule):
  - defense **> ½** the attacker's value → the attacker **devolves** into its
    fibonacci constituents (3→2+1, 5→3+2, 8→5+3, 2→1+1), exchanged through
    the sideboard like evolution in reverse. A 3 attacking a (2) kills the 2
    and lands as a (2,1); a 3 attacking a (2,1) kills both and likewise
    devolves. Value is conserved — the price is concentration and the tempo
    to re-evolve. (If the sideboard lacks a constituent, that part is lost.)
  - defense **≤ ½** the attacker's value → the attacker survives intact
    (a 3 attacking a lone (1): the 1 just dies).
  Either way the attacker advances into the captured territory (every
  constituent pair is fib-adjacent, so it fits). If every defender retreats,
  no combat happens and the attacker advances whole.
- **First-turn handicap**: on turn 1, the opening player acts with only one
  contingent (their engine chooses which) and it takes only one action.
  Tunable via `firstTurnContingents` / `firstTurnActions`.
- **Obelisks**: four elemental obelisks sit on corner points where four
  territories meet — fire (red) at [1,1], earth (green) at [4,1], air
  (yellow) at [1,4], water (blue) at [4,4]. Each maps to a mechanic:
  fire → attack, earth → evolve, air → move, water → spawn. An army
  *controls* an obelisk by occupying **at least 2** of its adjacent
  territories with the **strictly greatest** total adjacent piece value of
  **at least 3**. Control grants bonus budget for that mechanic, scaling
  fibonacci with adjacent value: ≥3 → +1, ≥5 → +2, ≥8 → +3, ≥13 → +5,
  ≥21 → +8, … The bonus is an army-wide per-turn pool that refreshes each
  turn while control holds, and it **breaks the 2-action cap**: after a
  contingent's normal actions, it may keep taking extra actions whose full
  cost is covered by the matching pool — e.g. with fire control, spawn,
  evolve, then attack on the fire kicker. (Within the cap, actions spend
  contingent budget first so the kicker stays available for extras.)
- **Obelisk abilities**: each controlled obelisk also grants an active
  ability, once per obelisk per turn. Abilities cost no budget — the piece
  spent is the price — but count as actions, and have unlimited range:
  - *fire*: sacrifice one of your scouts to slay an enemy scout in any
    territory (both leave the game).
  - *water*: return one of your scouts to your sideboard to bounce an enemy
    piece of strength ≤ 2 back to its owner's sideboard.
  - *earth*: devolve one of your lone warriors (in place, to (1,1)) to
    devolve an enemy lone warrior the same way.
  - *air*: return one of your warriors to your sideboard to displace an
    enemy piece of strength ≤ 2 into an adjacent legal territory of your
    choice.
  Disable with `obeliskAbilities: false`.
- **Winning**: eliminate all enemy pieces from the board, or leave the enemy
  with no legal action on their turn. If a combat wipes both boards at once,
  the game is a draw (`mutual-elimination`). Games also draw at the turn limit.

## Assumptions made where the spec was open (all tunable)

The point of this sandbox is rule iteration, so every judgment call is a knob
in `defaultConfig()` (`src/game.js`) — editable live in the frontend's config
box or via `--config file.json` on the CLI:

| Knob | Default | The call that was made |
|---|---|---|
| `maxActionsPerContingent` | 2 | "two types of actions" read as *at most two actions per contingent per turn* |
| budget | ≤ strength | action costs sum *up to* strength (exact sums are usually impossible with 2 fib values) |
| `evolveCost` | `'smaller'` | evolve's cost wasn't specified; also supports `'larger'` and `'result'` |
| `scoutRetreatBudget` | 1 | read as *1 scout per attack* may flee to an empty territory |
| `combatRule` | `'devolve'` | attacker devolves through stiff defense; also `'margin'` (dies on exact tie), `'mutual'` (always dies), `'attacker-survives'` (never dies) |
| `devolveThreshold` | 0.5 | devolution triggers when defense > this fraction of the attacker |
| `firstTurnContingents` | 1 | contingents the opening player may act with on turn 1 (0 = skip turn 1, null = no handicap) |
| `firstTurnActions` | 1 | actions per contingent on turn 1 (null = normal 2) |
| `minAttackValue` | 2 | minimum piece value that may attack — scouts can't (1 = anyone can) |
| `obelisks` | 4 corners | element + corner position per obelisk; empty array disables them |
| `obeliskAbilities` | `true` | controlled obelisks grant their active ability |
| `obeliskTiers` | 3/5/8/13/21/34 | adjacent-value thresholds granting +1/+2/+3/+5/+8/+13 bonus budget |
| destroyed pieces | removed | destroyed pieces leave the game entirely (they do *not* return to the sideboard) |
| capture on retreat | yes | if all defenders retreat, the attacker advances into the vacated territory |
| simultaneous wipe | draw | mutual destruction can empty both boards at once → draw |
| `initialScouts` | 2 | scouts each army places in the placement phase (capped at scout supply) |
| `maxTurns` | 200 | draw backstop so batch runs always terminate |
| `supply` | 8/5/3/2/1 | change piece mix freely; placement uses the scout count |
| `width`/`height` | 5×5 | any board size; the frontend adapts |

## Engines

- **random** — uniform random legal choices; the baseline sanity check.
- **greedy** — scores every legal action with material/tempo/position weights
  (kills ≫ evolves > advancing > spawning) and retreats only when standing
  would lose pieces. Weights are overridable via the factory in
  `src/engines/greedy.js`.
- **lookahead** — one-ply search: clones the state, actually applies each
  candidate action through the real rules engine (combat included), and
  evaluates the resulting position — material, fighting strength, evolve
  potential, territory, obelisk power, spawn-lock, minus the enemy's best
  immediate attack threat. Beats greedy ~8:1 in decided games. ~40× slower
  than greedy (still ~33ms/game). Weights overridable; pass `debug: true`
  to log candidate scores.

Add an engine by implementing three functions and registering it in
`src/engines/index.js`:

```js
{
  placeScout(state, army, rng) -> territory index
  chooseAction(state, ctx, legalActions, rng) -> one of legalActions | null (pass)
  planRetreats(state, attackInfo, options, rng) -> [{ piece, dest }, ...]
  chooseContingents(state, conts, limit, rng) -> subset of conts  // optional:
    // which contingents act under the first-turn handicap
}
```

Engines only ever pick from engine-generated legal-action lists, so a buggy
engine can't corrupt game state.

## Current observations (300-game matchups, seats swapped, 5×5, devolve combat)

- **Devolution made aggression profitable and broke the fortress meta.**
  A connecting attack now conserves the attacker's material (it devolves
  rather than dies through stiff defense), so attacking whenever legal is
  close to correct play. Greedy mirrors went from ~50% fortress draws under
  the old tie-death rule to **16% draws** with games resolving in ~66 turns.
  Greedy vs random jumped back to 98%.
- **The engine gap collapsed** — by the rules getting healthier. Lookahead's
  edge over greedy shrank from ~12:1 to under 2:1 (31.7% vs 17.3%, 51%
  draws): careful threat-avoidance mattered enormously when any attack
  could be a blunder, and matters much less now that attacks conserve
  value. Lookahead needed two endgame terms to convert won games — obelisk
  annuities that *fade* with enemy strength (an army once sat on its corner
  bonuses at 26-vs-2 rather than finish) and a *hunt drive* that turns
  material dominance into pressure to close distance. With them it beats
  random 98% (was 89%) and mirror draws fall to ~50% — the rest are genuine
  parity standoffs.
- **Watch the seat balance**: greedy mirrors show a second-player advantage
  again (seat B won 178 of 251 decided games) — the tempo dynamics of the
  turn-1 handicap shift with every combat-rule change; worth re-sweeping
  `firstTurnActions`/`firstTurnContingents` under devolve.
- **Ability usage is lopsided** (60 strong-engine games: water 157, fire 47,
  earth 2, air 1). Water's bounce is quietly brutal — a returned 2 can only
  redeploy via evolve — and abilities overall *reduced* draws (~8 points in
  strong matchups) by giving stuck positions a removal tool. Earth barely
  fires (lone-warrior-vs-lone-warrior geometry is rare) and air's
  positional value is invisible to these engines — both candidates for
  buffs or rework.
- Lessons from building lookahead: a one-ply evaluator needs an
  "evolve-ready pairs" term to see development chains, must treat
  spawn-locked scouts as dead material (but not transient full-cell locks),
  and must price passing as losing tempo — the biggest single improvement
  was letting it act unless an action is *clearly* harmful.
- **The 5×5 board fixed the seat imbalance.** Greedy mirrors are now
  essentially even (109 vs 125 seat wins) where the 4×4 board swung as far
  as ~91% toward one seat under various turn-1 rules. More space dilutes the
  opening tempo edge; `firstTurnContingents`/`firstTurnActions` (still 1/1)
  plus no scout attacks complete the picture.
- **But mirrors stalemate half the time.** ~53% of greedy mirrors hit the
  turn cap, and raising `maxTurns` from 200 to 800 doesn't change that —
  they're genuine fortress standoffs, not truncated games. At material
  parity, greedy refuses losing trades, and connecting attacks require
  committing a piece ≥ the defense, so neither side moves first. If draws
  bother you, candidates: a turn-limit tiebreak (most board strength wins),
  attrition (upkeep), or shrinking-board pressure.
- **Scout-only remnants get smothered.** With scouts unable to attack,
  `immobilized` endings appear (~2–5% of games): an army reduced to scouts
  can be cornered — every adjacent cell enemy-held or stacking-blocked — and
  loses without a final battle.
- Engine lessons that generalize to human play: avoid "spawn-lock" (a board
  of lone 3s/5s can never spawn again — scouts only stack with 1s and 2s),
  and note that exact-tie attacks are the only way to trade evenly, so
  material advantage compounds fast.
- random mirrors run ~158 turns with ~46% draws on the big board.
- **Obelisks are now raced for, not stumbled into.** Originally both engines
  treated obelisks as an accident: control emerged around turn 8–9 in under
  half of games, with ~2 budget draws per game. After adding control-gradient
  terms (progress toward control pays, not just the finish line),
  obelisk-aware placement, and control-completion bonuses, first control
  lands around **turn 4** with ~10 draws per game. A cautionary result from
  tuning: with obelisk weights ~2× higher, both engines camped corners and
  lookahead-vs-greedy went 91% draws — obelisk value must serve the war, not
  replace it. Greedy pays a real price for caring (84% vs random, down from
  93%) since corner-seeking placement is worse for pure combat.
