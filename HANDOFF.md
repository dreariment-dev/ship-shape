# Ship Shape — handoff

Gamified cleaning for a household of four, themed as keeping a starship running.
Built 29–30 Aug 2026 in one session. **Nobody has used it for a real week yet**,
so every number below is a considered guess, not a measured one.

Live at **https://dreariment-dev.github.io/ship-shape/** — install via Chrome's
*Add to Home Screen*. Public repo because free GitHub Pages requires it.

## The constraint that shaped everything

One of the two children has ADHD. That ruled out most of what chore-gamification
normally does, and the exclusions matter more than the features:

- **No streaks.** The inevitable broken streak punishes exactly the person the
  app exists to help.
- **No overdue list, no red.** Rooms *decay* instead. Same information, but the
  room is grubby rather than the person having failed.
- **Never a list of jobs.** One card at a time. Choosing is the hard part.
- **Activation energy is the enemy**, not laziness — hence the smallest-job
  button and the 15-minute drill.

If you're changing something and it reintroduces guilt-by-dashboard, that's a
regression even if it looks like a feature.

## Model

Two files carry it: `js/data.js` is the ship, `js/engine.js` is the rules.

**Decks** are rooms (10). **Duties** are jobs (98), each with a cadence tier
that sets both how fast it goes stale and what it pays. A duty's *dueness* is
elapsed ÷ cadence; deck integrity is the points-weighted freshness of its
duties; ship integrity is the same across all of them.

**The draw** picks weighted by `dueness² × hazard`, deliberately random so the
same card doesn't come up every morning. **Hazard pay** rises 25% each time a
duty is swapped away, capping at ×3 — avoided jobs become the best-paid ones,
so the economy nags instead of the app.

**Eligibility clears three gates**, and they're independent on purpose:

1. `DECK_ACCESS` — where you can be sent. Children keep their own quarters and
   share the Playroom and Galley; adults go anywhere.
2. `who` on the duty — whether the job is safe for you. Chemicals, heights and
   heft stay with adults, *including in a child's own bedroom*.
3. `FIRST_REFUSAL` — your own patch is yours first. A duty an owner can do isn't
   offered to anyone else until 1.5× past due. Ownership sits on the deck
   (`owners`) or on the duty, and the duty wins — that's what lets the shared
   Galley contain the children's personal standing orders.

The backstop in (3) matters as much as the reservation: without it a bedroom
nobody touches decays forever and drags ship integrity down with no way back.

## Numbers, and why they are what they are

These are the decisions git won't explain.

**Integrity bands (`band()` in `ui.js`): green from 40%, amber from 25%.**
Full upkeep is 1844 merit/week — every duty done exactly on cadence, about 12
hours of cleaning, which is honest for this house. Combined weekly targets are
1100. So a house where *everyone hits their target* settles near 43%, not 100.
Green originally started at 70%, which would have painted a well-run house red
forever. **Raise these only if you also raise the targets.**

**The Cadet's night watch is priced to dominate.** Sleeping in their own bed and
being asleep by half eight are 25 merit each, five times anything else on their
sheet. Four nightly duties can yield 28 completions against a goal of 24, so a
week of good bedtimes and a clear table wins with no chores at all. That is
deliberate — seven consecutive good bedtimes for a five-year-old is a genuinely
good week. **If chores should matter more, lower the night watch merit; don't
raise the goal**, because raising the goal makes a realistic good week miss.

**Ranks are multiples of your own weekly target**, so a five-year-old scoring a
fifth of an adult climbs at the same rate. Targets are per-person and nobody is
ranked against anyone else — the crew standing shows all three against their
*own* numbers. There is no leaderboard, and adding one would be a mistake: the
adult wins every week by construction.

**The hangar is the Cadet's weekly goal made visible.** 24 slots, fills and
empties weekly. It used to count lifetime completions, which meant it filled
permanently inside a fortnight and stopped being a reward — don't revert that.

## Verified, and not

`node tests/engine.test.js` — 35 tests, no framework, no dependencies. They pin
the safety rules (a Cadet can never be dealt bleach or heights), the access
rules, first refusal *and* its backstop, that no single duty can carry a week,
that every target is reachable, and that renames survive all four resets. Run
them after touching `data.js`; several will catch a mis-tuned target.

**Not verified: the UI has never been seen rendering.** It was built, deployed
and reasoned about, but no screenshot was ever taken and no device has been
confirmed. Layout bugs are entirely plausible, especially on a small screen.
That is the first thing to check.

## Open

- **Targets are guesses.** 500 / 200 / 400 merit, 24 droids. Tune after a real
  week — that data doesn't exist yet.
- **Deck names are still generic.** `Crew Quarters` → the children's actual
  names, via ⚙ in the app. This was flagged as mattering more than any mechanic
  and hasn't been done.
- **"Sort out one toy box" is 20 minutes**, much the largest single ask in the
  Cadet's pool. Monthly, so it surfaces rarely, but it may want to be
  Commander-and-adults only.
- **No sync, by design.** One device holds everything in `localStorage`. Two
  devices means two unrelated save files. A backend would undo the "runs
  entirely on your phone" property, so don't add one casually.

## Working on it

- Vanilla HTML/CSS/JS, no build step, no dependencies — it has to be quick on an
  old handset and editable without tooling.
- **Bump `CACHE` in `sw.js` on every release** or installed phones keep the old
  files. The app reloads itself once when the new worker takes over, so nobody
  ever reinstalls.
- `tools/build-roster.js` regenerates the browsable duty reference from
  `data.js`; it reads the crew and roster live so the page can't drift from the
  app. Published at
  https://claude.ai/code/artifact/f90a70c4-95a8-465d-a12f-941c8a360bc2
- Settings (⚙) has four resets. `Nothing done` puts everything overdue at 0%
  integrity, which is the one for exercising the whole machine at once.
