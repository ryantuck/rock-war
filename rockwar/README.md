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
node src/sim.js --games 500 --a greedy --b greedy --layout 5x5-classic   # another board
node src/sim.js --layouts                                                 # list layouts

# Round-robin tournament across all engines (the balance dashboard):
# standings by points (win 1, draw 0.5) plus a head-to-head grid
node src/sim.js --tournament --games 60 --seed 42
node src/sim.js --tournament --engines lookahead-aggro,lookahead-obelisk --games 200

# Frontend (index.html lives at the repo root; ES modules need a server)
cd .. && python3 -m http.server 8000
# then open http://localhost:8000
```

The frontend lets you watch games **action-by-action with animated pieces**
— moves and retreats fly between territories, spawns fly in from the
sideboard, returns/bounces fly back to it, destroyed pieces flash and fade,
evolves merge in place. Step advances one action (an attack plays out its
retreats and destruction as one sequence); Auto plays continuously with a
speed selector. You can also edit the rules config as JSON (applies on New
game) and run batches of hundreds of games in-browser with the same stats
as the CLI.

**Interactive play**: pick **human** for either army and start a new game —
the engine side plays automatically (with the same animations) and the UI
pauses whenever it's your move. Click a highlighted cell to place your
scouts; on your turn, click one of your territories to select it (green
outline = move there, red = attack, with buttons for spawn / evolve /
obelisk abilities and a piece picker when a territory holds two values),
then end your turn. The human turn runs through the exact `playTurn`
machinery — per-contingent fib budgets, the two-mechanic limit, obelisk
bonus pools funding extra actions, the first-turn handicap (your first action
locks in your one acting contingent), and the opponent's reaction window
after each of your actions. v1 limits for the human side: retreats are
auto-planned (greedy's stand-on-repels-and-ties policy), you can't cast
reaction-window abilities on the engine's turn, and coordinated attacks and
two-territory fire splits aren't offered interactively.

Under the hood the rules engine emits a structured event stream
(`state.events`, grouped by action `seq`, with post-event snapshots when
`state.captureSnapshots` is set) — the UI replays events with ghost-piece
animations and renders the exact snapshot after each, so the displayed
board can never drift from the real state. Sims ignore the stream.

## Board layouts

*[AI - Claude]: Board layouts*

A **layout** (`LAYOUTS` in `src/game.js`) bundles a board size, its obelisk
positions, and the rule variants measured to suit it. `defaultConfig(name)`
builds the full config: shared base rules plus the layout. A partial
config naming a `layout` is completed from it (`resolveConfig`). Pick one
in the frontend's layout menu (it reloads the rules editor), or with
`--layout` on the CLI. `--config` keys apply on top.

| Layout | Board | Obelisk corners | Scouts | Stack on own scout |
|---|---|---|---|---|
| `4x4-partition` (default) | 4×4 | [1,1] [3,1] [1,3] [3,3] — every territory touches exactly one | 5 | yes |
| `5x5-classic` | 5×5 | [1,1] [4,1] [1,4] [4,4] — center and edges free | 5 | no |
| `4x4-diamond` (experimental) | 4×4 | [2,1] [3,2] [1,2] [2,3] — center territories touch two, corners none | 3 | no |
| `hex13` | 13 hexagons, rows 1-3-5-3-1 | four hex corners, each touching 3 territories; only the center touches none | 5 | yes |

How they play under the current engines (split placement; 100–400 games
per matchup, seat shares ±3–5 pts):

| | 4x4-partition | 5x5-classic | 4x4-diamond | hex13 |
|---|---|---|---|---|
| Seat A: greedy / lookahead / planner-obelisk mirrors | 44.5 / 46 / 48% | 52 / 33.5 / 36% | 47 / 48 / 54% | 44.5 / 45 / 50% |
| Obelisk wins: lookahead / planner-obelisk mirror | 13 / 28% | 14.5 / 36% | 40.5 / 62% | 7 / 22% |
| Draws: greedy / lookahead mirror | 20 / 5% | 8.8 / 1.5% | 8.8 / 4.5% | 6.2 / 6.5% |
| Median length: lookahead / planner-obelisk mirror | 14 / 15 | 18 / 16 | 10 / 7 | 14 / 14 |
| Obelisk held before turn 1 | ~30% | ~90% | 0% | ~60% |
| Lookahead vs greedy | 90% | 86% | 82% | 85.5% |

- **4x4-partition (default):** the most even overall, and obelisks matter
  without dominating. Greedy mirrors stall into draws often.
- **5x5-classic:** longer games and the most room. The lookahead and
  planner mirrors favor seat B, and split placement usually hands someone
  an obelisk before turn 1.
- **4x4-diamond:** even and quick, but a race. Most search-engine games
  end in an obelisk win within ~10 turns.
- **hex13:** as even as 4×4 partition, with fewer draws (greedy mirror
  6% vs 20%). Obelisk wins are rarer than on the grids, and games are
  decided mostly by fighting. The shape came from a search of all
  180°-symmetric 13-hex boards within two rings of the center: this is
  the most compact one where four three-hex obelisks cover every
  territory but the center, mirroring 4×4 partition. It is symmetric
  under a half turn (each side's half maps onto the other's), not under
  mirroring. Starting scouts were swept from 2 to 5. Five gave the most
  even seats; with 3–4, the lookahead mirror favored B 68–72%. Round
  robin: planner-obelisk 72.8%, lookahead-obelisk 66.7%, planner 62.5%,
  tempo 60.2%, lookahead 59.4%, turtle 56.6%, aggro 49.2%, greedy 22.5%,
  random 0.2%. Draws 3.7%.

To add a layout, add an entry to `LAYOUTS` with `initialScouts`,
`placementStacking`, a one-line `description`, and a board:
- **Grid:** `width` and `height`, plus `obelisks` as four `corner` points.
- **Hex:** `shape: 'hex'` and `hexes` (axial `[q, r]` coordinates of
  pointy-top hexagons), plus `obelisks` listing the `hexes` each one
  touches (a hex corner touches three).

The CLI, frontend and engines pick it up. Engines and the UI go through
the topology functions in `src/game.js` (`cellCount`, `neighbors`,
`cellDistance`, `centerDistance`, `obeliskTerritories`, `fmtCell`).
Hex cells are labelled by row (1 at the top) and by letter left to right
within the row (`c3` is hex13's center).

The findings sections further down were measured on the 5×5 board
(`5x5-classic`) unless they say otherwise. The 4×4 section and the tables
above are on 4×4.

## Rules as implemented

- **Board**: set by the **layout** (see *Board layouts* below) —
  `4x4-partition` by default (16 territories), also `5x5-classic`, an
  experimental `4x4-diamond`, and `hex13` (13 hexagons). Grids use
  orthogonal adjacency; hex boards use six-way adjacency.
- **Armies**: each side's sideboard holds 8×1 (scouts), 5×2 (soldiers),
  3×3 (chieftains), 2×5 (warlords), 1×8 (behemoth) — fibonacci counts of
  fibonacci values, 45 points total. Any piece of value 2 or more is a
  **warrior**.
- **Placement**: snake order (A B B A A B B A A B …), one scout per slot onto
  any empty territory — or, with `placementStacking`, onto one of your own
  lone scouts, making a (1,1) pair — until each army has placed
  `initialScouts` (default 5; B makes the final placement). Remaining
  sideboard pieces — including the other scouts — enter play by spawning and
  evolving. Then A moves first.
- **Territories** hold at most 2 pieces, which must be fibonacci-adjacent:
  (1,1), (1,2), (2,3), (3,5), (5,8).
- **Contingents**: a maximal contiguous group of one army's territories.
  Its strength is the sum of its piece values.
- **Turns**: on your turn, each of your contingents (snapshotted at turn start)
  takes actions whose fibonacci-valued costs sum to at most the
  contingent's strength, using **at most 2 mechanics** (spawn, move,
  evolve, attack) but **any number of actions** of them: strength 5 could
  move three scouts and then spawn twice. Coordinated attacks are attacks;
  an obelisk ability counts as its element's mechanic (fire attack, earth
  evolve, air move, water spawn). Territories a contingent captures or
  moves into mid-turn count as part of it for its remaining actions.
  (`maxActionTypesPerContingent` 2; the older rule — 2 actions of any
  mechanics — is `maxActionsPerContingent: 2` with the mechanic limit
  off.)
- **Actions**:
  - *Spawn* (cost 1): place a scout from the sideboard into one of the
    contingent's territories.
  - **Rank costs** (`rankCosts`): committing a piece — moving it into an
    empty territory, attacking with it, or evolving it into being — costs
    **one fibonacci step below its value**: soldier (2) 1, chieftain (3) 2,
    warlord (5) 3, behemoth (8) 5. Scouts always move for 1.
  - *Move* (into empty: rank cost; onto a friendly piece: the value
    difference; scouts always 1): move a piece to an adjacent empty or
    friendly territory, respecting the 2-piece / fib-adjacency limits.
    Examples: a 3 into open territory costs 2; a 5 onto a friendly 3
    costs 2; a 3 onto a friendly 2 costs 1.
  - *Evolve* (cost = the result's rank cost, i.e. the larger constituent;
    configurable): combine the two co-located pieces into their fibonacci
    sum — 1+1→2 costs 1, 1+2→3 costs 2, 2+3→5 costs 3, 3+5→8 costs 5. Both
    constituents return to the sideboard; the new piece must be available
    there.
  - *Attack* (cost = attacker's rank cost): strike an adjacent enemy
    territory with one piece. **Scouts cannot attack** (`minAttackValue: 2`),
    and attacking requires the piece's value to be **≥ the target
    territory's total** — weaker attacks could never connect, so they are
    simply illegal.
  - *Coordinated attack* (one action, cost = the strikers' rank costs
    summed — 2+2 costs 2, 3+5 costs 5): several of
    a contingent's pieces strike **simultaneously** — at different
    territories (each strike must connect on its own) or jointly at one
    (their combined value must connect, and resolves as a single combined
    attacker: a tie annihilates every striker, and any break moves the
    whole group in — see *group advance*). Because the
    strikes are simultaneous, **defenders cannot retreat into any territory
    under attack** — two scouts side by side can no longer shelter each
    other, and a 2 can't retreat into an also-attacked 1's territory. The
    scout retreat-to-empty budget stays **per territory**, so the squeeze
    comes from geometry: scouts against a wall have nowhere to go.
    Strikers may come from **different contingents**: each contingent
    pays its own strikers' share from its budget and spends one of its
    actions on the assault. `coordinatedAttacks` knob; engines generate
    pairs.
  - *Group advance* (`groupAdvance`): when a joint strike breaks a
    territory, **both strikers move in**. If they can't share it (2+2, 3+3
    and 5+5 aren't fib-adjacent pairs), the smaller **splits into its
    fibonacci parts on arrival** (through the sideboard, like devolution),
    the larger keeps the part that pairs with it, and the **enemy displaces
    the leftover one step**: into an adjacent empty territory, or one of the
    attacker's own where it fits. With nowhere to go, it returns to the
    attacker's sideboard. Two 2s breaking a 3 land as (2,1) with a scout
    pushed next door; 3+3 through a (3,2) lands as (3,2) plus a pushed 1;
    5+5 through an 8 lands as (5,3) plus a pushed 2. A pair that fits —
    (2,3), (3,5) — moves in whole. Value is conserved. Twin strikes (one
    striker per territory) are unchanged: a stiff defense devolves the
    striker where it stands, a clean break moves it in. With the knob off,
    a joint break moves only the largest striker in, and a stiff defense
    devolves every striker in place.
- **Combat**: the defender may retreat each piece for free into an adjacent
  territory it occupies (respecting stacking limits), plus up to 1 scout per
  attack may retreat into an adjacent *empty* territory. Then the defenders
  that stayed all die (a legal attack always starts ≥ the full stack, and
  retreats only lower the defense), and the attacker's fate depends on how
  stiff the broken defense was (devolve rule):
  - defense **=** the attacker's value → **mutual destruction**: everything
    dies (a 2 attacking a (2), or a 3 attacking a (2,1) — all pieces are
    removed).
  - defense **> ½** but less than the attacker's value → the defenders die
    and the attacker **devolves** into its fibonacci constituents (3→2+1,
    5→3+2, 8→5+3), exchanged through the sideboard like evolution in
    reverse. A 3 attacking a (2) kills the 2 and lands as a (2,1). Value is
    conserved — the price is concentration and the tempo to re-evolve. (If
    the sideboard lacks a constituent, that part is lost.)
  - defense **≤ ½** the attacker's value → the attacker survives intact
    (a 3 attacking a lone (1): the 1 just dies).
  Either way the attacker advances into the captured territory (every
  constituent pair is fib-adjacent, so it fits). If every defender retreats,
  no combat happens and the attacker advances whole.
- **First-turn handicap**: on turn 1, the opening player acts with only one
  contingent (their engine chooses which); it plays a normal turn.
  Tunable via `firstTurnContingents` / `firstTurnActions` (a turn-1 action
  cap; off by default — see *Two mechanics per contingent* below).
- **Obelisks**: four elemental obelisks — fire (red), earth (green), air
  (yellow), water (blue) — sit on corner points, placed by the layout. On
  grids a corner touches four territories (4×4 partition: [1,1] [3,1]
  [1,3] [3,3]; 5×5 classic: [1,1] [4,1] [1,4] [4,4]). On hex13 a corner
  touches three: fire a1 a2 b2, earth c2 d3 e3, air a3 a4 b3, water a5 b4
  c4. Each maps to a mechanic:
  fire → attack, earth → evolve, air → move, water → spawn. An army
  *controls* an obelisk by occupying **at least 2** of its adjacent
  territories with the **strictly greatest** total adjacent piece value of
  **at least 3**. Control grants bonus budget for that mechanic, scaling
  fibonacci with adjacent value: ≥3 → +1, ≥5 → +2, ≥8 → +3, ≥13 → +5,
  ≥21 → +8, … The bonus is an army-wide per-turn pool that refreshes each
  turn while control holds, and it **breaks the mechanic limit**: a
  contingent that has used its 2 mechanics may still take extra actions of
  a third whose full cost is covered by the matching pool — e.g. with fire
  control, spawn and evolve, then attack on the fire kicker. Extras don't
  claim their mechanic. (Within the limit, actions spend contingent budget
  first so the kicker stays available for extras.)
- **Obelisk abilities scale with fervor** — the controller's total adjacent
  value at that obelisk (the same score that sets the bonus tier). Fervor
  caps the **fuel** piece you may spend — a piece of your own standing
  adjacent to that obelisk: fervor 3 permits scout fuel, 5 a soldier, 8 a
  chieftain, 13 a warlord (max fuel value = the obelisk's bonus tier).
  Bigger fuel, bigger effect. Every ability **sacrifices** its fuel — the
  piece leaves the game. Abilities cost no budget, count as actions, fire
  once per obelisk per player-turn, and reach anywhere:
  - *fire*: deal **F damage to enemy territories**, splittable across up to
    prevFib(F) of them — a chieftain deals 3 damage to 2 territories, a
    warlord 5 damage to 3. Each hit removes its damage from the
    territory's total value; survivors redeploy in place as fibonacci
    parts drawn from the owner's sideboard (unseatable or unavailable
    parts are lost).
  - *water*: bounce an enemy piece of value **≤ F** back to its owner's
    sideboard.
  - *air*: **swap the locations** of one of your pieces and an enemy piece
    — both of value ≤ F, both alone in their territories (a partial swap
    would create an illegal mixed-army cell). Teleport your soldier into
    their backline while yanking their corner anchor out of position.
  - *earth*: the sacrificed piece is **remote evolution material** — level
    up one of your own pieces fib-adjacent to the fuel into their sum
    (sacrifice a soldier to turn a chieftain into a warlord), drawn from
    the sideboard, no co-location needed.
  Abilities can also be cast **on the opponent's turn**: after each action
  the active player takes, the other army gets a reaction window and may
  fire any of its unused abilities (no budget or action cost — just the
  fuel scout). The once-per-obelisk ledger is per player-turn, so an
  element can fire once during your turn and once as a reaction during
  theirs. Disable everything with `obeliskAbilities: false`.
- **Obelisk passive powers**: while control holds, obelisks also project
  army-wide defensive auras (magnitudes scale with the bonus tier):
  - *air*: your scout-retreat-into-empty budget on each attack against you
    is increased by the air bonus.
  - *water*: your pieces that would die in combat **return to your
    sideboard** instead of leaving the game.
  - *earth*: attacking your territories costs the attacker its usual cost
    **plus the earth bonus**.
  Disable with `obeliskPowers: false`.
- **Winning**: eliminate all enemy pieces from the board, leave the enemy
  with no legal action on their turn, or **control every obelisk
  simultaneously** — all four on every current layout (checked after every
  action — the completing move wins on the spot; `obeliskVictory` /
  `obeliskVictoryCount` knobs, the older rule was any three). Control
  means the strictly greatest adjacent value of at least 3 across at least
  2 of the obelisk's adjacent territories. If a combat wipes both boards
  at once, the game is a draw (`mutual-elimination`). At the turn limit,
  the army with **more board strength wins** (controlled obelisks break a
  strength tie; `turnLimitTiebreak` knob) — it's only a draw if both are
  dead even.

## Assumptions made where the spec was open (all tunable)

The point of this sandbox is rule iteration, so every judgment call is a knob
in `defaultConfig()` (`src/game.js`) — editable live in the frontend's config
box or via `--config file.json` on the CLI:

| Knob | Default | The call that was made |
|---|---|---|
| `maxActionTypesPerContingent` | 2 | "two types of actions" read literally: *at most two distinct mechanics per contingent per turn*, any number of actions within the budget (null = no limit) |
| `maxActionsPerContingent` | null | cap on the number of actions per contingent per turn; the older reading was 2 (with the mechanic limit null) |
| budget | ≤ strength | action costs sum *up to* strength (exact sums are usually impossible with 2 fib values) |
| `rankCosts` | `true` | moving into empty territory and attacking cost one fibonacci step below the piece's value (2→1, 3→2, 5→3, 8→5); `false` = the piece's full value (the older costs) |
| `evolveCost` | `'larger'` | the larger constituent — one step below the result, matching rank costs; also `'smaller'` (the older default) and `'result'` |
| `scoutRetreatBudget` | 1 | read as *1 scout per attack* may flee to an empty territory |
| `combatRule` | `'devolve'` | attacker devolves through stiff defense; also `'margin'` (dies on exact tie), `'mutual'` (always dies), `'attacker-survives'` (never dies) |
| `devolveThreshold` | 0.5 | devolution triggers when defense > this fraction of the attacker |
| `firstTurnContingents` | 1 | contingents the opening player may act with on turn 1 (0 = skip turn 1, null = no handicap) |
| `firstTurnActions` | null | actions per contingent on turn 1 (null = a normal turn; 2 was the default under the two-action rule) |
| `groupAdvance` | `true` | a joint strike that breaks a territory moves both strikers in; a pair that can't share splits its smaller striker on arrival and the enemy displaces the leftover one step (`false`: only the largest striker moves in, stiff defense devolves every striker in place) |
| `minAttackValue` | 2 | minimum piece value that may attack — scouts can't (1 = anyone can) |
| `layout` | `4x4-partition` | named board layout: supplies `width`/`height`, `obelisks`, `initialScouts`, `placementStacking`; other keys apply on top |
| `obelisks` | per layout | element + corner position per obelisk; empty array disables them |
| `obeliskAbilities` | `true` | controlled obelisks grant their active ability |
| `obeliskPowers` | `true` | passive auras: air retreat budget, water combat saves, earth attack tax |
| `obeliskVictory` | `true` | controlling `obeliskVictoryCount` obelisks simultaneously wins immediately |
| `obeliskVictoryCount` | null | obelisks needed for the instant win (null = all of them; the older rule was 3) |
| `obeliskTiers` | 3/5/8/13/21/34 | adjacent-value thresholds granting +1/+2/+3/+5/+8/+13 bonus budget |
| destroyed pieces | removed | destroyed pieces leave the game entirely (they do *not* return to the sideboard) |
| capture on retreat | yes | if all defenders retreat, the attacker advances into the vacated territory |
| simultaneous wipe | draw | mutual destruction can empty both boards at once → draw |
| `initialScouts` | per layout (5; diamond 3) | scouts each army places in the placement phase (capped at scout supply) |
| `placementStacking` | per layout (on for 4×4 partition) | placement may double up on your own lone scout ((1,1), evolvable from turn 1) |
| `maxTurns` | 200 | game ends here; tiebreak decides unless dead even |
| `turnLimitTiebreak` | `true` | at the cap: most board strength wins, obelisks break ties |
| `supply` | 8/5/3/2/1 | change piece mix freely; placement uses the scout count |
| `width`/`height` | per layout (4×4) | grid board size; the frontend adapts |
| `shape` / `hexes` | per layout (`hex13`) | `'hex'` plus axial `[q, r]` hex coordinates for hex boards; obelisks then list the `hexes` they touch |

## Engines

- **random** — uniform random legal choices; the baseline sanity check.
- **greedy** — scores every legal action with material/tempo/position weights
  (kills ≫ evolves > advancing > spawning) and retreats only when standing
  would lose pieces. When either side is one obelisk from the win, it
  simulates each action to take an outright obelisk victory and to block the
  enemy's next-turn finish (actions and reaction abilities alike). Weights
  are overridable via the factory in `src/engines/greedy.js`.
- **lookahead** — one-ply search: clones the state, actually applies each
  candidate action through the real rules engine (combat included), and
  evaluates the resulting position — material, fighting strength, evolve
  potential, territory, obelisk power, spawn-lock, minus the enemy's best
  immediate attack threat and its **next-turn obelisk-victory reach** (plus
  our own reach as a smaller bonus). ~40× slower than greedy (still ~tens of
  ms per game). Weights overridable; pass `debug: true` to log candidate
  scores. Turns aren't capped at two actions, so two guards keep it from
  drifting: the pass margin (act unless clearly harmful) covers only a
  contingent's first `passMarginActions` (2) actions each turn, after which
  an action must genuinely improve the position; and it never makes a move
  that exactly reverses one of its own moves that turn (the planners share
  both).
- **Obelisk-victory reach** (`src/engines/obelisk-threat.js`) — one-ply and
  own-turn search can't see an obelisk win coming: an army holding two
  obelisks gets bonus moves/spawns and abilities, and takes the third from a
  distance in a 3–6 action turn. `obeliskReach(state, army)` estimates
  whether it can finish next turn — a greedy simulation of spawns, moves
  (1–2 steps), attacks (direct or after a move) and controlled abilities
  into the target obelisk's territories, under playTurn's budget, mechanic-limit and
  bonus-pool rules, never breaking an obelisk already held. No state
  cloning (~140µs). Against a real-rules search of the next turn it raised
  no false alarms and caught 97% of finishes. The evaluator charges
  `obeliskLethal` (300) for an enemy finish, fading to 50% / 25% / 10% when
  it's one / two / three units short (`reachCurve`, the early warning that
  pushes a threat back before it's lethal), and pays `obeliskSetup` (60) on
  the same curve for our own. The planners need it too: their beam search
  covers only the current turn, so this bonus is what makes them set up a
  finish for the next one. Our obelisk annuities still fade against a
  nearly-dead enemy (`obeliskFadeAt`); the enemy's obelisk terms no longer
  do. `obeliskBrink` (flat cost of an enemy one obelisk from victory) and
  `obeliskReach(..., { approach: true })` (can an enemy one short of the
  brink step onto it?) exist but are off: in sweeps both bought
  over-defense — engines out-fought while guarding corners.
- **Placement styles** (`src/engines/placement.js`, engine option
  `placement`) — `split` (default): two separate starting contingents,
  opening the second away from the first, growing the smaller, never
  merging. `single`: one central cluster (the original heuristic).
  `-stack` variants double up on their own lone scouts (up to two pairs)
  when `placementStacking` allows it. Split wins head-to-head for every
  engine tested, on both boards. Two contingents mean twice the actions
  from turn 2 on, for the same material.
- **lookahead-aggro / -obelisk / -turtle / -tempo** — strategy-archetype
  presets of the same search with re-weighted evaluators (attrition, map
  control, defense/clock, economy). Tournaments between them measure which
  strategies the *current rules* favor — run the tournament after every
  rules change. First reading (60 games/pairing): **obelisk play dominates**
  (70.6%, beating every other engine head-to-head), then turtle, balanced,
  tempo — with **aggro dead last among lookaheads** (49%): under
  tie-mutual-destruction combat, pure aggression is the weakest archetype.
- **planner / planner-obelisk** — full-turn planning: a receding-horizon
  beam search (depth 3, beam 6) over *sequences* of a contingent's actions,
  evaluated with the lookahead evaluator, replanned at every decision. Finds
  multi-step combos one-ply search can't (spawn → evolve → kicker-attack).
  ~5× lookahead's cost (~160ms/game). Current tournament champion is
  **planner-obelisk** (planning depth + map-control weights): 62.1% overall,
  beating lookahead-obelisk 54%, planner 53%, lookahead 80% head-to-head.

Add an engine by implementing three functions and registering it in
`src/engines/index.js`:

```js
{
  placeScout(state, army, rng) -> territory index
  chooseAction(state, ctx, legalActions, rng) -> one of legalActions | null (pass)
  planRetreats(state, attackInfo, options, rng) -> [{ piece, dest }, ...]
  chooseContingents(state, conts, limit, rng) -> subset of conts  // optional:
    // which contingents act under the first-turn handicap
  planDisplacement(state, info, dests, rng) -> one of dests  // optional:
    // where to push the attacker's group-advance leftover piece
    // (info: { army, piece, from }); default: defaultDisplacement in game.js
}
```

Engines only ever pick from engine-generated legal-action lists, so a buggy
engine can't corrupt game state.

## Five-scout placement (`initialScouts` 2 → 5)

*[AI - Claude]: Five-scout snake placement — simulation findings*

Same seeds for both configs, seats swapped every game; matchup sizes
200–1000 games, plus the 9-engine round robin at 40 games per pairing.
"Pts (1st)" = the first-named engine's points (win 1, draw ½); "cap" = games reaching `maxTurns` (tiebreak or draw); "obelisk" = instant
3-obelisk wins; "seat A" = A's share of decided games.

| Matchup | Scouts | Pts (1st) | Draws | Cap | Obelisk wins | Seat A | Median turns |
|---|---|---|---|---|---|---|---|
| greedy mirror (1000) | 2 → 5 | 50 → 51% | 22.6 → 12.7% | 26.5 → 19.1% | 0 → 0% | 63 → 60% | 23 → 23 |
| lookahead vs greedy (400) | 2 → 5 | 79 → 98% | 21.0 → 1.8% | 10.0 → 8.0% | 0.8 → 3.8% | 37 → 50% | 15 → 15 |
| lookahead mirror (400) | 2 → 5 | 49 → 50% | 19.5 → 2.2% | 25.2 → 28.0% | 1.2 → 28.0% | 30 → 59% | 21 → 32 |
| planner-obelisk vs lookahead (200) | 2 → 5 | 71 → 67% | 2.5 → 0% | 14.0 → 26.0% | 5.0 → 40.5% | 52 → 50% | 20 → 31 |
| planner vs planner-obelisk (200) | 2 → 5 | 40 → 36% | 8.0 → 0.5% | 9.5 → 9.5% | 9.0 → 50.0% | 50 → 32% | 22 → 27 |
| planner-obelisk mirror (200) | 2 → 5 | 50 → 48% | 13.5 → 1.0% | 5.0 → 19.5% | 9.5 → 49.0% | 53 → 33% | 15 → 28 |
| greedy vs random (400) | 2 → 5 | 96 → 91% | 2.8 → 3.5% | 0 → 0% | 0 → 0% | 49 → 50% | 21 → 25 |

- **Draws nearly disappear.** Round-robin draws fell from 14.9% to 1.9% of
  games (214 → 28 of 1440). Mutual-elimination endings among search engines
  mostly vanish (lookahead mirror 71 → 5 of 400).
- **The obelisk race becomes the game.** Heuristic placers first control an
  obelisk on turn ~2.3 (was 5–6.5). Abilities fire 2–3× as often (planner
  mirror 3.3 → 9.1 per game). Instant 3-obelisk wins go from a rare ending
  to *the* main ending between planners (~50% of games, was ~9%).
- **Placement can hand out an obelisk before turn 1.** Greedy/lookahead/
  planner placement (center + adjacency + obelisk pull) builds two abutting
  5-scout blocks in the middle. In ~33% of those games the final (10th)
  placement completes B's 3-scout ring around a corner, so B holds an
  obelisk at the start of play (random placement: 12%, either seat). It
  isn't decisive: B wins 54% of those in the planner mirror and only 43% in
  the lookahead mirror.
- **Seat balance now depends on the engine.** One-ply engines favor the
  first mover (A 59–60%), while planners strongly favor B (A 32–33%). In the
  planner mirror, B wins 73% of games with *no* obelisk held at the start,
  so the pre-turn-1 obelisk isn't the driver. The turn-1 handicap was the
  next suspect, but giving A a second opening action barely moves it (see
  below).
- **Skill matters more.** Lookahead vs greedy goes 79% → 98%, and greedy
  drops from 29.2% to 12.7% in the round robin (near-shutout by every
  search engine). Random gains slightly against greedy (91%, was 96%):
  its scattered placement starts with ~3.7 contingents vs greedy's 1.
- **Strategy archetypes reshuffle.** Round robin (2 → 5 scouts):
  planner-obelisk 73.1 → 76.3%, planner 66.1 → 67.7%, lookahead-obelisk
  69.7 → 65.2%, lookahead 61.7 → 62.7%, turtle 52.7 → 62.7%, tempo
  45.3 → 61.9%, aggro 47.5 → 39.1%. The middle tightens (lookahead,
  turtle and tempo within 1 point of each other). Aggro is crushed by turtle (14%) and
  tempo (13%): with more material on the board from turn 1, economy and
  defense beat early trades.
- **Strong-engine games run longer.** Planner-mirror median length goes
  15 → 28 turns and turn-cap finishes 5% → 20%. The board-strength
  tiebreak decides them, where the 2-scout game ended earlier in mutual
  wipes or draws.
- **Placement heuristics are still tuned for 2 scouts.** Every
  heuristic placer packs all five scouts into one contingent (2 actions a
  turn, same as before). Spreading for more contingents is untested.

## First turn: 2 actions (`firstTurnActions` 1 → 2)

*[AI - Claude]: Two-action opening — simulation findings*

Five scouts, same seeds and matchup sizes as above. A still acts with one
contingent on turn 1, which in practice is all five scouts.

| Matchup | Seat A (1 → 2 actions) | Draws | Cap | Obelisk wins | Avg turns |
|---|---|---|---|---|---|
| greedy mirror (1000) | 60.1 → 62.0% | 12.7 → 9.3% | 19.1 → 15.9% | 0 → 0% | 58 → 51 |
| lookahead mirror (400) | 59.1 → 58.1% | 2.2 → 3.2% | 28.0 → 34.8% | 28.0 → 20.5% | 77 → 89 |
| planner vs planner-obelisk (200) | 31.7 → 37.9% | 0.5 → 1.0% | 9.5 → 15.5% | 50.0 → 38.0% | 45 → 56 |
| planner-obelisk mirror (200) | 33.3 → 38.2% | 1.0 → 0.5% | 19.5 → 21.0% | 49.0 → 46.5% | 61 → 64 |
| planner-obelisk vs lookahead (200) | 50.0 → 47.9% | 0 → 3.0% | 26.0 → 28.0% | 40.5 → 34.0% | 74 → 78 |

- **A now opens like B replies.** A's turn 1 is spawn → evolve (a soldier
  on the board) in 70–82% of games, matching B's most common turn 2.
- **Seat balance barely moves.** Pooled planner games: A's share of decided
  games goes 32.5% → 38.0% (+5.5 pts, 1.6 SE, suggestive but not
  conclusive). Pooled one-ply mirrors: 59.8% → 60.8% (noise). The
  single-action handicap explains at most a small part of the planners'
  B edge. The one-ply engines' A edge didn't come from it at all.
- **Remaining suspect: the openings themselves.** Heuristic placement is
  near-deterministic (~80–90 distinct opening boards per 400 games, B
  always placing last), so seat numbers reflect a narrow set of openings
  under one placement policy. A planner mirror with randomized placement
  would separate rule bias from opening-book bias.
- **The obelisk race cools slightly.** Instant obelisk wins drop in every
  search-engine matchup (planner vs planner-obelisk 50% → 38%). Turn-cap
  finishes rise a little instead.
- **Everything else holds.** Round-robin draws stay ~2% (30 of 1440).
  Lookahead vs greedy stays 97%, and the standings barely move (40 games
  per pairing, so ±3-point shifts are noise): planner-obelisk 75.3%,
  planner 67.7%, turtle 65.0%, lookahead-obelisk 64.5%, tempo 60.3%,
  lookahead 59.4%, aggro 39.5%, greedy 15.9%, random 2.3%.

## Obelisk-victory awareness (engines)

*[AI - Claude]: Obelisk-victory defense — simulation findings*

Human players beat the lookahead engines by racing for three obelisks. To
measure the fix, scripted obelisk rushers stand in for that player: `rush`
(one-ply, heavy obelisk weights, never fades) and `rush-planner` (the same
weights with full-turn beam search). Both stay frozen on the pre-change
evaluator. Defenders are compared old → new on the same seeds (100 games,
60 for the planners vs `rush`).

| Defender | vs rush: rusher obelisk wins | rusher pts | vs rush-planner: rusher obelisk wins | rusher pts |
|---|---|---|---|---|
| lookahead | 10 → 4 | 47.5 → 45% | 18 → 11 | 69 → 62.5% |
| lookahead-obelisk | 8 → 7 | 52 → 43.5% | 19 → 18 | 64.5 → 59% |
| planner | 3 → 4 (of 60) | 47.5 → 57.5% | 14 → 15 | 59 → 63.5% |
| planner-obelisk | 2 → 3 (of 60) | 25 → 34% | 15 → 12 | 47 → 48% |
| greedy | 7 → 5 | 98 → 96.5% | — | — |

- **Why the engines lost to obelisk play.** Neither one-ply nor own-turn
  search models the opponent's turn. The evaluator saw an obelisk loss
  only once three were held. Its threat term counted only one enemy
  attack's material, and it priced denial like ~2 points of material.
  Meanwhile a two-obelisk army takes the third in a 3–6 action turn: bonus
  moves and spawns, air swaps, water bounces, and reaction abilities fired
  on the defender's own turn. When a two-action win was already on the
  board, old lookahead blocked it 2 times in 100.
- **One-ply engines improve most.** Lookahead's obelisk losses fall
  ~40–60%, and it wins more obelisk races itself (obelisk wins vs `rush`
  15 → 27).
- **The planners hold steady.** Their obelisk losses don't change, and
  the point swings are within noise (±5–6 pts at these sizes).
- **Correction: planners need the own-reach bonus.** It was briefly off for
  planners, on the theory that their search already finds their own
  finishes. A human game showed that theory was wrong. The planner held
  earth and water against an army of two 3s. A two-turn air win was
  available (5 to a4, a scout toward a3, then 5×b4 and the scout into a4),
  and it shuffled scouts back and forth instead. The search only spans the
  current turn. From that position: 0 of 20 playouts won within 10 turns
  with the bonus off; 20 of 20 won in 3 turns with it on (30 or 60 alike).
  With the bonus on, planner mirrors end on obelisks more often
  (planner-obelisk mirror 63%, seat B 76% of decided games) — a balance
  question for the rules, not an engine bug.
- **What remains is mostly double threats.** When the rusher holds two
  obelisks with two reachable thirds, no single defense works. Defending
  earlier (a flat brink cost, an approach term) made engines over-defend
  corners and lose the material fight, so those knobs are off. The
  full-turn rusher's residual edge over lookahead is mostly search depth:
  most of its wins are eliminations.
- **Effect on engine-vs-engine play.**
  - Lookahead mirror: obelisk wins 20.5% → 37%, turn-cap finishes
    35% → 17.5%, seat A 58% → 42%.
  - Planner mirrors: unchanged within noise (planner-obelisk mirror:
    obelisk wins 46.5% → 40.5%, seat A 38% → 37%).
  - Lookahead vs greedy: still 97%.
  - Round robin: planner-obelisk 72.2%, lookahead-obelisk 69.4% (was
    64.5%), planner 63.9%, lookahead 62.5%, turtle 62.5%, tempo 61.6%,
    aggro 40.6%, greedy 14.8%, random 2.5%. Draws ~2%.

## 4×4 partition board and placement styles

*[AI - Claude]: 4×4 partition and split-placement findings*

Layout `4x4-partition` (now the default): a 4×4 board, obelisks on
interior corners [1,1] [3,1] [1,3] [3,3] (every territory touches exactly
one), five starting scouts, and `placementStacking` on. The old 5×5 corners
don't work on 4×4: water would touch a single cell and could never be
controlled. (Measured when it was a `configs/` preset; the numbers below
are unchanged under the layout.)

**Placement styles, head-to-head within each engine** (4×4 preset, 200
games per pairing for greedy, 100 for the rest):

| Engine | split | split-stack | single | single-stack |
|---|---|---|---|---|
| greedy | **60.5%** | 51.1% | 47.9% | 40.5% |
| lookahead | **72.8%** | 47.5% | 54.0% | 25.7% |
| planner | **71.7%** | 55.2% | 49.7% | 23.5% |
| planner-obelisk | **66.7%** | 60.2% | 37.3% | 35.8% |

On the default 5×5 board, split beats single too: lookahead 59%, greedy
56.5%, planner-obelisk 73.8%. So `split` is now the engines' default
placement. Two contingents take two actions each from turn 2 for the
same material, and the turn-1 one-contingent limit costs the opener less
than that is worth. Stacking hurts in nearly every pairing: a (1,1)
pair's turn-1 soldier doesn't pay for the territory it gives up (on the
partition board, territories are obelisk presence). Engines therefore
don't stack, though the rule still lets a human player do it.

**The game itself** (split placement for all engines; seat A = A's share
of decided games, ±3–5 pts):

| | 5×5, single (old) | 5×5, split | 4×4 preset, single | 4×4 preset, split |
|---|---|---|---|---|
| Seat A: greedy / lookahead / p-obelisk mirrors | 60 / 45 / 25% | 52 / 33.5 / 36% | 68 / 63 / 68% | 44.5 / 46 / 48% |
| Obelisk wins: lookahead / p-obelisk mirror | 40 / 63% | 14.5 / 36% | 8 / 10% | 13 / 28% |
| Draws: greedy / lookahead mirror | 9.5 / 5% | 8.8 / 1.5% | 16 / 7% | 20 / 5% |
| Median length: lookahead / p-obelisk mirror | 27 / 22 | 18 / 16 | 14 / 12 | 14 / 15 |
| Obelisk held before turn 1 | 33% | ~90% | 100% | ~30% |
| Lookahead vs greedy | 95% | 86% | 88.5% | 90% |

- **The 4×4 preset with split placement is the most even setup measured
  so far.** Every mirror sits within ~2 SE of 50%, including the planner
  mirror that favors B 75% on 5×5. Games run half as long as on 5×5, and
  obelisk wins matter without dominating.
- **The costs.** Greedy mirrors stall into draws more often (20%), and
  skill separates less than on 5×5. Round robin on the preset:
  planner-obelisk 77.7%, planner 66.6%, lookahead-obelisk 65.2%, tempo
  62.7%, lookahead 57.8%, aggro 50.9%, turtle 48.8%, greedy 19.7%, random
  0.8%. Draws 3%.
- **On 5×5, split placement parks groups beside obelisks.** About 90% of
  games start with an obelisk held. The lookahead mirror tilts toward B
  (33.5% A), while the greedy and planner mirrors move closer to even.

## Group advance (`groupAdvance` off → on)

*[AI - Claude]: Group advance — simulation findings*

A joint strike that breaks a territory now moves both strikers in. Pairs
that can't share a territory split the smaller striker on arrival, and the
enemy pushes the leftover one step (see *Rules as implemented*). Same seeds
for both settings, seats swapped; 400 games per greedy and lookahead
mirror, 150 per planner-obelisk mirror. "Joint" = joint strikes per game;
"pushed" = pieces displaced per game. Lengths are means.

| Mirror | Layout | Joint | Pushed | Draws | Mean turns | Seat A | Obelisk wins |
|---|---|---|---|---|---|---|---|
| greedy | 4x4-partition | 1.00 → 2.34 | 0.36 | 20.3 → 16.5% | 68.5 → 63.6 | 44.5 → 43.4% | 0 → 0.3% |
| lookahead | 4x4-partition | 0.48 → 0.82 | 0.19 | 5.8 → 5.8% | 27.9 → 28.4 | 44.8 → 47.7% | 12.5 → 12.8% |
| planner-obelisk | 4x4-partition | 0.55 → 0.55 | 0.25 | 0 → 0% | 22.6 → 19.2 | 49.3 → 50.7% | 26 → 22% |
| greedy | 5x5-classic | 2.24 → 2.35 | 0.30 | 8.8 → 8.0% | 53.1 → 50.7 | 52.1 → 53.5% | 0 → 0% |
| lookahead | 5x5-classic | 0.26 → 0.40 | 0.15 | 2.0 → 2.3% | 40.6 → 38.1 | 34.4 → 36.1% | 14.3 → 13.8% |
| planner-obelisk | 5x5-classic | 0.08 → 0.11 | 0.04 | 0.7 → 0.7% | 39.5 → 42.2 | 40.3 → 40.9% | 35.3 → 35.3% |
| greedy | hex13 | 2.20 → 1.23 | 0.38 | 6.3 → 4.3% | 48.2 → 44.0 | 44.5 → 42.0% | 0 → 0% |
| lookahead | hex13 | 0.60 → 0.86 | 0.26 | 6.3 → 8.0% | 25.9 → 27.5 | 45.9 → 45.1% | 7.3 → 5.8% |
| planner-obelisk | hex13 | 0.44 → 0.45 | 0.31 | 2.0 → 0% | 21.6 → 17.7 | 53.1 → 53.3% | 22 → 22.7% |

- **Joint strikes get more attractive, and still stay rare.** Lookahead
  uses them ~40–70% more often, but it's under one per game out of 3–5
  attacks. Moving the whole group in beats the old outcomes: largest
  striker alone, or every striker devolved at home with nobody taking the
  territory.
- **What engines strike with** (rule on, all joint strikes over the
  runs above):

  | Pair vs defense | lookahead 4×4 | planner-obelisk 4×4 | lookahead hex13 | planner-obelisk hex13 |
  |---|---|---|---|---|
  | 2+3 vs 3 — moves in whole as (3,2) | 164 | 29 | 149 | 12 |
  | 2+2 vs 3 — (2,1) + a pushed scout | 54 | 32 | 80 | 30 |
  | 2+3 vs 1 or 2 | 78 | 5 | 77 | 6 |
  | 2+2 vs 1 or 2 | 9 | 8 | 12 | 15 |
  | 3+3 (any) — (3,2) + a pushed 1 | 12 | 6 | 14 | 5 |
  | other | 12 | 3 | 11 | 0 |

  2+3 into a 3 leads for lookahead: a lone 3 would only trade evenly
  (exact tie), and the old rule devolved both strikers at home. The
  2+2-into-a-3 split leads for the planner. Only 2+2 and 3+3 groups push
  a piece: 23% of lookahead's joint strikes and 55% of planner-obelisk's on
  4×4 (31% and 74% on hex13).
- **Planner games end sooner on the small boards** (4×4 22.6 → 19.2
  turns, hex13 21.6 → 17.7), with a few more eliminations. On 5×5 the
  rule barely comes up (0.1 joint strikes per game).
- **The pushed piece always found room.** No displaced piece went back
  to the sideboard in these runs: the strikers' vacated origins are
  always adjacent to the captured territory.
- **Seat balance and the obelisk race don't move** beyond noise (±2.5–4
  pts). Greedy mirrors draw less on 4×4 (20.3 → 16.5%). Greedy's own
  joint-strike use moves both ways (more on 4×4, fewer on hex13): its
  flat scoring now prices the forced split on every 2+2, including the
  redundant ones where a single 2 would have done.
- **Round robin on 4x4-partition (40 games per pairing), off → on:**
  planner-obelisk 77.7 → 78.6%, lookahead-obelisk 65.2 → 66.4%, tempo
  62.7 → 64.2%, planner 66.6 → 63.3%, lookahead 57.8 → 59.4%, turtle
  48.8 → 49.4%, aggro 50.9 → 48.4%, greedy 19.7 → 19.2%, random
  0.8 → 1.1%. Every shift is within noise (±2.8 pts). Draws 3.0 → 2.5%.
  The off run reproduces the 4×4 section's standings exactly, so the
  knob's off path is the old rule.
- **Who picks the landing spot:** lookahead and the planners simulate
  each legal spot and take the one that scores best for them. Greedy
  (and the human side, auto-planned) uses `defaultDisplacement`: an
  empty territory, beside as many of its own territories as possible
  (exposed), off the obelisk rings. Random picks at random.
- The layout tables at the top were measured before this rule. Their
  shifts are the deltas above.

## Two mechanics per contingent (`maxActionTypesPerContingent` 2)

*[AI - Claude]: Two-mechanic limit — simulation findings*

A contingent's turn used to be at most 2 actions of any mechanics. Now it
is any number of actions of at most 2 mechanics, paid from its strength.
Strength 5 could move three scouts, then spawn twice. Obelisk bonuses
still fund extra actions, of a third mechanic. The opener still acts with
one contingent on turn 1, but now plays a normal turn (`firstTurnActions`
null, was 2).

Old rule (2 actions, opener capped at 2) → new rule, same seeds, seats
swapped, both with the updated engines (below); 400 games per greedy and
lookahead mirror, 150 per planner-obelisk mirror. "Actions" = mean actions
per contingent per turn (max seen); under the old rule obelisk-funded
extras could pass 2. Seat A = A's share of decided games.

| Mirror | Layout | Actions | Mean turns | Seat A | Draws | Obelisk wins |
|---|---|---|---|---|---|---|
| greedy | 4x4-partition | 1.66 → 2.03 (max 13) | 63.6 → 49.8 | 43.4 → 49.0% | 16.5 → 12.3% | 0.3 → 0% |
| lookahead | 4x4-partition | 1.62 → 2.03 (max 13) | 25.9 → 18.0 | 43.2 → 51.1% | 5.0 → 1.8% | 11.5 → 19.5% |
| planner-obelisk | 4x4-partition | 1.71 → 2.18 (max 14) | 21.7 → 17.6 | 46.5 → 56.8% | 4.0 → 1.3% | 26.7 → 27.3% |
| greedy | hex13 | 1.44 → 1.62 (max 10) | 44.0 → 47.7 | 42.0 → 39.9% | 4.3 → 5.5% | 0 → 0.3% |
| lookahead | hex13 | 1.71 → 2.16 (max 14) | 27.7 → 16.9 | 43.5 → 53.1% | 7.5 → 3.5% | 6.0 → 9.8% |
| planner-obelisk | hex13 | 1.78 → 2.52 (max 13) | 22.1 → 12.1 | 51.7 → 49.0% | 3.3 → 0.7% | 26.0 → 21.3% |
| greedy | 5x5-classic | 1.52 → 1.90 (max 12) | 50.7 → 49.1 | 53.5 → 53.1% | 8.0 → 5.8% | 0 → 0% |
| lookahead | 5x5-classic | 1.54 → 1.76 (max 14) | 41.6 → 35.4 | 35.3 → 51.2% | 1.5 → 3.8% | 16.0 → 13.8% |
| planner-obelisk | 5x5-classic | 1.63 → 1.87 (max 12) | 32.2 → 29.0 | 37.3 → 43.8% | 0 → 2.7% | 33.3 → 35.3% |

- **Turns get busier, not explosive.** About 2 actions per contingent per
  turn on average (was ~1.6). The budget binds before the mechanic limit
  does: most contingents are worth a few points. Big turns happen — 13–14
  actions — when a large contingent spends on scouts.
- **Development speeds up.** Spawns and evolves rise from ~43% to ~55% of
  lookahead's actions on 4×4 and hex13; moves fall from ~47% to ~34%.
  Spawn-then-evolve chains now fit in one turn.
- **Search-engine games end sooner**: lookahead 26 → 18 turns on 4×4,
  28 → 17 on hex13; planner-obelisk on hex13 22 → 12. The experimental
  4x4-diamond shortens most (lookahead mirror 28 → 11.6, 200 games).
- **Seat balance is better than under the old rule.** With the opener
  capped at 2 actions while every later turn is uncapped, seat B won
  60–71% of decided search-engine games. A normal opening turn is the most
  even setting measured (A's share of decided games, 400 lookahead / 100
  planner-obelisk games per cell):

  | Turn-1 cap | lookahead 4×4 / hex13 / 5×5 | planner-obelisk 4×4 / hex13 / 5×5 | greedy 4×4 / hex13 / 5×5 |
  |---|---|---|---|
  | 2 actions | 38.9 / 32.1 / 40.2% | 33 / 36 / 29% | 41.9 / 34.5 / 50.9% |
  | 3 actions | 49.5 / 56.3 / 49.0% | 58 / 48 / 37% | 45.5 / 42.7 / 52.6% |
  | none (default) | 51.1 / 53.1 / 51.2% | 59 / 45 / 39% | 49.0 / 39.9 / 53.1% |

  The planner-obelisk mirror on 5×5 still favors B (as it did before).
- **Engines needed two guards** (lookahead and the planners). With
  unchanged engines, they walked pieces out and back within a turn:
  15–17 such reversals per lookahead game (was ~9.5) and 7.5–15 per
  planner game (was 0.7–1.9). The lookahead's pass margin
  (accept a slightly worse position rather than idle) was granted per
  action, so many actions compounded it. Now the margin covers only a
  contingent's first 2 actions each turn, and a move that exactly reverses
  one of the engine's own moves that turn is never taken. Reversals drop
  to 0. Greedy is unchanged and still shuttles (~12 per 4×4 game; ~13
  under the old rule).
- **Skill still separates.** Lookahead vs greedy (200 games): 4×4
  86.5 → 90.0%, hex13 87.5 → 90.0%, 5×5 86.5 → 90.5%.
- **Round robin on 4x4-partition (40 games per pairing), against the
  group-advance run:** planner-obelisk 78.6 → 80.2%, planner
  63.3 → 70.9%, lookahead-obelisk 66.4 → 66.9%, lookahead 59.4 → 58.6%,
  tempo 64.2 → 58.4%, turtle 49.4 → 54.4%, aggro 48.4 → 43.4%, greedy
  19.2 → 15.8%, random 1.1 → 1.4%. Draws 2.5 → 2.2%. Full-turn planning
  gains most (planner +7.6 pts): longer turns reward planning them. These
  shifts mix the rule with the engine guards, and ±2.8 pts is noise.
- **Cost:** planner games take ~40–55% longer to simulate (4×4
  242 → 373 ms per game).
- The layout tables at the top were measured under the old rule.

## Rank costs (`rankCosts`, `evolveCost: 'larger'`)

*[AI - Claude]: Rank costs — simulation findings*

Moving into an empty territory, attacking and evolving now cost one
fibonacci step below the piece involved (for evolve, the piece made):
soldier 1, chieftain 2, warlord 3, behemoth 5. Before, a move into empty
ground or an attack cost the piece's full value, and an evolve cost the
smaller constituent. Net effect: moves into empty ground and attacks get
cheaper, and evolves get dearer (1+2→3 was 1, now 2; 2+3→5 was 2, now 3;
3+5→8 was 3, now 5). Moving onto your own piece (the value difference) and
scouts (1) are unchanged.

Old → new costs, same seeds, seats swapped, both under the two-mechanic
rule; 400 games per greedy and lookahead mirror, 150 per planner-obelisk
mirror. Attacks are from the lookahead mirror.

| Mirror | Layout | Mean turns | Seat A | Obelisk wins | Draws |
|---|---|---|---|---|---|
| greedy | 4x4-partition | 49.8 → 48.7 | 49.0 → 50.8% | 0 → 0.5% | 12.3 → 10.5% |
| lookahead | 4x4-partition | 18.0 → 16.6 | 51.1 → 55.8% | 19.5 → 18.3% | 1.8 → 2.8% |
| planner-obelisk | 4x4-partition | 17.6 → 16.5 | 56.8 → 58.8% | 27.3 → 28.7% | 1.3 → 1.3% |
| greedy | hex13 | 47.7 → 49.3 | 39.9 → 43.7% | 0.3 → 0% | 5.5 → 4.5% |
| lookahead | hex13 | 16.9 → 14.1 | 53.1 → 47.6% | 9.8 → 13.8% | 3.5 → 5.0% |
| planner-obelisk | hex13 | 12.1 → 13.4 | 49.0 → 53.8% | 21.3 → 12.7% | 0.7 → 3.3% |
| greedy | 5x5-classic | 49.1 → 39.7 | 53.1 → 50.3% | 0 → 0% | 5.8 → 5.5% |
| lookahead | 5x5-classic | 35.4 → 26.7 | 51.2 → 50.0% | 13.8 → 16.8% | 3.8 → 3.5% |
| planner-obelisk | 5x5-classic | 29.0 → 18.7 | 43.8 → 43.6% | 35.3 → 32.7% | 2.7 → 0.7% |

| Lookahead mirror | 4x4-partition | hex13 | 5x5-classic |
|---|---|---|---|
| Attacks per turn | 0.18 → 0.25 | 0.22 → 0.29 | 0.10 → 0.15 |
| Exact-tie trades (share of attacks) | 41 → 36% | 37 → 35% | 42 → 35% |
| Moves (share of actions) | 35 → 36% | 33 → 28% | 61 → 52% |
| Evolves (share of actions) | 19 → 17% | 20 → 20% | 12 → 14% |

- **More fighting, sooner.** Attacks per turn rise 30–50% for lookahead,
  and fewer of them are even trades (exact ties). Greedy's attack share
  rises too (4×4 13 → 18% of actions, hex13 21 → 28%), and its evolve
  share falls (14 → 10%, 12 → 9%).
- **The big board shrinks most.** Cheap moves into open ground matter most
  where there is open ground: 5×5 games shorten by a quarter to a third
  (lookahead 35 → 27 turns, planner-obelisk 29 → 19, greedy 49 → 40),
  and lookahead moves less there. On 4×4 and hex13 game lengths move by
  1–3 turns.
- **Seat balance holds** within ~2 SE everywhere. The lookahead mirror on
  4×4 tips slightly to A (55.8%, ~2 SE). The first-turn setting
  (`firstTurnActions` null) still fits.
- **Obelisk wins** move both ways (planner-obelisk on hex13 21 → 13%, on
  4×4 27 → 29%), inside noise except hex13.
- **Skill separates slightly more.** Lookahead vs greedy (200 games): 4×4
  90.0 → 90.0%, hex13 90.0 → 92.5%, 5×5 90.5 → 92.5%.
- **Round robin on 4x4-partition (40 games per pairing), against the
  two-mechanic run:** planner-obelisk 80.2 → 78.1%, planner
  70.9 → 76.3%, lookahead-obelisk 66.9 → 68.8%, lookahead 58.6 → 56.6%,
  turtle 54.4 → 56.4%, tempo 58.4 → 52.8%, aggro 43.4 → 41.9%, greedy
  15.8 → 19.1%, random 1.4 → 0.2%. Draws 2.2 → 2.1%. The economy
  archetype (tempo) loses most as evolves get dearer. Aggression gains
  nothing from cheaper attacks: the attack-hungry preset stays last among
  the lookaheads.

## All-obelisk victory (`obeliskVictoryCount` 3 → all)

*[AI - Claude]: All-obelisk victory — simulation findings*

The instant obelisk win now needs every obelisk at once (four) instead of
any three. Same seeds, seats swapped, current rules otherwise; 400 games
per greedy and lookahead mirror, 150 per planner-obelisk mirror.

| Mirror | Layout | Obelisk wins | Eliminations | Mean turns | Seat A |
|---|---|---|---|---|---|
| lookahead | 4x4-partition | 18.3 → 0.8% | 75.0 → 92.0% | 16.6 → 18.3 | 55.8 → 57.1% |
| planner-obelisk | 4x4-partition | 28.7 → 0.7% | 66.7 → 92.7% | 16.5 → 19.8 | 58.8 → 56.8% |
| lookahead | hex13 | 13.8 → 0.5% | 78.5 → 86.5% | 14.1 → 24.9 | 47.6 → 52.4% |
| planner-obelisk | hex13 | 12.7 → 0% | 82.7 → 98.7% | 13.4 → 11.2 | 53.8 → 53.0% |
| lookahead | 5x5-classic | 16.8 → 0.8% | 72.3 → 85.0% | 26.7 → 34.0 | 50.0 → 52.7% |
| planner-obelisk | 5x5-classic | 32.7 → 5.3% | 62.0 → 84.7% | 18.7 → 32.1 | 43.6 → 46.3% |
| lookahead | 4x4-diamond | 32.0 → 14.8% | 64.8 → 80.0% | 10.4 → 11.3 | 37.5 → 34.7% |
| planner-obelisk | 4x4-diamond | 56.7 → 24.7% | 41.3 → 72.0% | 9.3 → 11.3 | 56.4 → 44.9% |

- **Obelisk wins all but disappear on the three main boards** (0–5% of
  search-engine games, was 13–33%). Holding all four means holding the
  enemy's side of the board too; an army strong enough for that likely
  eliminates the enemy first. Only the experimental 4x4-diamond, whose
  obelisks ring the center, keeps a real obelisk race (15–25%).
- **Elimination becomes the ending** (85–99% of search-engine games).
  Most search-engine games run longer (lookahead on hex13 14 → 25 turns,
  planner-obelisk on 5×5 19 → 32). Greedy mirrors don't change (they almost never won on
  obelisks).
- **Obelisks still matter.** Bonus budget, abilities and auras are
  untouched, and the round robin barely moves (4×4, 40 games per pairing,
  against the rank-cost run): planner-obelisk 78.1 → 78.6%, planner
  76.3 → 75.2%, lookahead-obelisk 68.8 → 66.7%, tempo 52.8 → 57.2%,
  turtle 56.4 → 56.1%, lookahead 56.6 → 55.9%, aggro 41.9 → 41.4%, greedy
  19.1 → 18.8%, random 0.2 → 0.2%. Draws 2.1 → 1.9%. The map-control
  presets still lead.
- **Seat balance mostly holds.** The 4×4 search mirrors sit at ~57% for
  A (lookahead was already 56% before this change). On 4x4-diamond the lookahead mirror favors B (35% A).
- **Skill:** lookahead vs greedy (200 games) stays at 89.5–92%.

## Current observations (300-game matchups, seats swapped, 5×5, devolve combat)

These observations predate the five-scout change (two scouts per army).

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
- **Reactive abilities balanced the elements and cut draws again.** With
  reaction windows (60 strong-engine games): fire 51, earth 48, water 38,
  air 15 — every element now sees play (air's positional displacements
  finally fire because lookahead *simulates* reactions and takes only real
  gains). Greedy mirrors are down to 9.3% draws, lookahead-vs-greedy to
  ~32%, and games run noticeably faster. Engines opt into reactions via a
  `chooseReaction(state, army, options, rng)` hook — random fires ~30% of
  windows, greedy uses flat element values, lookahead simulates.
- Lessons from building lookahead: a one-ply evaluator needs an
  "evolve-ready pairs" term to see development chains, must price passing
  as losing tempo, and needs a **three-tier spawn-access model**: open now /
  unlockable in one move (small flat tempo penalty) / permanently entombed
  (sideboard scouts count as dead). Binary versions of that term caused two
  opposite pathologies — armies that evolved into unspawnable fortresses,
  and armies that refused to ever fill their last scout slot.
- **Shuttle loops are the recurring engine failure mode.** Three separate
  bugs made engines shuffle one piece back and forth forever: a no-op
  repelled-attack exploit, obelisk-hold annuities outbidding endgame
  conversion, and greedy's obelisk pull double-counting a piece moving
  within the same obelisk's adjacency (always "one move from control").
  Every fix was found by reconstructing a stuck position from a screenshot
  and dumping candidate scores — the `debug: true` engine option exists for
  exactly this.
- **Standing balance item**: with turtling gone, seat B (second player)
  wins ~65-70% of decided mirror games across engines — the 1-contingent/
  1-action turn-1 handicap now overshoots. Re-sweep `firstTurnActions`/
  `firstTurnContingents` next time the rules settle.
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
