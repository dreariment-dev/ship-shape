# Ship Shape — handoff

Gamified cleaning for a household of four, themed as keeping a starship running.
Built 29–30 Aug 2026 in one session, thirteen releases. **Nobody has used it for
a real week yet**, so every number below is a considered guess, not a measured
one.

Live at **https://dreariment-dev.github.io/ship-shape/** — install via Chrome's
*Add to Home Screen*. Public repo because free GitHub Pages requires it.

## The constraint that shaped everything

One of the two children has ADHD. That ruled out most of what chore-gamification
normally does, and the exclusions matter more than the features:

- **No streaks.** The inevitable broken streak punishes exactly the person the
  app exists to help. There's a test that fails if a goal is set so high it can
  only be met by never missing a day — a streak in disguise.
- **No overdue list, no red.** Rooms *decay* instead. Same information, but the
  room is grubby rather than the person having failed.
- **One card at a time on the home screen.** Choosing is the hard part.
- **Activation energy is the enemy**, not laziness — hence the smallest-job
  button and the timed drill.

If a change reintroduces guilt-by-dashboard, that's a regression even when it
looks like a feature.

## Model

`js/data.js` is the ship, `js/engine.js` is the rules, `js/ui.js` renders.

**Decks** are rooms (10). **Duties** are jobs (95: 91 chores + 4 personal-track
habits). Cadence sets both how fast a duty goes stale and what it pays. Dueness
is elapsed ÷ cadence; deck integrity is the points-weighted freshness of its
duties; ship integrity is the same across all of them.

**The draw** weights by `dueness² × hazard`, deliberately random so the same
card doesn't come up every morning. **Hazard pay** rises 25% each time a duty is
swapped away, capping at ×3 — avoided jobs become the best-paid ones, so the
economy nags instead of the app.

**Eligibility clears three gates**, independent on purpose:

1. `DECK_ACCESS` — where you can be sent. Children keep their own quarters and
   share the Playroom and Galley; adults go anywhere.
2. `who` on the duty — whether the job is safe for you. Chemicals, heights and
   heft stay with adults, *including in a child's own bedroom*.
3. `FIRST_REFUSAL` — your own patch is yours first. A duty an owner can do isn't
   offered to anyone else until 1.5× past due. Ownership sits on the deck
   (`owners`) or on the duty, and **the duty wins** — that's what lets the
   shared Galley hold the children's own standing orders.

The backstop in (3) matters as much as the reservation: without it a room nobody
touches decays forever with no way back.

**Missions.** Nothing completes on the spot. A duty is *accepted*, becoming that
crew member's single open mission, and a child's is then signed off by an adult
— the only check on a nine-year-old marking their own homework. A mission holds
a **list** of duties: one for a card, up to three for a cleared drill, so the
sign-off queue has one shape to render and there's no second code path. Adults
complete their own directly; nobody signs theirs. Handing a mission back costs
nothing — abandoning isn't ducking, and only ducking should raise the price.

**Personal tracks** are a second, parallel economy: the Cadet's Night Watch (own
bed, asleep by half eight) and the Commander's Research (homework, twenty
minutes' reading). They earn no merit and no droids, carry no weight in deck
integrity, and never enter the draw — four nightly habits would swamp it. They
are ticked off in their own strip.

## Numbers, and why they are what they are

The decisions git won't explain.

**Integrity bands (`band()` in `ui.js`): green from 40%, amber from 25%.**
Full upkeep is ~1840 merit/week — every duty done exactly on cadence, about 12
hours of cleaning, honest for this house. Combined targets are 850. A house
where *everyone hits their target* settles near 45%, not 100. Green originally
started at 70%, which painted a well-run house red forever. **Raise these only
if you also raise the targets.**

**The two children are balanced on real work, not merit.** Commander 79 min/week
against the Cadet's 62. That comparison is the whole reason personal tracks
exist: when bedtime paid merit, the Cadet could win a week on *twenty* minutes
of actual cleaning against the Commander's seventy-seven. A test fails if the
ratio drifts past 1.6×. **Merit is not a workload measure — bedtime pays well
and isn't cleaning.** Check minutes before concluding anyone is under-loaded.

**Ranks are multiples of your own weekly target**, so a five-year-old scoring a
fifth of an adult climbs at the same rate. Nobody is ranked against anyone else.
There is no leaderboard and adding one would be a mistake: the adult wins every
week by construction.

**The hangar is the Cadet's weekly goal made visible** — one slot per droid
needed, filling and emptying weekly. It used to count lifetime completions,
filled permanently inside a fortnight, and stopped being a reward.

**Make the bed is deliberately not folded into "tidy your quarters".** It's one
concrete action with a visible result, which vague tidying isn't, and that
matters most for the youngest.

## Verified, and not

`node tests/engine.test.js` — 49 tests, no framework, no dependencies. They pin
the safety rules, the access rules, first refusal *and* its backstop, that
nothing pays out before sign-off, that merit lands on whoever did the work, that
no single duty can carry a week, that every target is reachable, and that
renames survive all four resets. Run them after touching `data.js`; several
catch a mis-tuned target.

`freshness()` is derived from elapsed time, so a just-completed duty reads
0.99999994 rather than 1. Assertions use a `near()` helper — **don't reintroduce
`strictEqual` against it**, that made the suite timing-dependent once already.

**Not verified: the UI has never been seen rendering.** It was built, deployed
and reasoned about across thirteen releases, but no screenshot was ever taken
and no device confirmed. Layout bugs are entirely plausible. That is the first
thing to check.

## Next: a proper review, done independently

**This code has never been reviewed.** It was written in one long session by the
same agent that designed it, which means every blind spot in the design is also
a blind spot in the implementation, and the tests were written by the author of
the code they test — they encode the same assumptions and will happily agree
with a wrong one.

Do this as **separate agents on isolated areas**, each seeing only its own slice,
so the findings are genuinely independent rather than one reviewer's single
narrative applied to everything. Suggested split:

1. **`js/engine.js` — state and rules.** Decay, draw weighting, hazard,
   integrity aggregation, week/month boundaries, mission lifecycle, resets.
   Look for: off-by-one on cadence, integrity divide-by-zero on an empty deck,
   week rollover at midnight Sunday, missions surviving a roster change.
2. **`js/ui.js` — rendering and events.** Re-render correctness, listeners on
   re-rendered nodes, overlay stacking, the crew switcher clearing state it
   should, XSS via renamed decks/crew (names go into `innerHTML` unescaped —
   worth a specific look).
3. **`js/data.js` — the roster.** Duplicate ids, unreachable duties, `who` and
   `owners` disagreeing, tier/points/minutes that don't match the work.
4. **`tests/engine.test.js` — the tests themselves**, reviewed by an agent that
   has *not* seen the review of the engine. Look for tests that assert current
   behaviour rather than intended behaviour, shared-`localStorage` order
   dependence (real: one reset test persists a clean ship into later tests),
   and gaps — the sign-off flow and personal tracks are newest and thinnest.
5. **`sw.js` and the PWA shell.** Cache invalidation, the reload-on-
   controllerchange guard, offline behaviour on a cold start.

Have each report findings without proposing fixes, then reconcile. Anything two
independent agents flag separately is almost certainly real.

## Open

- **Targets are guesses.** 500 / 200 / 150 merit, 16 droids, 10 moons, 8 logs.
  Tune after a real week — that data doesn't exist yet.
- **Deck names are still generic.** `Crew Quarters` → the children's actual
  names, via ⚙ in the app. Flagged repeatedly as mattering more to them than any
  mechanic; still not done.
- **"Sort out one toy box" is 20 minutes**, the largest single ask in the
  Cadet's pool. Monthly, so it surfaces rarely, but it may want to be
  Commander-and-adults only.
- **Six separate window duties** across the house, all adults-only, ~80 min a
  month. Could collapse into one campaign.
- **No sync, by design.** One device holds everything in `localStorage`. Two
  devices means two unrelated save files. A backend would undo the "runs
  entirely on your phone" property, so don't add one casually.

## Working on it

- Vanilla HTML/CSS/JS, no build step, no dependencies — it has to be quick on an
  old handset and editable without tooling. ~2,100 lines all in.
- **Bump `CACHE` in `sw.js` on every release** or installed phones keep the old
  files. The app reloads itself once when the new worker takes over, so nobody
  ever reinstalls. Currently `shipshape-v13`.
- `tools/build-roster.js` regenerates the browsable duty reference from
  `data.js`, reading the crew and roster live so it can't drift. Published at
  https://claude.ai/code/artifact/f90a70c4-95a8-465d-a12f-941c8a360bc2
- Settings (⚙) has four resets. `Nothing done` puts everything overdue at 0%
  integrity — the one for exercising the whole machine at once.
