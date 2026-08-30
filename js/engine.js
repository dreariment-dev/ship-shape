// Ship state and the rules that act on it. Everything persists to localStorage;
// there is no server, so this file is the whole back end.

const STORE_KEY = 'shipshape.v1';
const DAY = 86400000;

let state = null;

// ── Persistence ─────────────────────────────────────────────────────────────

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      state = JSON.parse(raw);
      reconcileRoster();
      return state;
    }
  } catch (err) {
    // A corrupt save is not worth losing the app over — start fresh rather
    // than leaving the user on a white screen with no way back.
    console.warn('Save unreadable, starting a new voyage', err);
  }
  state = seed();
  save();
  return state;
}

function save() {
  localStorage.setItem(STORE_KEY, JSON.stringify(state));
}

// Starting every duty at 100% fresh makes day one boring, and starting at 0%
// makes it a wall of shame. Stagger them so a handful are due and the ship
// opens somewhere around two thirds integrity.
function seed() {
  const now = Date.now();
  const duties = {};
  DUTIES.forEach((d) => {
    const age = d.days * DAY * (0.3 + Math.random() * 0.9);
    duties[d.id] = { last: now - age, skips: 0, snooze: 0 };
  });
  return {
    v: 1,
    crewNames: Object.fromEntries(CREW.map((c) => [c.id, c.name])),
    deckNames: Object.fromEntries(DECKS.map((d) => [d.id, d.name])),
    duties,
    log: [],
    missions: {},
    activeCrew: 'adult',
  };
}

// The roster in data.js may gain or lose duties between releases. Add state for
// anything new, and leave orphaned entries alone so a duty that comes back
// doesn't lose its history.
function reconcileRoster() {
  const now = Date.now();
  DUTIES.forEach((d) => {
    if (!state.duties[d.id]) {
      state.duties[d.id] = {
        last: now - d.days * DAY * (0.3 + Math.random() * 0.9),
        skips: 0,
        snooze: 0,
      };
    }
  });
  // Backfill per entry rather than per object: a save from an earlier release
  // has a names map, just one missing the decks added since. Existing entries
  // are left alone so the crew's own renames survive an update.
  state.missions ??= {};
  state.crewNames ??= {};
  state.deckNames ??= {};
  CREW.forEach((c) => { state.crewNames[c.id] ??= c.name; });
  DECKS.forEach((d) => { state.deckNames[d.id] ??= d.name; });
}

// ── Decay ───────────────────────────────────────────────────────────────────

const dutyById = Object.fromEntries(DUTIES.map((d) => [d.id, d]));
const deckById = Object.fromEntries(DECKS.map((d) => [d.id, d]));

/** How overdue a duty is. 0 = just done, 1 = due now, >1 = overdue. */
function dueness(id) {
  const d = dutyById[id];
  const elapsed = Date.now() - state.duties[id].last;
  return elapsed / (d.days * DAY);
}

/** Inverse of dueness, clamped to 0–1. This is what the integrity bars show. */
function freshness(id) {
  return Math.max(0, Math.min(1, 1 - dueness(id)));
}

// Ducked jobs get more valuable until somebody finally takes them. The skirting
// boards become worth doing whether anyone likes them or not.
function hazardMult(id) {
  return Math.min(1 + 0.25 * state.duties[id].skips, 3);
}

function value(id) {
  return Math.round(dutyById[id].pts * hazardMult(id));
}

// Integrity is weighted by points rather than by count, so a filthy oven drags
// the galley down more than one unswept floor.
function integrityOf(dutyIds) {
  if (!dutyIds.length) return 1;
  let num = 0;
  let den = 0;
  dutyIds.forEach((id) => {
    const w = dutyById[id].pts;
    num += freshness(id) * w;
    den += w;
  });
  return num / den;
}

function deckIntegrity(deckId) {
  return integrityOf(DUTIES.filter((d) => d.deck === deckId).map((d) => d.id));
}

function shipIntegrity() {
  return integrityOf(DUTIES.map((d) => d.id));
}

// ── Dealing cards ───────────────────────────────────────────────────────────

/** Decks this crew member can be sent to. null in DECK_ACCESS means anywhere. */
function canAccess(crewId, deckId) {
  const allowed = DECK_ACCESS[crewId];
  return allowed === null || allowed === undefined || allowed.includes(deckId);
}

/**
 * Is this duty being held for whoever's patch it's on? Their own decks are
 * their responsibility, so nobody else is offered a job they can do there
 * until it's well past due and somebody has to step in.
 */
function heldForOwner(crewId, d) {
  // A duty can name its own owners, which wins over the deck's — that's how a
  // shared room can still contain somebody's personal standing order.
  const owners = d.owners ?? deckById[d.deck].owners;
  if (!owners || owners.includes(crewId)) return false;
  // Held only if an owner could actually do it — the adult-only jobs in a
  // child's room were never theirs to begin with.
  if (!owners.some((o) => d.who.includes(o))) return false;
  return dueness(d.id) < FIRST_REFUSAL;
}

function eligible(crewId, exclude = []) {
  const now = Date.now();
  return DUTIES.filter(
    (d) =>
      // Track duties are ticked off in their own strip, never dealt as cards —
      // four nightly habits would otherwise swamp the draw.
      !d.track &&
      canAccess(crewId, d.deck) &&
      d.who.includes(crewId) &&
      !heldForOwner(crewId, d) &&
      !exclude.includes(d.id) &&
      state.duties[d.id].snooze < now
  );
}

/** Decks a crew member has any business in — drives the Cadet's Ship tab. */
function decksFor(crewId) {
  return DECKS.filter((k) => canAccess(crewId, k.id));
}

/**
 * Deal one duty to a crew member. Favours the overdue and the hazard-laden, but
 * stays random enough that the same card doesn't come up every morning —
 * novelty is doing real work here, not just decoration.
 */
function draw(crewId, exclude = []) {
  const pool = eligible(crewId, exclude);
  if (!pool.length) return null;

  const ripe = pool.filter((d) => dueness(d.id) >= 0.5);
  const from = ripe.length ? ripe : pool;

  const weights = from.map((d) => Math.pow(Math.max(dueness(d.id), 0.05), 2) * hazardMult(d.id));
  const total = weights.reduce((a, b) => a + b, 0);
  let roll = Math.random() * total;
  for (let i = 0; i < from.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return from[i];
  }
  return from[from.length - 1];
}

/** The smallest job available — for when the tank is empty and anything counts. */
function rescue(crewId) {
  const pool = eligible(crewId).filter((d) => dueness(d.id) >= 0.3);
  if (!pool.length) return null;
  return pool.sort((a, b) => a.mins - b.mins || dueness(b.id) - dueness(a.id))[0];
}

/** Three distinct cards for a Red Alert drill. */
function drawSprint(crewId, n = 3) {
  const picked = [];
  for (let i = 0; i < n; i++) {
    const d = draw(crewId, picked.map((p) => p.id));
    if (!d) break;
    picked.push(d);
  }
  return picked;
}

// ── Missions ────────────────────────────────────────────────────────────────
//
// A duty is accepted before it's done, and one at a time — the accepted card
// is the whole of what you're being asked for. Children's missions then need
// signing off by an adult, which is the only check on the obvious problem
// with letting a five-year-old mark their own homework.

const needsSignOff = (crewId) => crewId !== 'adult';

function activeMission(crewId) {
  const m = state.missions?.[crewId];
  return m && dutyById[m.duty] ? m : null;
}

function acceptMission(crewId, dutyId) {
  state.missions ??= {};
  state.missions[crewId] = { duty: dutyId, at: Date.now() };
  save();
}

/** Handed back with no penalty — an abandoned job isn't a ducked one. */
function abandonMission(crewId) {
  if (state.missions) delete state.missions[crewId];
  save();
}

/** Everyone waiting on an adult, oldest first. */
function pendingSignOff() {
  return Object.entries(state.missions ?? {})
    .filter(([crewId, m]) => needsSignOff(crewId) && m && dutyById[m.duty])
    .map(([crewId, m]) => ({ crewId, ...m }))
    .sort((a, b) => a.at - b.at);
}

/** Approve: the merit goes to whoever did the work, not whoever signed it. */
function signOff(crewId) {
  const m = activeMission(crewId);
  if (!m) return 0;
  const pts = complete(m.duty, crewId);
  delete state.missions[crewId];
  save();
  return pts;
}

/** Sent back: not done, but not counted as ducked either. */
function sendBack(crewId) {
  abandonMission(crewId);
}

// ── Actions ─────────────────────────────────────────────────────────────────

function complete(dutyId, crewId, bonus = 1) {
  const pts = Math.round(value(dutyId) * bonus);
  const s = state.duties[dutyId];
  s.last = Date.now();
  s.skips = 0;
  s.snooze = 0;
  state.log.push({ t: Date.now(), crew: crewId, duty: dutyId, pts });
  save();
  return pts;
}

/** Swap: hazard pay goes up, card can still return later today. */
function swap(dutyId) {
  state.duties[dutyId].skips++;
  save();
}

/** Not today: hazard pay goes up and it's off the table until tomorrow. */
function dismiss(dutyId) {
  state.duties[dutyId].skips++;
  state.duties[dutyId].snooze = endOfToday();
  save();
}

function endOfToday() {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d.getTime();
}

// ── Resets ──────────────────────────────────────────────────────────────────

/**
 * Put the ship into a known state. Names the crew have set are always kept —
 * losing "Commander Alfie's Quarters" to a reset would be its own small
 * tragedy — as is which crew member is signed in.
 *
 *   fresh  — a new voyage: duties staggered as they are on first install
 *   due    — nothing done, every duty fully overdue, ship at 0%
 *   clean  — everything just done, ship at 100%
 *   scores — keep the ship as it is, wipe merit and droids back to zero
 */
function resetShip(mode) {
  const now = Date.now();
  if (mode !== 'scores') {
    DUTIES.forEach((d) => {
      const span = d.days * DAY;
      const age =
        mode === 'clean' ? 0
        : mode === 'due' ? span * 2 // dueness 2.0 — nothing done, nothing fresh
        : span * (0.3 + Math.random() * 0.9);
      state.duties[d.id] = { last: now - age, skips: 0, snooze: 0 };
    });
  }
  state.log = [];
  state.missions = {};
  save();
}

// ── Scores ──────────────────────────────────────────────────────────────────

function weekStart() {
  const d = new Date();
  const back = (d.getDay() + 6) % 7; // weeks run Monday to Sunday
  d.setDate(d.getDate() - back);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function monthStart() {
  const d = new Date();
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function totalSince(crewId, since) {
  return state.log
    .filter((e) => e.crew === crewId && e.t >= since && !e.track)
    .reduce((a, e) => a + e.pts, 0);
}

// ── Personal tracks ─────────────────────────────────────────────────────────

const trackFor = (crewId) => TRACKS[crewId] ?? null;

/** The habits on this crew member's track, in roster order. */
function trackDuties(crewId) {
  const t = trackFor(crewId);
  return t ? DUTIES.filter((d) => d.track === t.id && d.who.includes(crewId)) : [];
}

/** Ticked off within the last day — one per day is the whole point. */
const doneToday = (dutyId) => Date.now() - state.duties[dutyId].last < DAY;

function trackCount(crewId, since = weekStart()) {
  const t = trackFor(crewId);
  if (!t) return 0;
  return state.log.filter((e) => e.crew === crewId && e.track === t.id && e.t >= since).length;
}

/** Tick a habit. Earns no merit and no droid — that's the separation. */
function trackDone(dutyId, crewId) {
  const t = trackFor(crewId);
  state.duties[dutyId].last = Date.now();
  state.duties[dutyId].skips = 0;
  state.log.push({ t: Date.now(), crew: crewId, duty: dutyId, pts: 0, track: t.id });
  save();
}

const trackHit = (crewId) => {
  const t = trackFor(crewId);
  return !!t && trackCount(crewId) >= t.goal;
};

const weekTotal = (crewId) => totalSince(crewId, weekStart());
const monthTotal = (crewId) => totalSince(crewId, monthStart());
const lifetime = (crewId) => totalSince(crewId, 0);
// Counts actual duties, not the synthetic bonus entries — this drives the
// Cadet's droid count, and a drill bonus shouldn't conjure a free droid.
const countSince = (crewId, since) =>
  state.log.filter(
    (e) => e.crew === crewId && e.t >= since && !e.track && !e.duty.startsWith('bonus:')
  ).length;

function crewById(id) {
  return CREW.find((c) => c.id === id);
}

/** Rank is measured in weeks-of-your-own-target, so everyone climbs alike. */
function rankOf(crewId) {
  const weeks = lifetime(crewId) / crewById(crewId).target;
  let current = RANKS[0];
  let next = null;
  for (let i = 0; i < RANKS.length; i++) {
    if (weeks >= RANKS[i].at) {
      current = RANKS[i];
      next = RANKS[i + 1] ?? null;
    }
  }
  const progress = next
    ? (weeks - current.at) / (next.at - current.at)
    : 1;
  return { current, next, progress, weeks };
}

/** Everyone who hit their own target this week has earned the award. */
function targetHit(crewId) {
  return weekTotal(crewId) >= crewById(crewId).target;
}
