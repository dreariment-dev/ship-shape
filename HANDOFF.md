# Ship Shape — handoff

Gamified cleaning for a household of four, themed as keeping a starship running.
Built 29–30 Aug 2026 in one session; twenty releases. **Nobody has used it
for a real week yet**, so every number below is a considered guess, not a
measured one.

Live at **https://dreariment-dev.github.io/ship-shape/** — install via Chrome's
*Add to Home Screen*. Public repo because free GitHub Pages requires it.

## Reviewed 31 Aug 2026

The change that made both children cadets and turned the hangar into a
permanent droid collection **has been through a code review** and the findings
are fixed. Worth keeping, because two of them are the kind that come back:

- **Droids die with the log.** All four resets clear `state.log`, and the
  hangar is counted off it — so every reset empties the hangar, not just
  `scores`. The confirm text says so now. If anything ever earns a droid from a
  source other than the log, this stops being true and the wording is a lie.
- **A speciality you can't reach isn't shown** (`specsFor` in `engine.js`).
  Sanitation is entirely in rooms the children can't be sent to, so for them it
  wasn't rare, it was impossible — and a locked slot reading "10 more to
  Sparky" is an unmeetable goal wearing a reward's clothes. The hangar's
  denominator is per-crew for the same reason. A test pins it.
- `.spec` as a CSS class was also matching the new duty-card chip; the hangar
  block is `.spec-row`.

**Still not verified: the UI has never been seen rendering** — that hasn't
changed, and the hangar layout is new and unseen. It's the first thing to check
on a device.

## The constraint that shaped everything

One of the two children has ADHD. That ruled out most of what chore-gamification
normally does, and the exclusions matter more than the features:

- **No streaks.** The inevitable broken streak punishes exactly the person the
  app exists to help. A test fails if a goal is set so high it can only be met
  by never missing a day — a streak in disguise. The hangar is the answer to
  wanting the *pull* of a streak: a collection only grows, so a bad week costs
  you nothing you already had. A test pins that droids are never taken back.
- **No overdue list, no red.** Rooms *decay* instead, and status wording
  describes the kit rather than the person: holding, due now, degrading,
  failing, critical. "Failing" is a thing to go and fix; "you're late" is a
  telling-off.
- **One card at a time on the home screen.** Choosing is the hard part. The room
  detail view is the one deliberate exception — a room you opened, showing five
  things, is a different act from a wall of ninety-six. Taking several jobs at
  once lives *there* and nowhere else, for that reason: the draw still deals
  exactly one card, and picking a handful is something you go and do on purpose.
- **Activation energy is the enemy**, not laziness — hence the smallest-job
  button and the timed drill.

If a change reintroduces guilt-by-dashboard, that's a regression even when it
looks like a feature.

## Model

`js/data.js` is the ship, `js/engine.js` is the rules, `js/ui.js` renders.

**Decks** are rooms (10). **Duties** are jobs (96: 92 chores + 4 personal-track
habits). Cadence sets both how fast a duty goes stale and what it pays: daily,
often (3d), weekly, fortnightly (14d), monthly, seasonal (90d). Dueness is
elapsed ÷ cadence; deck integrity is the points-weighted freshness of its
duties; ship integrity is the same across all of them.

**The draw** weights by `dueness² × hazard`, deliberately random so the same
card doesn't come up every morning.

**Pay rises two ways, and they compound.** `hazardMult` is 25% per swap-away,
capped ×3. `neglectMult` is half again per cadence-length past due, capped ×2.
`payMult` multiplies them and caps the result at ×3. The second one matters:
without it the dread tax only ever caught duties somebody bothered to duck, and
quietly-forgotten jobs stayed cheap forever.

**Eligibility clears three gates**, independent on purpose:

1. `DECK_ACCESS` — where you can be sent. Children get their own quarters, the
   Playroom, the Bridge and the Galley; adults go anywhere.
2. `who` on the duty — whether the job is safe for you. Chemicals, heights and
   heft stay with adults, *including in a child's own bedroom*.
3. `FIRST_REFUSAL` — your own patch is yours first. A duty an owner can do isn't
   offered to anyone else until 1.5× past due. Ownership sits on the deck
   (`owners`) or on the duty, and **the duty wins** — that's what lets the
   shared Galley hold the children's own standing orders.

The backstop in (3) matters as much as the reservation: without it a room nobody
touches decays forever with no way back.

**Missions.** Nothing completes on the spot. A duty is *accepted*, becoming part
of that crew member's single open mission, and a child's is then signed off by an
adult — the only check on a nine-year-old marking their own homework. A mission
holds a **list** of duties: one from a card, up to `MAX_MISSION` (3) picked from
a room, or whatever a drill cleared. One shape means the sign-off queue has one
thing to render and there's no second code path. Handing a mission back costs
nothing — abandoning isn't ducking, and only ducking should raise the price.

**A multi-job mission is ticked off one job at a time**, and this is where the
rules earn their keep. An adult's tick banks there and then and the job leaves
the mission, so what's on the card is always what's still outstanding. A child's
tick is only a *claim*; it pays nothing until an adult signs it, which is the
same rule the drill already ran on. Signing off pays for what was ticked and
**leaves the rest of the mission in place** rather than discarding it. Taking
three and doing two must never be worse than taking one — otherwise the honest
move is to under-commit, and the app would be teaching that.

**Both children are cadets on identical mechanics** — same merit economy, same
rank ladder, same hangar, one measure of a won week. What differs is only the
target (200 against 150), because they're balanced on real work and rank is a
multiple of *your own* target, so equal footing isn't the same as equal numbers.
There is no simple mode any more: the app is driven on one adult's phone with a
child beside them, so the reading-age branch had nothing left to do.

**Personal tracks** are a second, parallel economy: the younger child's Night
Watch (own bed, asleep by half eight) and the older one's Research (homework,
twenty minutes' reading). They earn no merit and no droids, carry no weight in
deck integrity, and never enter the draw — four nightly habits would swamp it.

**Droids are specialist badges**, earned for getting good at a *kind* of work
rather than for volume: three per speciality, seven specialities — fewer if you
can't reach them all — counted over your whole service and never reset. Every duty carries a `spec`, resolved once
from `SPECIALITIES` by name pattern — first match wins, so the order of that
list is load-bearing. The counts come off the log, like history, so there's no
tally to keep in step and nothing a reset can half-wipe.

**A duty's id is derived from its name**, so renaming one in the roster makes it
a *different* duty: fresh staggered decay, and everything logged under the old
id orphaned. Adding duties and retuning cadences are both clean — only renaming
costs anything. Because of that, `complete()` **stamps the speciality onto the
log entry** rather than looking it up later: a rename would otherwise take
earned droids back out of a hangar that promises never to, which is the failure
this whole mechanic exists to avoid. Entries from before the stamp fall back to
the lookup, so old saves keep their droids. Two tests pin both halves.

**Weeks turn over Friday 07:00**, because that's when the scores are read and
the treat is decided. Thursday evening counts toward the week being judged;
after the turn starts the next one.

**History is derived from the log, never snapshotted.** Every entry carries a
timestamp, so there's nothing to archive, no rollover job that can be missed
while the app is shut, and no stored figure that can drift from the record it
summarises. A won week is one measure for everybody — your own merit against
your own target — so history can't disagree with the weekly panel.

## Numbers, and why they are what they are

The decisions git won't explain.

**Integrity bands (`band()` in `ui.js`): green from 40%, amber from 25%.**
Full upkeep is ~10 hours of cleaning a week — every duty exactly on cadence,
honest for this house. Combined targets are 850. A house where *everyone hits
their target* settles near 45%, not 100. Green originally started at 70%, which
painted a well-run house red forever. **Raise these only if you also raise the
targets.**

**The two children are balanced on real work, not merit.** The nine-year-old's
74 min/week against the five-year-old's 56. That comparison is the whole reason
personal tracks exist: when bedtime paid merit, the younger child could win a
week on *twenty* minutes of actual cleaning against the older one's
seventy-seven. A test fails
if the ratio drifts past 1.6×. **Merit is not a workload measure — bedtime pays
well and isn't cleaning.** Check minutes before concluding anyone is
under-loaded; that error was made twice.

**Ranks are multiples of your own weekly target**, so a five-year-old scoring a
fifth of an adult climbs at the same rate. Nobody is ranked against anyone else.
There is no leaderboard and adding one would be a mistake: the adult wins every
week by construction.

**Droid thresholds are set against theoretical full upkeep**, which is every
duty done exactly on cadence and which nobody actually reaches — so halve the
pace in your head. At that ceiling the first droid of a speciality lands in one
to two weeks for a child and the third in ten to thirteen, meaning the top of a
speciality is realistically half a year of use. Two earlier shapes were wrong
in opposite directions and are worth not repeating: a lifetime *count* filled
up for good inside a fortnight and stopped being a reward, and a weekly count
that emptied every Friday was a streak with the serial numbers filed off.

**Sanitation is hidden from the children and the Galley is nearly out of
reach**, by construction — those duties live in rooms they can't be sent to. A
speciality with nothing you could ever be dealt isn't shown at all (`specsFor`),
because impossible and merely slow are different things; the Galley *is* merely
slow for the five-year-old and stays. The test demands everyone can reach *four*
first droids inside four weeks, so no hangar stays empty.

**Make the bed is deliberately not folded into "tidy your quarters".** It's one
concrete action with a visible result, which vague tidying isn't, and that
matters most for the youngest.

**Every room a child can reach carries the same five**: tidy, sweep or hoover,
dust weekly, skirting monthly, glass fortnightly. Behind-the-loo skirting and
the stair spindles stay adults-only — same name, different work.

## Verified, and not

`node tests/engine.test.js` — 73 tests, no framework, no dependencies. They pin
the safety rules, the access rules, first refusal *and* its backstop, that
nothing pays out before sign-off, that merit lands on whoever did the work, that
neglect raises pay and stays capped, the Friday week boundary in all four cases
around the turn, that history excludes the current week, that no single duty can
carry a week, that every target is reachable, and that renames survive all four
resets. Run them after touching `data.js`; several catch a mis-tuned target.

The hangar adds seven: that every duty maps to exactly one speciality and no track
duty maps to any, that thresholds climb, that everyone can reach four first
droids inside four weeks, that droids come off the log and a drill bonus earns
none, that **a droid earned weeks ago survives a bad week**, and that the v1
name migration renames the old defaults without touching a name the crew chose,
that **nobody is shown a droid they could never earn**, and that a droid
survives its duty being renamed — from both a stamped and an unstamped save.

Multi-job missions add nine: the cap holds, a job can't be taken twice, an
adult's tick banks and leaves the mission, a child's pays nothing until signed,
signing pays only for what was ticked **and keeps the rest**, an untouched
mission stays out of the sign-off queue, handing several back raises nobody's
hazard pay, and the one-job path behaves exactly as it always did.

`freshness()` is derived from elapsed time, so a just-completed duty reads
0.99999994 rather than 1. Assertions use a `near()` helper — **don't reintroduce
`strictEqual` against it**, that made the suite timing-dependent once already.

**Not verified: the UI has never been seen rendering.** Seventeen releases were
built, deployed and reasoned about without a single screenshot or a confirmed
device. Layout bugs are entirely plausible. That is the first thing to check.

## Next: a proper review, done independently

**This code has never been reviewed.** It was written in one long session by the
same agent that designed it, which means every blind spot in the design is also
a blind spot in the implementation, and the tests were written by the author of
the code they test — they encode the same assumptions and will happily agree
with a wrong one.

Do this as **separate agents on isolated areas**, each seeing only its own slice,
so the findings are genuinely independent rather than one reviewer's single
narrative applied to everything. Suggested split:

1. **`js/engine.js` — state and rules.** Decay, draw weighting, the two pay
   multipliers, integrity aggregation, the Friday week boundary and DST, history
   derivation, mission lifecycle, resets. Look for: off-by-one on cadence,
   integrity divide-by-zero on an empty deck, `pastWeeks` behaviour when the log
   is huge or empty, missions surviving a roster change.
2. **`js/ui.js` — rendering and events.** Re-render correctness, listeners on
   re-rendered nodes, overlay stacking, the crew switcher clearing state it
   should, and **XSS via renamed decks and crew — seventeen interpolations of
   user-set names go into `innerHTML` unescaped.**
3. **`js/data.js` — the roster.** Duplicate ids, unreachable duties, `who` and
   `owners` disagreeing, tier/points/minutes that don't match the work.
4. **`tests/engine.test.js` — the tests themselves**, reviewed by an agent that
   has *not* seen the review of the engine. Look for tests that assert current
   behaviour rather than intended behaviour, shared-`localStorage` order
   dependence (real: one reset test persists a clean ship into later tests), and
   gaps — sign-off, tracks and history are newest and thinnest.
5. **`sw.js` and the PWA shell.** Cache invalidation, the reload-on-
   controllerchange guard, offline behaviour on a cold start.

Have each report findings without proposing fixes, then reconcile. Anything two
independent agents flag separately is almost certainly real.

## Open

- **Targets are guesses.** 500 / 200 / 150 merit, 10 moons, 8 logs, and every
  droid threshold in `SPECIALITIES`. Tune after a real week — that data still
  doesn't exist.
- **Deck names are still placeholders.** `Cadet 1's Quarters` → the children's
  actual names, via ⚙ in the app. The defaults are deliberately plain because
  the repo is public; the renaming is a two-minute job on the device and has
  been flagged repeatedly as mattering more to them than any mechanic.
- **Should the five-year-old be doing windows?** They can be, by request. Glass
  cleaner and a five-year-old is a parenting call, not a code one.
- **"Sort out one toy box" is 20 minutes**, the largest single ask in the
  younger child's pool. Monthly, so it surfaces rarely, but it may want to be
  older-child-and-adults only.
- **Gaps against the standard set in the adults-only rooms**: Hydro Bay has no
  dust or skirting, Aux Sanitation no dust or windows, the Turbolift no windows
  or tidy.
- **Seven separate fortnightly window duties** could collapse into one campaign.
- **No sync, by design.** One device holds everything in `localStorage`. Two
  devices means two unrelated save files. A backend would undo the "runs
  entirely on your phone" property, so don't add one casually.

## Working on it

- Vanilla HTML/CSS/JS, no build step, no dependencies — it has to be quick on an
  old handset and editable without tooling. ~2,400 lines all in.
- **Bump `CACHE` in `sw.js` on every release** or installed phones keep the old
  files. The app reloads itself once when the new worker takes over, so nobody
  ever reinstalls. Currently `shipshape-v20`.
- `tools/build-roster.js` regenerates the browsable duty reference from
  `data.js`, reading the crew and roster live so it can't drift. Published at
  https://claude.ai/code/artifact/f90a70c4-95a8-465d-a12f-941c8a360bc2
- A briefing covering what was built and what could be done next:
  https://claude.ai/code/artifact/4e57ea6d-016d-4a4d-87a7-a169d01aaa10
- Settings (⚙) has four resets. `Nothing done` puts everything overdue at 0%
  integrity — the one for exercising the whole machine at once.
