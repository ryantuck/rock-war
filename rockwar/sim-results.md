# Simulation results

Commands were run from `/home/runner/work/rock-war/rock-war/rockwar` with Node v22.23.3.

## Lookahead vs random

The CLI swaps seats every game. With lookahead listed as `--a`, lookahead won
491/500 games (98.2%), random won 6 (1.2%), and 3 (0.6%) were draws. Average
game length was 34.1 turns. Seat A won 245 games and seat B won 252.

With random listed as `--a`, lookahead won 484/500 games (96.8%), random won
13 (2.6%), and 3 (0.6%) were draws. Average game length was 36.3 turns. Seat A
won 256 games and seat B won 241.

Across both batches (1,000 games), lookahead won 975 (97.5%), random won 19
(1.9%), and there were 6 draws (0.6%). The mean game length was 35.2 turns.
Seat A won 501 games (50.1%) and seat B won 493 (49.3%); the other six were
draws. The per-batch seat totals are close, with no material first-seat
advantage apparent in this sample. The 97.5% combined lookahead win rate is
near the README's stated baseline of about 98%.

Raw output, `node src/sim.js --games 500 --a lookahead --b random --seed 42`:

```text
500 games: lookahead vs random  (seed 42, seats swapped each game, 15.68s)
────────────────────────────────────────────────────────────
  lookahead      491  98.2%
  random           6  1.2%
  draws            3  0.6%
  seat A wins 245, seat B wins 252 (first-mover check)
  avg game length: 34.1 turns
  avg winner surviving strength: 8.5 / 45
  endings: elimination=436, obelisks=48, turn-limit-tiebreak=7, immobilized=6, mutual-elimination=3
```

Raw output, `node src/sim.js --games 500 --a random --b lookahead --seed 42`:

```text
500 games: random vs lookahead  (seed 42, seats swapped each game, 16.49s)
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

The requested tournament command did not complete, so it produced no final
standings. It printed the following matchup results before stopping with an
uncaught `no piece 2 at territory 16` error in coordinated-attack simulation.
No source code was changed.

Raw output, `node src/sim.js --tournament --games 60 --seed 42`:

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
