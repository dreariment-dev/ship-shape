// Static definition of the ship: crew, decks, and the duty roster.
// Nothing here changes at runtime — live state (last-done times, merit, skips)
// lives in engine.js and localStorage.

// Cadence drives everything: how fast a duty goes stale, and what it pays.
const TIERS = {
  daily:    { days: 1,  pts: 5,   label: 'Daily' },
  often:    { days: 3,  pts: 10,  label: 'Routine' },
  weekly:   { days: 7,  pts: 25,  label: 'Scheduled' },
  biweekly: { days: 14, pts: 35,  label: 'Fortnightly' },
  monthly:  { days: 30, pts: 50,  label: 'Overhaul' },
  seasonal: { days: 90, pts: 100, label: 'Drydock' },
};

// target is merit per week, and drives rank and the crew standing.
//
// Both children are cadets on identical mechanics: same merit economy, same
// rank ladder, same hangar. What differs is the target, because they are
// balanced on real work — 74 min/week against 56 — and rank is a multiple of
// your own target, so equal footing is not the same as equal numbers.
//
// The names are placeholders, deliberately plain: rename them to the
// children's own via ⚙ on the device. Nothing personal belongs in a public
// repo, and the digits are labels, not rank.
//
// Both children also have a personal track (see TRACKS) that is scored
// entirely separately — bedtime and homework are not cleaning, and letting
// them pay merit meant the five-year-old could win a week doing twenty
// minutes of actual work against the nine-year-old's seventy-seven.
const CREW = [
  { id: 'adult', name: 'Captain', emoji: '🧑‍🚀', target: 500 },
  { id: 'k9',    name: 'Cadet 1', emoji: '🫡',   target: 200 },
  { id: 'k5',    name: 'Cadet 2', emoji: '👾',   target: 150 },
];

// Rank thresholds are multiples of a crew member's own weekly target, so the
// 5-year-old climbs at the same rate as the adult despite scoring a tenth as
// much. Nobody is stuck on Cadet for a year.
const RANKS = [
  { at: 0,    name: 'Cadet' },
  { at: 0.5,  name: 'Crewman' },
  { at: 1.5,  name: 'Ensign' },
  { at: 3.5,  name: 'Lieutenant' },
  { at: 7,    name: 'Commander' },
  { at: 14,   name: 'Captain' },
  { at: 25,   name: 'Fleet Admiral' },
];

// A personal track is a second, parallel economy: nightly or daily habits that
// aren't cleaning and mustn't compete with it. Track duties earn no merit and
// no droids, never enter the card draw, and are ticked off in their own strip.
// Each child has one, so each has two rewards to chase.
const TRACKS = {
  k5: {
    id: 'nightwatch',
    name: 'Night Watch',
    icon: '🌙',
    when: 'Tonight',
    unit: 'moons',
    goal: 10, // of 14 possible — two poor nights and you can still win the week
  },
  k9: {
    id: 'research',
    name: 'Research',
    icon: '🔭',
    when: 'Today',
    unit: 'logs',
    goal: 8, // of 14 — homework isn't a weekend thing, so this can't be 14
  },
};

const DECKS = [
  { id: 'galley',   name: 'The Galley',            sub: 'Kitchen',        zone: 'lower',   emoji: '🍳' },
  { id: 'bridge',   name: 'The Bridge',            sub: 'Living room',    zone: 'lower',   emoji: '🛋️' },
  { id: 'playroom', name: 'The Playroom',          sub: 'Living room 2',  zone: 'lower',   emoji: '🧸', owners: ['k9', 'k5'] },
  { id: 'ops',      name: 'Ops',                   sub: 'Office',         zone: 'lower',   emoji: '🖥️' },
  { id: 'auxsan',   name: 'Aux Sanitation',        sub: 'Downstairs loo', zone: 'lower',   emoji: '🚽' },
  // owners: whose patch this is. Anything an owner is capable of doing here is
  // theirs first — see FIRST_REFUSAL below. A deck can have more than one.
  { id: 'bunka',    name: "Captain's Quarters",    sub: 'Bedroom',        zone: 'upper',   emoji: '🛏️', owners: ['adult'] },
  { id: 'bunkb',    name: "Cadet 1's Quarters",    sub: 'Bedroom',        zone: 'upper',   emoji: '🛏️', owners: ['k9'] },
  { id: 'bunkc',    name: "Cadet 2's Quarters",    sub: 'Bedroom',        zone: 'upper',   emoji: '🛏️', owners: ['k5'] },
  { id: 'hydro',    name: 'Hydro Bay',             sub: 'Bathroom',       zone: 'upper',   emoji: '🚿' },
  { id: 'turbo',    name: 'Turbolift Shaft',       sub: 'Stairs',         zone: 'transit', emoji: '🪜' },
];

// Which decks each crew member can be dealt from. The children keep their own
// quarters and share the Playroom and Galley; everything else is the adults'.
// null means the whole ship.
//
// This is a separate gate from the `who` tags below: access says where you may
// be sent, `who` says whether the job itself is safe for you. Both must pass,
// so the Cadet still won't be handed the window cleaner in their own room.
const DECK_ACCESS = {
  adult: null,
  k9: ['bunkb', 'playroom', 'bridge', 'galley'],
  k5: ['bunkc', 'playroom', 'bridge', 'galley'],
};

// Your own patch is your responsibility. A duty an owner can do isn't offered
// to anybody else until it's half again past due, so the owners always get
// first crack at it — and nothing rots forever if they never show up.
// The Galley is the only genuinely shared deck: anyone may be dealt those.
const FIRST_REFUSAL = 1.5;

// How many jobs one mission may hold. The home-screen draw still deals exactly
// one card — choosing is the hard part and a wall of options is the thing this
// app avoids. Picking several is a deliberate act inside a room you opened,
// which is the one place the roster was always allowed to show more than one.
// Three matches the drill, so there's a single answer to "how many at once".
const MAX_MISSION = 3;

const ZONES = {
  upper:   'Upper Deck',
  lower:   'Lower Deck',
  transit: 'Transit',
};

// who: which crew can be dealt this card. Anything with chemicals, heights or
// heft is adult-only; k5 only ever sees short, safe, obvious jobs.
const ALL = ['adult', 'k9', 'k5'];
const GROWN = ['adult', 'k9'];
const ADULT = ['adult'];

// pts is derived from the tier unless overridden — overrides are for jobs that
// are disproportionately grim for their frequency (stair spindles, the oven).
const DUTIES = [
  // ── Galley ────────────────────────────────────────────────────────────────
  // The Galley is shared ground, but these two are the children's own standing
  // orders: their stuff, their job to shift it. Duty-level owners override the
  // deck's, so first refusal applies to these without reserving the whole room.
  { deck: 'galley', name: 'Tidy the kitchen counter', icon: '🧸', tier: 'daily', mins: 5, pts: 8, who: ALL, owners: ['k9', 'k5'] },
  { deck: 'galley', name: 'Clear the table',          icon: '🍽️', tier: 'daily',    mins: 3,  who: ALL, owners: ['k9', 'k5'] },
  { deck: 'galley', name: 'Sweep the galley floor',   icon: '🧹', tier: 'often',    mins: 5,  who: ALL },
  { deck: 'galley', name: 'Dust the shelves and tops', icon: '🪶', tier: 'weekly',  mins: 5,  who: ALL },
  { deck: 'galley', name: 'Wipe down the worktops',   icon: '🧽', tier: 'often',    mins: 5,  who: GROWN },
  { deck: 'galley', name: 'Empty and rinse the bin',  icon: '🗑️', tier: 'often',    mins: 5,  who: ADULT },
  { deck: 'galley', name: 'Wipe the hob',             icon: '🔥', tier: 'weekly',   mins: 5,  who: ADULT },
  { deck: 'galley', name: 'Mop the galley floor',     icon: '🪣', tier: 'weekly',   mins: 10, who: ADULT },
  { deck: 'galley', name: 'Clean the microwave',      icon: '📡', tier: 'monthly',  mins: 10, who: GROWN },
  { deck: 'galley', name: 'Wipe the cupboard fronts', icon: '🚪', tier: 'monthly',  mins: 15, who: ALL },
  { deck: 'galley', name: 'Clean out one cupboard',   icon: '🗄️', tier: 'monthly',  mins: 15, who: ALL },
  { deck: 'galley', name: 'Clear out and wipe a fridge shelf', icon: '❄️', tier: 'monthly', mins: 15, who: ADULT },
  { deck: 'galley', name: 'Descale the kettle',       icon: '🫖', tier: 'monthly',  mins: 5,  who: ADULT },
  { deck: 'galley', name: 'Skirting boards',          icon: '📏', tier: 'monthly',  mins: 15, who: ALL },
  { deck: 'galley', name: 'Clean the windows',        icon: '🪟', tier: 'biweekly',  mins: 15, who: ALL },
  { deck: 'galley', name: 'Clean inside the oven',    icon: '🔥', tier: 'seasonal', mins: 45, who: ADULT, pts: 150 },
  { deck: 'galley', name: 'Defrost and wipe the freezer', icon: '🧊', tier: 'seasonal', mins: 30, who: ADULT },

  // ── Bridge ────────────────────────────────────────────────────────────────
  { deck: 'bridge', name: 'Tidy the bridge',          icon: '📦', tier: 'often',    mins: 8,  pts: 20, who: ALL },
  { deck: 'bridge', name: 'Dust the surfaces',        icon: '🪶', tier: 'weekly',   mins: 5,  who: ALL },
  { deck: 'bridge', name: 'Hoover the bridge',        icon: '🌀', tier: 'weekly',   mins: 10, who: ALL },
  { deck: 'bridge', name: 'Wipe the screen and remotes', icon: '📺', tier: 'monthly', mins: 5, who: GROWN },
  { deck: 'bridge', name: 'Hoover under the sofa cushions', icon: '🛋️', tier: 'monthly', mins: 10, who: ALL },
  { deck: 'bridge', name: 'Skirting boards',          icon: '📏', tier: 'monthly',  mins: 15, who: ALL },
  { deck: 'bridge', name: 'Clean the windows',        icon: '🪟', tier: 'biweekly',  mins: 15, who: ALL },
  { deck: 'bridge', name: 'High shelves and light fittings', icon: '💡', tier: 'seasonal', mins: 20, who: ADULT },

  // ── Wardroom ──────────────────────────────────────────────────────────────
  // The Playroom is shared ground for both children, so it carries more jobs
  // they can actually be dealt than a second sitting room would.
  { deck: 'playroom', name: 'Tidy the playroom',      icon: '🧸', tier: 'often',    mins: 8,  pts: 20, who: ALL },
  { deck: 'playroom', name: 'Dust the surfaces',      icon: '🪶', tier: 'weekly',   mins: 5,  who: ALL },
  { deck: 'playroom', name: 'Hoover the playroom',    icon: '🌀', tier: 'weekly',   mins: 10, who: ALL },
  { deck: 'playroom', name: 'Sort out one toy box',   icon: '🪀', tier: 'monthly',  mins: 20, who: ALL },
  { deck: 'playroom', name: 'Wipe the doors and light switches', icon: '🚪', tier: 'monthly', mins: 10, who: ALL },
  { deck: 'playroom', name: 'Skirting boards',        icon: '📏', tier: 'monthly',  mins: 15, who: ALL },
  { deck: 'playroom', name: 'Clean the windows',      icon: '🪟', tier: 'biweekly',  mins: 15, who: ALL },
  { deck: 'playroom', name: 'High shelves and light fittings', icon: '💡', tier: 'seasonal', mins: 20, who: ADULT },
  { deck: 'playroom', name: 'Cull the broken toys and lost pieces', icon: '🗑️', tier: 'seasonal', mins: 30, who: ADULT },

  // ── Ops ───────────────────────────────────────────────────────────────────
  { deck: 'ops', name: 'Paper and clutter sweep',     icon: '📄', tier: 'often',    mins: 5,  who: GROWN },
  { deck: 'ops', name: 'Dust the desk and shelves',   icon: '🪶', tier: 'weekly',   mins: 5,  who: ALL },
  { deck: 'ops', name: 'Hoover Ops',                  icon: '🌀', tier: 'weekly',   mins: 10, who: ALL },
  { deck: 'ops', name: 'Wipe screens and keyboard',   icon: '⌨️', tier: 'monthly',  mins: 5,  who: GROWN },
  { deck: 'ops', name: 'Skirting boards',             icon: '📏', tier: 'monthly',  mins: 10, who: ALL },
  { deck: 'ops', name: 'Clean the windows',           icon: '🪟', tier: 'biweekly',  mins: 10, who: ALL },
  { deck: 'ops', name: 'File or shred the paperwork', icon: '🗄️', tier: 'monthly',  mins: 20, who: ADULT },
  { deck: 'ops', name: 'Cable tidy',                  icon: '🔌', tier: 'seasonal', mins: 20, who: ADULT },

  // ── Aux Sanitation ────────────────────────────────────────────────────────
  { deck: 'auxsan', name: 'Wipe the sink and taps',   icon: '🚰', tier: 'often',    mins: 2,  who: ALL },
  { deck: 'auxsan', name: 'Empty the bin',            icon: '🗑️', tier: 'often',    mins: 2,  who: ALL },
  { deck: 'auxsan', name: 'Restock loo roll and soap', icon: '🧴', tier: 'often',   mins: 2,  who: ALL },
  { deck: 'auxsan', name: 'Clean the toilet',         icon: '🚽', tier: 'weekly',   mins: 5,  who: GROWN, pts: 40 },
  { deck: 'auxsan', name: 'Wipe the mirror',          icon: '🪞', tier: 'weekly',   mins: 2,  who: GROWN },
  { deck: 'auxsan', name: 'Mop the floor',            icon: '🪣', tier: 'weekly',   mins: 5,  who: GROWN },
  { deck: 'auxsan', name: 'Skirting and behind the loo', icon: '📏', tier: 'monthly', mins: 10, who: ADULT, pts: 70 },

  // ── Hydro Bay ─────────────────────────────────────────────────────────────
  { deck: 'hydro', name: 'Wipe the sink and taps',    icon: '🚰', tier: 'often',    mins: 3,  who: ALL },
  { deck: 'hydro', name: 'Empty the bin',             icon: '🗑️', tier: 'often',    mins: 2,  who: ALL },
  { deck: 'hydro', name: 'Hang up the towels properly', icon: '🧺', tier: 'often',  mins: 2,  who: ALL },
  { deck: 'hydro', name: 'Clean the toilet',          icon: '🚽', tier: 'weekly',   mins: 5,  who: GROWN, pts: 40 },
  { deck: 'hydro', name: 'Wipe the mirror',           icon: '🪞', tier: 'weekly',   mins: 3,  who: GROWN },
  { deck: 'hydro', name: 'Scrub the bath and shower', icon: '🛁', tier: 'weekly',   mins: 15, who: ADULT, pts: 40 },
  { deck: 'hydro', name: 'Mop the floor',             icon: '🪣', tier: 'weekly',   mins: 10, who: GROWN },
  { deck: 'hydro', name: 'Descale the showerhead and screen', icon: '🚿', tier: 'monthly', mins: 20, who: ADULT },
  { deck: 'hydro', name: 'Wash the bath mat',         icon: '🧺', tier: 'monthly',  mins: 5,  who: ADULT },
  { deck: 'hydro', name: 'Clean the windows',         icon: '🪟', tier: 'biweekly',  mins: 10, who: ALL },
  { deck: 'hydro', name: 'Scrub the grout',           icon: '🧱', tier: 'seasonal', mins: 40, who: ADULT, pts: 150 },

  // ── Crew Quarters (same template on each of the three) ────────────────────
  // ── Personal tracks ───────────────────────────────────────────────────────
  // Scored on their own track, never in merit. pts is 0 so they also carry no
  // weight in deck integrity — a made bed says something about the room, a
  // good night's sleep does not.
  { deck: 'bunkc', name: 'Sleep in your own bed',  icon: '🌙', tier: 'daily', mins: 0, pts: 0, who: ['k5'], owners: ['k5'], track: 'nightwatch' },
  { deck: 'bunkc', name: 'Asleep by half past 8',  icon: '⏰', tier: 'daily', mins: 0, pts: 0, who: ['k5'], owners: ['k5'], track: 'nightwatch' },
  { deck: 'bunkb', name: 'Homework done',          icon: '📓', tier: 'daily', mins: 0, pts: 0, who: ['k9'], owners: ['k9'], track: 'research' },
  { deck: 'bunkb', name: 'Read for 20 minutes',    icon: '📖', tier: 'daily', mins: 0, pts: 0, who: ['k9'], owners: ['k9'], track: 'research' },

  ...['bunka', 'bunkb', 'bunkc'].flatMap((deck) => [
    // Make the bed stays on its own: it's one concrete action with a visible
    // result, which is the opposite of the vague "tidy up" that tends to
    // bounce off a child. Everything else that was just putting-things-away
    // is folded into one duty.
    { deck, name: 'Make the bed',              icon: '🛏️', tier: 'often',    mins: 2,  who: ALL },
    { deck, name: 'Tidy your quarters',        icon: '📦', tier: 'often',    mins: 8,  pts: 20, who: ALL },
    { deck, name: 'Dust the surfaces',         icon: '🪶', tier: 'weekly',   mins: 5,  who: ALL },
    { deck, name: 'Change the bedding',        icon: '🛌', tier: 'weekly',   mins: 10, who: ADULT },
    { deck, name: 'Hoover the quarters',       icon: '🌀', tier: 'weekly',   mins: 10, who: ALL },
    { deck, name: 'Under the bed',             icon: '🔦', tier: 'monthly',  mins: 15, who: GROWN },
    { deck, name: 'Skirting boards',           icon: '📏', tier: 'monthly',  mins: 10, who: ALL },
    { deck, name: 'Clean the windows',         icon: '🪟', tier: 'biweekly',  mins: 10, who: ALL },
    { deck, name: 'Sort and fold the wardrobe', icon: '👕', tier: 'seasonal', mins: 30, who: ADULT },
  ]),

  // ── Turbolift Shaft ───────────────────────────────────────────────────────
  { deck: 'turbo', name: 'Clear the step pile',       icon: '📦', tier: 'often',    mins: 3,  who: ALL },
  { deck: 'turbo', name: 'Wipe the banister',         icon: '🧽', tier: 'weekly',   mins: 5,  who: ALL },
  { deck: 'turbo', name: 'Hoover the stairs',         icon: '🌀', tier: 'weekly',   mins: 15, who: ALL, pts: 40 },
  { deck: 'turbo', name: 'Skirting and spindles',     icon: '📏', tier: 'monthly',  mins: 25, who: ADULT, pts: 90 },
  { deck: 'turbo', name: 'Dust the stairwell light',  icon: '💡', tier: 'seasonal', mins: 15, who: ADULT },
];

// Specialities: the kind of work a duty is, rather than the room it's in.
//
// Droids are earned by getting good at something and they are kept for good.
// That is the whole design constraint restated: a collection can only ever
// grow, so a bad week costs you nothing you already had. A missed window is a
// droid you haven't met yet, never one that flew away — which is exactly what
// a streak would have done to the child this app was built for.
//
// Counts are lifetime and measured against yourself, so nobody is competing
// with a sibling or with an adult who can reach twice as many rooms.
//
// `match` is tested against the lowercased duty name and the FIRST hit wins,
// so the order below is load-bearing: `Paper and clutter sweep` is tidying,
// not floors, and `Skirting and behind the loo` is sanitation, not trim.
const SPECIALITIES = [
  {
    id: 'glass', name: 'Glazier', icon: '🪟',
    match: /window|mirror/,
    droids: [
      { at: 3,  emoji: '⭐', name: 'Twinkle' },
      { at: 10, emoji: '🌟', name: 'Flare' },
      { at: 25, emoji: '💫', name: 'Zip' },
    ],
  },
  {
    id: 'floors', name: 'Deck Hand', icon: '🌀',
    match: /hoover|mop the|sweep the/,
    droids: [
      { at: 5,  emoji: '🛸', name: 'Pip' },
      { at: 20, emoji: '🚀', name: 'Comet' },
      { at: 60, emoji: '☄️', name: 'Whizz' },
    ],
  },
  {
    id: 'sanitation', name: 'Sanitation', icon: '🚽',
    match: /toilet|sink and taps|loo|bath|shower|grout|bin|towels/,
    droids: [
      { at: 10,  emoji: '🔋', name: 'Sparky' },
      { at: 40,  emoji: '🧲', name: 'Snap' },
      { at: 120, emoji: '🛠️', name: 'Fixit' },
    ],
  },
  {
    id: 'galley', name: 'Galley Hand', icon: '🍳',
    match: /worktop|hob|oven|microwave|fridge|kettle|freezer|cupboard/,
    droids: [
      { at: 3,  emoji: '🔌', name: 'Plug' },
      { at: 10, emoji: '💡', name: 'Glow' },
      { at: 25, emoji: '📻', name: 'Crackle' },
    ],
  },
  {
    id: 'trim', name: 'Finisher', icon: '📏',
    match: /skirting|banister|spindle|doors and light/,
    droids: [
      { at: 2,  emoji: '🔧', name: 'Spanner' },
      { at: 6,  emoji: '⚙️', name: 'Cog' },
      { at: 15, emoji: '🔩', name: 'Bolty' },
    ],
  },
  {
    id: 'dust', name: 'Duster', icon: '🪶',
    match: /dust|high shelves|screen/,
    droids: [
      { at: 4,  emoji: '👾', name: 'Blip' },
      { at: 15, emoji: '🛰️', name: 'Echo' },
      { at: 45, emoji: '🔭', name: 'Peek' },
    ],
  },
  {
    id: 'tidy', name: 'Quartermaster', icon: '📦',
    match: /tidy|clear|make the bed|under the bed|toy box|paper and clutter|cull|bedding|wardrobe|file or shred|restock/,
    droids: [
      { at: 20,  emoji: '🤖', name: 'Bolt' },
      { at: 90,  emoji: '🦾', name: 'Clank' },
      { at: 300, emoji: '🎛️', name: 'Dials' },
    ],
  },
];

// Give every duty a stable id so state survives roster edits that only reorder,
// and resolve its speciality once — the hangar counts these off the log, so a
// duty that matches nothing can never be worked towards a droid. The test suite
// fails if one slips through unmatched.
DUTIES.forEach((d) => {
  d.id = `${d.deck}:${d.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  d.pts = d.pts ?? TIERS[d.tier].pts;
  d.days = TIERS[d.tier].days;
  d.spec = d.track ? null : SPECIALITIES.find((s) => s.match.test(d.name.toLowerCase()))?.id ?? null;
});
