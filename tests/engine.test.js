// Smoke tests for the engine. No framework — run with `node tests/engine.test.js`.
// The browser loads data.js and engine.js as plain scripts sharing one global
// scope, so the test recreates that rather than pretending they're modules.

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const root = path.join(__dirname, '..');
const src = ['js/data.js', 'js/engine.js']
  .map((f) => fs.readFileSync(path.join(root, f), 'utf8'))
  .join('\n');

const store = new Map();
const sandbox = {
  console,
  Date,
  Math,
  JSON,
  Object,
  Array,
  localStorage: {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, v),
    removeItem: (k) => store.delete(k),
  },
};
vm.createContext(sandbox);
vm.runInContext(src, sandbox);

const run = (name, fn) => {
  try {
    fn();
    console.log(`  ok  ${name}`);
  } catch (err) {
    console.error(`FAIL  ${name}\n      ${err.message}`);
    process.exitCode = 1;
  }
};

const ctx = (expr) => vm.runInContext(expr, sandbox);

console.log('engine');

run('loads and seeds every duty', () => {
  ctx('load()');
  const seeded = ctx('Object.keys(state.duties).length');
  const defined = ctx('DUTIES.length');
  assert.strictEqual(seeded, defined);
  assert.ok(defined > 60, `expected a full roster, got ${defined}`);
});

run('duty ids are unique', () => {
  const ids = ctx('DUTIES.map(d => d.id)');
  assert.strictEqual(new Set(ids).size, ids.length);
});

run('every duty belongs to a real deck', () => {
  // Length rather than deepStrictEqual: arrays made inside the vm context have
  // a different Array prototype, so identity comparison fails on empty arrays.
  const orphans = ctx('DUTIES.filter(d => !DECKS.some(k => k.id === d.deck)).map(d => d.id)');
  assert.strictEqual(orphans.length, 0, `orphaned duties: ${[...orphans].join(', ')}`);
});

run('ship integrity is a sane fraction', () => {
  const pct = ctx('shipIntegrity()');
  assert.ok(pct > 0 && pct < 1, `got ${pct}`);
});

run('the draw respects who can do what', () => {
  // The Cadet must never be handed bleach, heights or the oven.
  const bad = ctx(`
    (() => {
      const seen = new Set();
      for (let i = 0; i < 600; i++) { const d = draw('k5'); if (d) seen.add(d.id); }
      return [...seen].filter(id => !DUTIES.find(d => d.id === id).who.includes('k5'));
    })()`);
  assert.strictEqual(bad.length, 0, `Cadet was dealt: ${[...bad].join(', ')}`);
});

run('the draw reaches a good spread of the roster', () => {
  const n = ctx(`
    (() => {
      const seen = new Set();
      for (let i = 0; i < 3000; i++) { const d = draw('adult'); if (d) seen.add(d.id); }
      return seen.size;
    })()`);
  assert.ok(n > 20, `draw only ever offered ${n} distinct duties`);
});

run('completing a duty pays out and refreshes it', () => {
  const before = ctx('weekTotal("adult")');
  const res = ctx(`
    (() => {
      const d = draw('adult');
      const pts = complete(d.id, 'adult');
      return { pts, fresh: freshness(d.id), skips: state.duties[d.id].skips };
    })()`);
  assert.ok(res.pts > 0);
  assert.strictEqual(res.fresh, 1, 'a just-done duty should be fully fresh');
  assert.strictEqual(res.skips, 0);
  assert.strictEqual(ctx('weekTotal("adult")'), before + res.pts);
});

run('hazard pay climbs as a duty gets ducked', () => {
  const res = ctx(`
    (() => {
      const id = DUTIES[0].id;
      state.duties[id].skips = 0;
      const base = value(id);
      swap(id); swap(id);
      const after = value(id);
      for (let i = 0; i < 40; i++) swap(id);
      return { base, after, capped: hazardMult(id) };
    })()`);
  assert.ok(res.after > res.base, 'skipping should raise the payout');
  assert.strictEqual(res.capped, 3, 'hazard pay should cap at x3');
});

run('dismissing takes a duty off the table for today', () => {
  const gone = ctx(`
    (() => {
      const d = draw('adult');
      dismiss(d.id);
      for (let i = 0; i < 400; i++) if (draw('adult')?.id === d.id) return false;
      return true;
    })()`);
  assert.strictEqual(gone, true);
});

run('rescue offers the shortest job going', () => {
  const ok = ctx(`
    (() => {
      const r = rescue('k5');
      if (!r) return false;
      const pool = DUTIES.filter(d => d.who.includes('k5') && dueness(d.id) >= 0.3
                                      && state.duties[d.id].snooze < Date.now());
      return r.mins === Math.min(...pool.map(d => d.mins));
    })()`);
  assert.strictEqual(ok, true);
});

run('a drill deals three distinct duties', () => {
  const t = ctx('drawSprint("adult", 3).map(d => d.id)');
  assert.strictEqual(t.length, 3);
  assert.strictEqual(new Set(t).size, 3);
});

run('rank climbs at the same rate for every crew member', () => {
  // A Cadet hitting their small target should rank up exactly as fast as the
  // Captain hitting a large one — that's the whole point of the ladder.
  const res = ctx(`
    (() => {
      state.log = [];
      CREW.forEach(c => { for (let i = 0; i < 4; i++)
        state.log.push({ t: Date.now(), crew: c.id, duty: 'x', pts: c.target }); });
      return CREW.map(c => rankOf(c.id).current.name);
    })()`);
  assert.strictEqual(new Set(res).size, 1, `ranks diverged: ${res.join(', ')}`);
});

run('bonus entries score but do not count as duties', () => {
  const res = ctx(`
    (() => {
      state.log = [];
      state.log.push({ t: Date.now(), crew: 'k5', duty: 'bonus:redalert', pts: 30 });
      return { pts: weekTotal('k5'), duties: countSince('k5', 0) };
    })()`);
  assert.strictEqual(res.pts, 30);
  assert.strictEqual(res.duties, 0, 'a drill bonus should not award a droid');
});

run('a corrupt save does not brick the app', () => {
  store.set('shipshape.v1', '{not json');
  ctx('load()');
  assert.ok(ctx('Object.keys(state.duties).length') > 0);
});

run('a save missing new duties backfills them', () => {
  const ok = ctx(`
    (() => {
      delete state.duties[DUTIES[0].id];
      localStorage.setItem('shipshape.v1', JSON.stringify(state));
      load();
      return !!state.duties[DUTIES[0].id];
    })()`);
  assert.strictEqual(ok, true);
});
