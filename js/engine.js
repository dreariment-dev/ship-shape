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
    v: 2,
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
  // Missions used to hold a single duty; drills made them a list.
  Object.entries(state.missions).forEach(([crewId, m]) => {
    if (m && m.duty && !m.duties) {
      state.missions[crewId] = { duties: [m.duty], at: m.at, drill: false };
    }
  });
  state.crewNames ??= {};
  state.deckNames ??= {};
  CREW.forEach((c) => { state.crewNames[c.id] ??= c.name; });
  DECKS.forEach((d) => { state.deckNames[d.id] ??= d.name; });
  migrateNames();
}

// v1 called one child Commander and the other Cadet, which put one a rank above
// the other before either had earned anything. Both are cadets now — but names
// persist across updates, so an installed copy would otherwise keep the old
// ones forever. Only a name that is still the untouched v1 default is replaced;
// anything the crew renamed themselves is theirs and stays.
const V1_DEFAULTS = {
  crew: { k9: 'Commander', k5: 'Cadet' },
  deck: { bunkb: "Commander's Quarters", bunkc: "Cadet's Quarters" },
};

function migrateNames() {
  if ((state.v ?? 1) >= 2) return;
  Object.entries(V1_DEFAULTS.crew).forEach(([id, was]) => {
    if (state.crewNames[id] === was) state.crewNames[id] = crewById(id).name;
  });
  Object.entries(V1_DEFAULTS.deck).forEach(([id, was]) => {
    if (state.deckNames[id] === was) state.deckNames[id] = deckById[id].name;
  });
  state.v = 2;
  save();
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

/**
 * Neglect raises the price too, not just active ducking. A job nobody has even
 * been offered can still rot, and it should get more attractive as it does —
 * otherwise the dread tax only ever catches the duties someone bothered to
 * swap away, and the quietly-forgotten ones stay cheap forever.
 *
 * Half again for each cadence-length past due, capped at double.
 */
function neglectMult(id) {
  const over = dueness(id) - 1;
  return over <= 0 ? 1 : Math.min(1 + over * 0.5, 2);
}

/** What a duty actually pays, both penalties combined and capped together. */
function payMult(id) {
  return Math.min(hazardMult(id) * neglectMult(id), 3);
}

function value(id) {
  return Math.round(dutyById[id].pts * payMult(id));
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

/** Decks a crew member has any business in — drives the Ship tab. */
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

/**
 * A mission holds a list of duties — one for an ordinary card, three for a
 * cleared drill. Keeping both in the same shape means the sign-off queue has
 * one thing to render and there's no second path to remember.
 */
function activeMission(crewId) {
  const m = state.missions?.[crewId];
  if (!m) return null;
  const duties = (m.duties ?? []).filter((id) => dutyById[id]);
  return duties.length ? { ...m, duties } : null;
}

function acceptMission(crewId, dutyId) {
  state.missions ??= {};
  state.missions[crewId] = { duties: [dutyId], at: Date.now(), drill: false };
  save();
}

/** A drill a child has cleared, banked whole for an adult to approve. */
function acceptDrill(crewId, dutyIds, full) {
  state.missions ??= {};
  state.missions[crewId] = { duties: [...dutyIds], at: Date.now(), drill: true, full };
  save();
}

/** What a mission is worth right now, before anyone signs anything. */
function missionValue(m) {
  const base = m.duties.reduce((a, id) => a + value(id), 0);
  const bonus = m.drill && m.full ? Math.round(m.duties.reduce((a, id) => a + dutyById[id].pts, 0) * 0.5) : 0;
  return { base, bonus, total: base + bonus };
}

/** Handed back with no penalty — an abandoned job isn't a ducked one. */
function abandonMission(crewId) {
  if (state.missions) delete state.missions[crewId];
  save();
}

/** Everyone waiting on an adult, oldest first. */
function pendingSignOff() {
  return Object.keys(state.missions ?? {})
    .filter((crewId) => needsSignOff(crewId) && activeMission(crewId))
    .map((crewId) => ({ crewId, ...activeMission(crewId) }))
    .sort((a, b) => a.at - b.at);
}

/** Approve: the merit goes to whoever did the work, not whoever signed it. */
function signOff(crewId) {
  const m = activeMission(crewId);
  if (!m) return 0;
  let pts = m.duties.reduce((a, id) => a + complete(id, crewId), 0);
  // The drill bonus is part of what's being approved, not a separate award.
  if (m.drill && m.full) {
    const bonus = Math.round(m.duties.reduce((a, id) => a + dutyById[id].pts, 0) * 0.5);
    state.log.push({ t: Date.now(), crew: crewId, duty: 'bonus:redalert', pts: bonus });
    pts += bonus;
  }
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
  // The speciality is stamped on the entry rather than looked up later. Duty
  // ids are derived from the duty's name, so renaming one in the roster makes
  // it a different duty and orphans everything logged under the old id —
  // which would silently take droids back out of a hangar that promises never
  // to. What was done is a fact about that moment; the log should hold it.
  state.log.push({ t: Date.now(), crew: crewId, duty: dutyId, pts, spec: dutyById[dutyId].spec });
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
 *
 * Every mode clears the log, and the hangar is counted off the log — so all
 * four empty it, not just `scores`. The confirm text in ui.js says so.
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

// The week turns over on Friday morning, because that's when the scores are
// read and the treat is decided. Thursday evening's work still counts to the
// week being judged; anything after the turn starts the next one.
const WEEK_DAY = 5; // Friday
const WEEK_HOUR = 7;

function weekStart(ref = Date.now()) {
  const d = new Date(ref);
  d.setDate(d.getDate() - ((d.getDay() - WEEK_DAY + 7) % 7));
  d.setHours(WEEK_HOUR, 0, 0, 0);
  // Landing after `ref` means we're before this morning's turn — the week
  // that counts is still the previous one.
  if (d.getTime() > ref) d.setDate(d.getDate() - 7);
  return d.getTime();
}

const WEEK_MS = 7 * DAY;

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
// Counts actual duties, not the synthetic bonus entries — a drill bonus is a
// reward for the jobs, not a job of its own. Feeds the service record.
const countSince = (crewId, since) =>
  state.log.filter(
    (e) => e.crew === crewId && e.t >= since && !e.track && !e.duty.startsWith('bonus:')
  ).length;

function crewById(id) {
  return CREW.find((c) => c.id === id);
}

// ── The hangar ──────────────────────────────────────────────────────────────
//
// Droids are earned by getting good at a kind of work, counted over your whole
// service and never reset. Like history, it's derived from the log rather than
// stored: the log already says who did what, so there's no separate tally to
// keep in step and nothing a reset can leave half-wiped.
//
// Nothing here is a competition and nothing here expires.

/**
 * The specialities a crew member can actually work in.
 *
 * Sanitation lives entirely in rooms the children can't be sent to, so for them
 * it isn't rare, it's arithmetically impossible — and a permanently locked row
 * reading "10 more to Sparky" for a droid that can never arrive is exactly the
 * unmeetable goal this app refuses to put in front of anyone. A speciality you
 * can't reach isn't shown, and it isn't counted in your total either.
 */
function specsFor(crewId) {
  return SPECIALITIES.filter((s) =>
    DUTIES.some((d) => d.spec === s.id && canAccess(crewId, d.deck) && d.who.includes(crewId))
  );
}

/**
 * How many duties of one speciality this crew member has done, all time.
 *
 * Entries written before the speciality was stamped on them fall back to
 * looking the duty up, so an existing save keeps its droids.
 */
function specCount(crewId, specId) {
  return state.log.filter(
    (e) => e.crew === crewId && !e.track && (e.spec ?? dutyById[e.duty]?.spec) === specId
  ).length;
}

/** Every speciality open to them, its droids, and which are aboard. */
function badgesFor(crewId) {
  return specsFor(crewId).map((s) => {
    const count = specCount(crewId, s.id);
    const droids = s.droids.map((d) => ({ ...d, earned: count >= d.at }));
    return { ...s, count, droids, next: droids.find((d) => !d.earned) ?? null };
  });
}

const droidsAboard = (crewId) =>
  badgesFor(crewId).reduce((a, s) => a + s.droids.filter((d) => d.earned).length, 0);

/** How many droids exist for this crew member — the hangar's denominator. */
const droidTotal = (crewId) =>
  specsFor(crewId).reduce((a, s) => a + s.droids.length, 0);

/** Counts before an award, so what crossed can be announced after it. */
const badgeSnapshot = (crewId) =>
  Object.fromEntries(specsFor(crewId).map((s) => [s.id, specCount(crewId, s.id)]));

/**
 * Droids that arrived between a snapshot and now. A drill can bank three duties
 * at once, so this returns a list rather than a single crossing.
 */
function badgesCrossed(crewId, before) {
  const out = [];
  specsFor(crewId).forEach((s) => {
    const now = specCount(crewId, s.id);
    s.droids.forEach((d) => {
      if ((before[s.id] ?? 0) < d.at && now >= d.at) out.push({ spec: s, droid: d });
    });
  });
  return out;
}

// ── History ─────────────────────────────────────────────────────────────────
//
// Past weeks are derived from the log rather than snapshotted at rollover.
// Every entry already carries a timestamp, so there's nothing to archive, no
// rollover job to miss, and no stored figure that can drift from the record
// it was meant to summarise.

function between(crewId, from, to, opts = {}) {
  return state.log.filter(
    (e) =>
      e.crew === crewId &&
      e.t >= from &&
      e.t < to &&
      (opts.track ? e.track === opts.track : !e.track)
  );
}

/** One week's figures for the whole crew, plus a household total. */
function weekSummary(start) {
  const end = start + WEEK_MS;
  const crew = {};
  let total = 0;
  CREW.forEach((c) => {
    const done = between(c.id, start, end);
    const merit = done.reduce((a, e) => a + e.pts, 0);
    const t = trackFor(c.id);
    crew[c.id] = {
      merit,
      duties: done.filter((e) => !e.duty.startsWith('bonus:')).length,
      track: t ? between(c.id, start, end, { track: t.id }).length : 0,
      hitTarget: merit >= c.target,
      hitTrack: t ? between(c.id, start, end, { track: t.id }).length >= t.goal : null,
    };
    total += merit;
  });
  return { start, end, crew, total };
}

/** Completed weeks, newest first. The current week is excluded — it isn't over. */
function pastWeeks(n = 8) {
  if (!state.log.length) return [];
  const first = Math.min(...state.log.map((e) => e.t));
  const out = [];
  let s = weekStart() - WEEK_MS;
  while (out.length < n && s + WEEK_MS > first) {
    out.push(weekSummary(s));
    s -= WEEK_MS;
  }
  return out;
}

/** Everything, all time — per person and household. */
function allTime() {
  const crew = {};
  const weeks = pastWeeks(520);
  let total = 0;
  CREW.forEach((c) => {
    const done = between(c.id, 0, Infinity);
    const merit = done.reduce((a, e) => a + e.pts, 0);
    const t = trackFor(c.id);
    crew[c.id] = {
      merit,
      duties: done.filter((e) => !e.duty.startsWith('bonus:')).length,
      track: t ? between(c.id, 0, Infinity, { track: t.id }).length : 0,
      weeksWon: 0,
    };
    total += merit;
  });
  // Weeks won needs the week-by-week view, so count it once over all of them.
  // One measure for everybody now: your own merit against your own target.
  weeks.forEach((w) =>
    CREW.forEach((c) => {
      if (w.crew[c.id].hitTarget) crew[c.id].weeksWon++;
    })
  );
  return { crew, total, weeks: weeks.length };
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
