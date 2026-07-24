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
    territory with one piece. **Scouts cannot attack** (`minAttackValue: 2`).
- **Combat**: the defender may retreat each piece for free into an adjacent
  territory it occupies (respecting stacking limits), plus up to 1 scout per
  attack may retreat into an adjacent *empty* territory. Then, against the
  pieces that stayed (margin rule):
  - attacker value **<** defenders' sum → repelled, no effect (cost still paid)
  - attacker value **=** defenders' sum → all pieces die, attacker included
    (a 3 attacking a (2,1) kills all three)
  - attacker value **>** defenders' sum → only the defenders die; the attacker
    survives and advances (a 3 attacking a (2) kills just the 2)
  If every defender retreats, no combat happens and the attacker advances.
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
| `combatRule` | `'margin'` | attacker dies only on an exact-value tie; `'mutual'` = attacker always dies with the defenders; `'attacker-survives'` = attacker never does |
| `firstTurnContingents` | 1 | contingents the opening player may act with on turn 1 (0 = skip turn 1, null = no handicap) |
| `firstTurnActions` | 1 | actions per contingent on turn 1 (null = normal 2) |
| `minAttackValue` | 2 | minimum piece value that may attack — scouts can't (1 = anyone can) |
| `obelisks` | 4 corners | element + corner position per obelisk; empty array disables them |
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

## Current observations (seed 42/7/99, 500 games, seats swapped, 5×5 board)

- greedy beats random 94% — the skill gradient survived the bigger board.
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
- **Obelisks add gentle resolution pressure**: greedy-mirror stalemates
  dipped from ~53% to ~47% and seats stayed balanced (148 vs 115). Obelisk
  budget gets drawn in about a third of greedy mirrors — most often earth
  (evolve) and fire (attack). Bigger tiers or more central obelisk
  placement would raise the stakes.
