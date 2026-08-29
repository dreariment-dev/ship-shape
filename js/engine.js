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
  state.crewNames ??= Object.fromEntries(CREW.map((c) => [c.id, c.name]));
  state.deckNames ??= Object.fromEntries(DECKS.map((d) => [d.id, d.name]));
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

function eligible(crewId, exclude = []) {
  const now = Date.now();
  return DUTIES.filter(
    (d) =>
      d.who.includes(crewId) &&
      !exclude.includes(d.id) &&
      state.duties[d.id].snooze < now
  );
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
    .filter((e) => e.crew === crewId && e.t >= since)
    .reduce((a, e) => a + e.pts, 0);
}

const weekTotal = (crewId) => totalSince(crewId, weekStart());
const monthTotal = (crewId) => totalSince(crewId, monthStart());
const lifetime = (crewId) => totalSince(crewId, 0);
// Counts actual duties, not the synthetic bonus entries — this drives the
// Cadet's droid count, and a drill bonus shouldn't conjure a free droid.
const countSince = (crewId, since) =>
  state.log.filter(
    (e) => e.crew === crewId && e.t >= since && !e.duty.startsWith('bonus:')
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
