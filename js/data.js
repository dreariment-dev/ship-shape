// Static definition of the ship: crew, decks, and the duty roster.
// Nothing here changes at runtime — live state (last-done times, merit, skips)
// lives in engine.js and localStorage.

// Cadence drives everything: how fast a duty goes stale, and what it pays.
const TIERS = {
  often:    { days: 3,  pts: 10,  label: 'Routine' },
  weekly:   { days: 7,  pts: 25,  label: 'Scheduled' },
  monthly:  { days: 30, pts: 50,  label: 'Overhaul' },
  seasonal: { days: 90, pts: 100, label: 'Drydock' },
};

const CREW = [
  { id: 'adult', name: 'Captain',  emoji: '🧑‍🚀', target: 500, mode: 'full'  },
  { id: 'k9',    name: 'Commander', emoji: '🫡',   target: 200, mode: 'full'  },
  { id: 'k5',    name: 'Cadet',    emoji: '👾',   target: 60,  mode: 'simple' },
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

const DECKS = [
  { id: 'galley',   name: 'The Galley',       sub: 'Kitchen',        zone: 'lower',   emoji: '🍳' },
  { id: 'bridge',   name: 'The Bridge',       sub: 'Living room',    zone: 'lower',   emoji: '🛋️' },
  { id: 'wardroom', name: 'The Wardroom',     sub: 'Living room 2',  zone: 'lower',   emoji: '📺' },
  { id: 'ops',      name: 'Ops',              sub: 'Office',         zone: 'lower',   emoji: '🖥️' },
  { id: 'auxsan',   name: 'Aux Sanitation',   sub: 'Downstairs loo', zone: 'lower',   emoji: '🚽' },
  { id: 'bunka',    name: 'Crew Quarters A',  sub: 'Bedroom',        zone: 'upper',   emoji: '🛏️' },
  { id: 'bunkb',    name: 'Crew Quarters B',  sub: 'Bedroom',        zone: 'upper',   emoji: '🛏️' },
  { id: 'bunkc',    name: 'Crew Quarters C',  sub: 'Bedroom',        zone: 'upper',   emoji: '🛏️' },
  { id: 'hydro',    name: 'Hydro Bay',        sub: 'Bathroom',       zone: 'upper',   emoji: '🚿' },
  { id: 'turbo',    name: 'Turbolift Shaft',  sub: 'Stairs',         zone: 'transit', emoji: '🪜' },
];

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
  { deck: 'galley', name: 'Sweep the galley floor',   icon: '🧹', tier: 'often',    mins: 5,  who: ALL },
  { deck: 'galley', name: 'Stow anything that lives elsewhere', icon: '📦', tier: 'often', mins: 3, who: ALL },
  { deck: 'galley', name: 'Wipe down the worktops',   icon: '🧽', tier: 'often',    mins: 5,  who: GROWN },
  { deck: 'galley', name: 'Empty and rinse the bin',  icon: '🗑️', tier: 'often',    mins: 5,  who: GROWN },
  { deck: 'galley', name: 'Wipe the hob',             icon: '🔥', tier: 'weekly',   mins: 5,  who: GROWN },
  { deck: 'galley', name: 'Mop the galley floor',     icon: '🪣', tier: 'weekly',   mins: 10, who: ADULT },
  { deck: 'galley', name: 'Clean the microwave',      icon: '📡', tier: 'monthly',  mins: 10, who: GROWN },
  { deck: 'galley', name: 'Wipe the cupboard fronts', icon: '🚪', tier: 'monthly',  mins: 15, who: GROWN },
  { deck: 'galley', name: 'Clear out and wipe a fridge shelf', icon: '❄️', tier: 'monthly', mins: 15, who: ADULT },
  { deck: 'galley', name: 'Descale the kettle',       icon: '🫖', tier: 'monthly',  mins: 5,  who: ADULT },
  { deck: 'galley', name: 'Skirting boards',          icon: '📏', tier: 'monthly',  mins: 15, who: GROWN },
  { deck: 'galley', name: 'Clean the windows',        icon: '🪟', tier: 'monthly',  mins: 15, who: ADULT },
  { deck: 'galley', name: 'Clean inside the oven',    icon: '🔥', tier: 'seasonal', mins: 45, who: ADULT, pts: 150 },
  { deck: 'galley', name: 'Defrost and wipe the freezer', icon: '🧊', tier: 'seasonal', mins: 30, who: ADULT },

  // ── Bridge ────────────────────────────────────────────────────────────────
  { deck: 'bridge', name: 'Clutter sweep',            icon: '📦', tier: 'often',    mins: 5,  who: ALL },
  { deck: 'bridge', name: 'Plump cushions, fold the throws', icon: '🛋️', tier: 'often', mins: 3, who: ALL },
  { deck: 'bridge', name: 'Dust the surfaces',        icon: '🪶', tier: 'weekly',   mins: 5,  who: GROWN },
  { deck: 'bridge', name: 'Hoover the bridge',        icon: '🌀', tier: 'weekly',   mins: 10, who: GROWN },
  { deck: 'bridge', name: 'Wipe the screen and remotes', icon: '📺', tier: 'monthly', mins: 5, who: GROWN },
  { deck: 'bridge', name: 'Hoover under the sofa cushions', icon: '🛋️', tier: 'monthly', mins: 10, who: GROWN },
  { deck: 'bridge', name: 'Skirting boards',          icon: '📏', tier: 'monthly',  mins: 15, who: GROWN },
  { deck: 'bridge', name: 'Clean the windows',        icon: '🪟', tier: 'monthly',  mins: 15, who: ADULT },
  { deck: 'bridge', name: 'High shelves and light fittings', icon: '💡', tier: 'seasonal', mins: 20, who: ADULT },

  // ── Wardroom ──────────────────────────────────────────────────────────────
  { deck: 'wardroom', name: 'Clutter sweep',          icon: '📦', tier: 'often',    mins: 5,  who: ALL },
  { deck: 'wardroom', name: 'Dust the surfaces',      icon: '🪶', tier: 'weekly',   mins: 5,  who: GROWN },
  { deck: 'wardroom', name: 'Hoover the wardroom',    icon: '🌀', tier: 'weekly',   mins: 10, who: GROWN },
  { deck: 'wardroom', name: 'Skirting boards',        icon: '📏', tier: 'monthly',  mins: 15, who: GROWN },
  { deck: 'wardroom', name: 'Clean the windows',      icon: '🪟', tier: 'monthly',  mins: 15, who: ADULT },
  { deck: 'wardroom', name: 'High shelves and light fittings', icon: '💡', tier: 'seasonal', mins: 20, who: ADULT },

  // ── Ops ───────────────────────────────────────────────────────────────────
  { deck: 'ops', name: 'Paper and clutter sweep',     icon: '📄', tier: 'often',    mins: 5,  who: GROWN },
  { deck: 'ops', name: 'Dust the desk and shelves',   icon: '🪶', tier: 'weekly',   mins: 5,  who: GROWN },
  { deck: 'ops', name: 'Hoover Ops',                  icon: '🌀', tier: 'weekly',   mins: 10, who: GROWN },
  { deck: 'ops', name: 'Wipe screens and keyboard',   icon: '⌨️', tier: 'monthly',  mins: 5,  who: GROWN },
  { deck: 'ops', name: 'Skirting boards',             icon: '📏', tier: 'monthly',  mins: 10, who: GROWN },
  { deck: 'ops', name: 'Clean the windows',           icon: '🪟', tier: 'monthly',  mins: 10, who: ADULT },
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
  { deck: 'hydro', name: 'Clean the windows',         icon: '🪟', tier: 'monthly',  mins: 10, who: ADULT },
  { deck: 'hydro', name: 'Scrub the grout',           icon: '🧱', tier: 'seasonal', mins: 40, who: ADULT, pts: 150 },

  // ── Crew Quarters (same template on each of the three) ────────────────────
  ...['bunka', 'bunkb', 'bunkc'].flatMap((deck) => [
    { deck, name: 'Make the bed',              icon: '🛏️', tier: 'often',    mins: 2,  who: ALL },
    { deck, name: 'Everything back where it lives', icon: '📦', tier: 'often', mins: 5, who: ALL },
    { deck, name: 'Dirty clothes into the basket', icon: '🧺', tier: 'often', mins: 2,  who: ALL },
    { deck, name: 'Dust the surfaces',         icon: '🪶', tier: 'weekly',   mins: 5,  who: ALL },
    { deck, name: 'Change the bedding',        icon: '🛌', tier: 'weekly',   mins: 10, who: GROWN },
    { deck, name: 'Hoover the quarters',       icon: '🌀', tier: 'weekly',   mins: 10, who: GROWN },
    { deck, name: 'Under the bed',             icon: '🔦', tier: 'monthly',  mins: 15, who: GROWN },
    { deck, name: 'Skirting boards',           icon: '📏', tier: 'monthly',  mins: 10, who: GROWN },
    { deck, name: 'Clean the windows',         icon: '🪟', tier: 'monthly',  mins: 10, who: ADULT },
    { deck, name: 'Sort and fold the wardrobe', icon: '👕', tier: 'seasonal', mins: 30, who: ADULT },
  ]),

  // ── Turbolift Shaft ───────────────────────────────────────────────────────
  { deck: 'turbo', name: 'Clear the step pile',       icon: '📦', tier: 'often',    mins: 3,  who: ALL },
  { deck: 'turbo', name: 'Wipe the banister',         icon: '🧽', tier: 'weekly',   mins: 5,  who: ALL },
  { deck: 'turbo', name: 'Hoover the stairs',         icon: '🌀', tier: 'weekly',   mins: 15, who: GROWN, pts: 40 },
  { deck: 'turbo', name: 'Skirting and spindles',     icon: '📏', tier: 'monthly',  mins: 25, who: ADULT, pts: 90 },
  { deck: 'turbo', name: 'Dust the stairwell light',  icon: '💡', tier: 'seasonal', mins: 15, who: ADULT },
];

// Droids the Cadet rescues — one per completed duty, filling the hangar bay.
const DROIDS = [
  ['🤖', 'Bolt'],    ['🛸', 'Pip'],     ['🚀', 'Comet'],   ['🛰️', 'Echo'],
  ['👾', 'Blip'],    ['🪐', 'Ringo'],   ['⭐', 'Twinkle'], ['🌟', 'Flare'],
  ['💫', 'Zip'],     ['☄️', 'Whizz'],   ['🔭', 'Peek'],    ['🦾', 'Clank'],
  ['🔧', 'Spanner'], ['⚙️', 'Cog'],     ['🔩', 'Bolty'],   ['📡', 'Dish'],
  ['🛠️', 'Fixit'],   ['🔋', 'Sparky'],  ['💡', 'Glow'],    ['🎛️', 'Dials'],
  ['🕹️', 'Joy'],     ['📻', 'Crackle'], ['🔌', 'Plug'],    ['🧲', 'Snap'],
];

// Give every duty a stable id so state survives roster edits that only reorder.
DUTIES.forEach((d) => {
  d.id = `${d.deck}:${d.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  d.pts = d.pts ?? TIERS[d.tier].pts;
  d.days = TIERS[d.tier].days;
});
