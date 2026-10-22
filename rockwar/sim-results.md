# Simulation results

Run on 2026-10-22 with Node.js v22.23.3. All commands were run from `rockwar/`; no source files were changed.

## Lookahead vs random

The simulator swaps seats every game. The two requested commands therefore test both engine argument orders, with each engine occupying each seat in 250 games per batch.

| Command order | Lookahead wins | Random wins | Draws | Seat A wins | Seat B wins | Avg. length |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `lookahead` vs `random` | 491 (98.2%) | 6 (1.2%) | 3 (0.6%) | 245 | 252 | 34.1 turns |
| `random` vs `lookahead` | 484 (96.8%) | 13 (2.6%) | 3 (0.6%) | 256 | 241 | 36.3 turns |
| **Combined (1,000 games)** | **975 (97.5%)** | **19 (1.9%)** | **6 (0.6%)** | **501** | **493** | **~35.2 turns** |

Across decisive games, seat A won 501 of 994 (50.4%) and seat B won 493 (49.6%). Lookahead's combined 97.5% win rate rounds to the README's stated baseline of about 98%; the two individual batches were 98.2% and 96.8%.

### Raw output: `node src/sim.js --games 500 --a lookahead --b random --seed 42`

```text
500 games: lookahead vs random  (seed 42, seats swapped each game, 11.44s)
────────────────────────────────────────────────────────────
  lookahead      491  98.2%
  random           6  1.2%
  draws            3  0.6%
  seat A wins 245, seat B wins 252 (first-mover check)
  avg game length: 34.1 turns
  avg winner surviving strength: 8.5 / 45
  endings: elimination=436, obelisks=48, turn-limit-tiebreak=7, immobilized=6, mutual-elimination=3
```

### Raw output: `node src/sim.js --games 500 --a random --b lookahead --seed 42`

```text
500 games: random vs lookahead  (seed 42, seats swapped each game, 12.59s)
────────────────────────────────────────────────────────────
  random          13  2.6%
  lookahead      484  96.8%
  draws            3  0.6%
  seat A wins 256, seat B wins 241 (first-mover check)
  avg game length: 36.3 turns
  avg winner surviving strength: 8.9 / 45
  endings: elimination=424, immobilized=5, obelisks=63, turn-limit-tiebreak=5, mutual-elimination=3
```

## Tournament

The requested tournament command exited with status 1 before it could print standings. It completed 15 pairings, then crashed during a later game with `Error: no piece 2 at territory 16` in `src/game.js`, called while `lookahead` was evaluating an action. Since the tournament did not complete, there are no full tournament standings to report. No source code was changed to work around the failure.

### Raw output: `node src/sim.js --tournament --games 60 --seed 42`

```text
  random vs greedy: 2-56-2
  random vs lookahead: 1-59-0
  random vs planner: 0-60-0
  random vs planner-obelisk: 1-59-0
  random vs lookahead-aggro: 2-55-3
  random vs lookahead-obelisk: 0-59-1
  random vs lookahead-turtle: 3-55-2
  random vs lookahead-tempo: 8-50-2
  greedy vs lookahead: 10-40-10
  greedy vs planner: 3-54-3
  greedy vs planner-obelisk: 0-57-3
  greedy vs lookahead-aggro: 1-29-30
  greedy vs lookahead-obelisk: 0-44-16
  greedy vs lookahead-turtle: 3-29-28
  greedy vs lookahead-tempo: 6-24-30
file:///home/runner/work/rock-war/rock-war/rockwar/src/game.js:323
  if (at === -1) throw new Error(`no piece ${piece} at territory ${i}`);
                       ^

Error: no piece 2 at territory 16
    at removePiece (file:///home/runner/work/rock-war/rock-war/rockwar/src/game.js:323:24)
    at resolveCoordAttack (file:///home/runner/work/rock-war/rock-war/rockwar/src/game.js:889:5)
    at applyAction (file:///home/runner/work/rock-war/rock-war/rockwar/src/game.js:1039:14)
    at step (file:///home/runner/work/rock-war/rock-war/rockwar/src/engines/lookahead.js:281:21)
    at file:///home/runner/work/rock-war/rock-war/rockwar/src/engines/lookahead.js:307:9
    at Array.map (<anonymous>)
    at Object.chooseAction (file:///home/runner/work/rock-war/rock-war/rockwar/src/engines/lookahead.js:306:29)
    at playTurn (file:///home/runner/work/rock-war/rock-war/rockwar/src/game.js:1179:36)
    at playGame (file:///home/runner/work/rock-war/rock-war/rockwar/src/game.js:1301:5)
    at runTournament (file:///home/runner/work/rock-war/rock-war/rockwar/src/sim.js:31:23)

Node.js v22.23.3
```
