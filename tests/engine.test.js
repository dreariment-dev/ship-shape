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

run('the draw keeps each child to their own decks', () => {
  // Own quarters, the Playroom and the Galley — nothing else, and never the
  // other child's room.
  ['k9', 'k5'].forEach((id) => {
    const strayed = ctx(`
      (() => {
        const seen = new Set();
        for (let i = 0; i < 800; i++) { const d = draw('${id}'); if (d) seen.add(d.deck); }
        return [...seen].filter(k => DECK_ACCESS['${id}'].indexOf(k) === -1);
      })()`);
    assert.strictEqual(strayed.length, 0, `${id} was sent to: ${[...strayed].join(', ')}`);
  });
});

run('the children cannot be sent into each other rooms', () => {
  assert.ok(!ctx("DECK_ACCESS.k9.includes('bunkc')"), 'Commander can reach the Cadet quarters');
  assert.ok(!ctx("DECK_ACCESS.k5.includes('bunkb')"), 'Cadet can reach the Commander quarters');
  assert.ok(!ctx("DECK_ACCESS.k9.includes('bunka')"), 'Commander can reach the adults quarters');
});

run('every deck a child can reach really exists', () => {
  const bogus = ctx(`
    ['k9','k5'].flatMap(c => DECK_ACCESS[c].filter(k => !DECKS.some(d => d.id === k)))`);
  assert.strictEqual(bogus.length, 0, `unknown decks in DECK_ACCESS: ${[...bogus].join(', ')}`);
});

run('a child gets first refusal on their own bedroom', () => {
  // Freshly-done and merely-due jobs in a child's room must not reach the
  // adult; the child is meant to get the chance first.
  const leaked = ctx(`
    (() => {
      load();
      DUTIES.filter(d => d.deck === 'bunkc').forEach(d => {
        state.duties[d.id].last = Date.now() - d.days * 86400000 * 1.1; // due, not overdue
      });
      const seen = new Set();
      for (let i = 0; i < 3000; i++) { const d = draw('adult'); if (d) seen.add(d.id); }
      return [...seen].filter(id => {
        const d = dutyById[id];
        return d.deck === 'bunkc' && d.who.includes('k5');
      });
    })()`);
  assert.strictEqual(leaked.length, 0, `adult was offered the Cadet's own jobs: ${[...leaked].join(', ')}`);
});

run('the adult still backstops a bedroom left to rot', () => {
  // First refusal must not mean never. Push well past due and the adult picks
  // it up, so a neglected room can't drag the ship down forever.
  const reached = ctx(`
    (() => {
      load();
      DUTIES.filter(d => d.deck === 'bunkc').forEach(d => {
        state.duties[d.id].last = Date.now() - d.days * 86400000 * 3;
      });
      for (let i = 0; i < 3000; i++) {
        const d = draw('adult');
        if (d && d.deck === 'bunkc' && d.who.includes('k5')) return true;
      }
      return false;
    })()`);
  assert.strictEqual(reached, true, 'a rotting bedroom never reaches the adult');
});

run("the children's standing orders in the Galley are held for them", () => {
  // The island and the table are their stuff to shift, even though the Galley
  // itself is shared — duty-level owners must override the deck's.
  const res = ctx(`
    (() => {
      load();
      DUTIES.forEach(d => { state.duties[d.id].last = Date.now() - d.days * 86400000 * 1.1; });
      const orders = DUTIES.filter(d => d.owners).map(d => d.id);
      const seen = new Set();
      for (let i = 0; i < 4000; i++) { const d = draw('adult'); if (d) seen.add(d.id); }
      return {
        orders: orders.length,
        leaked: orders.filter(id => seen.has(id)),
        galleyStillOpen: [...seen].some(id => dutyById[id].deck === 'galley'),
      };
    })()`);
  assert.strictEqual(res.orders, 2, 'expected exactly two duty-level standing orders');
  assert.strictEqual(res.leaked.length, 0, `adult was offered: ${[...res.leaked].join(', ')}`);
  assert.strictEqual(res.galleyStillOpen, true, 'reserving two duties closed the whole Galley');
});

run('both children can be dealt their Galley standing orders', () => {
  ['k9', 'k5'].forEach((id) => {
    const ok = ctx(`
      (() => {
        load();
        DUTIES.forEach(d => { state.duties[d.id].last = Date.now() - d.days * 86400000 * 1.1; });
        const orders = DUTIES.filter(d => d.owners).map(d => d.id);
        for (let i = 0; i < 3000; i++) { const d = draw('${id}'); if (d && orders.includes(d.id)) return true; }
        return false;
      })()`);
    assert.strictEqual(ok, true, `${id} cannot be dealt their own standing orders`);
  });
});

run('a standing order left undone still reaches the adult', () => {
  const reached = ctx(`
    (() => {
      load();
      DUTIES.filter(d => d.owners).forEach(d => {
        state.duties[d.id].last = Date.now() - d.days * 86400000 * 3;
      });
      const orders = DUTIES.filter(d => d.owners).map(d => d.id);
      for (let i = 0; i < 3000; i++) { const d = draw('adult'); if (d && orders.includes(d.id)) return true; }
      return false;
    })()`);
  assert.strictEqual(reached, true, 'a neglected standing order never reaches the adult');
});

run('the Galley stays open to everyone', () => {
  // The only deck with no owner — anyone can be dealt it at any time.
  const reached = ctx(`
    (() => {
      load();
      DUTIES.forEach(d => { state.duties[d.id].last = Date.now() - d.days * 86400000 * 1.1; });
      const seen = new Set();
      for (let i = 0; i < 3000; i++) { const d = draw('adult'); if (d) seen.add(d.deck); }
      return seen.has('galley');
    })()`);
  assert.strictEqual(reached, true, 'adult was locked out of the Galley');
});

run('the Playroom is held for the children', () => {
  // Both children own it, so a merely-due Playroom job must not reach an adult
  // — but the adult-only jobs there (windows, high shelves) still must.
  const res = ctx(`
    (() => {
      load();
      DUTIES.forEach(d => { state.duties[d.id].last = Date.now() - d.days * 86400000 * 1.1; });
      const seen = new Set();
      for (let i = 0; i < 4000; i++) { const d = draw('adult'); if (d && d.deck === 'playroom') seen.add(d.id); }
      const kidDoable = [...seen].filter(id => {
        const d = dutyById[id];
        return d.who.includes('k9') || d.who.includes('k5');
      });
      return { leaked: kidDoable, adultOnlyReached: seen.size - kidDoable.length };
    })()`);
  assert.strictEqual(res.leaked.length, 0, `adult was offered kid Playroom jobs: ${[...res.leaked].join(', ')}`);
  assert.ok(res.adultOnlyReached > 0, 'adult never reached the adult-only Playroom jobs');
});

run('both children can still be dealt the Playroom freely', () => {
  ['k9', 'k5'].forEach((id) => {
    const ok = ctx(`
      (() => {
        load();
        DUTIES.forEach(d => { state.duties[d.id].last = Date.now() - d.days * 86400000 * 1.1; });
        for (let i = 0; i < 2000; i++) { const d = draw('${id}'); if (d && d.deck === 'playroom') return true; }
        return false;
      })()`);
    assert.strictEqual(ok, true, `${id} cannot reach the Playroom they co-own`);
  });
});

run('a child is never blocked from their own room', () => {
  const ok = ctx(`
    (() => {
      load();
      DUTIES.filter(d => d.deck === 'bunkc').forEach(d => {
        state.duties[d.id].last = Date.now() - d.days * 86400000 * 1.1;
      });
      for (let i = 0; i < 2000; i++) { const d = draw('k5'); if (d && d.deck === 'bunkc') return true; }
      return false;
    })()`);
  assert.strictEqual(ok, true, 'the Cadet cannot reach their own quarters');
});

run('daily standing orders cannot carry a week on their own', () => {
  // Doing only the table and the island every day is good, but it shouldn't
  // complete the week by itself or the rest of the roster is decoration.
  const res = ctx(`
    CREW.filter(c => c.goal).map(c => {
      const orders = DUTIES.filter(d => d.owners && d.owners.includes(c.id));
      return { id: c.id, goal: c.goal, ordersPerWeek: orders.reduce((a, d) => a + 7 / d.days, 0) };
    })`);
  [...res].forEach((r) => {
    assert.ok(
      r.ordersPerWeek < r.goal,
      `${r.id}: standing orders give ${r.ordersPerWeek}/week against a goal of ${r.goal}`
    );
  });
});

run('a simple-mode goal is reachable within the available pool', () => {
  const res = ctx(`
    CREW.filter(c => c.goal).map(c => {
      const pool = DUTIES.filter(d => canAccess(c.id, d.deck) && d.who.includes(c.id));
      return { id: c.id, goal: c.goal, perWeek: Math.round(pool.reduce((a, d) => a + 7 / d.days, 0)) };
    })`);
  [...res].forEach((r) => {
    assert.ok(r.perWeek >= r.goal * 1.3, `${r.id}: only ${r.perWeek} completions/week available for a goal of ${r.goal}`);
  });
});

run('every crew member can still reach their weekly target', () => {
  // A target nobody can physically reach is a broken promise, not a challenge.
  const rows = ctx(`
    CREW.map(c => {
      const pool = DUTIES.filter(d => canAccess(c.id, d.deck) && d.who.includes(c.id));
      const perWeek = pool.reduce((a, d) => a + (d.pts * 7) / d.days, 0);
      return { id: c.id, target: c.target, perWeek: Math.round(perWeek), n: pool.length };
    })`);
  [...rows].forEach((r) => {
    assert.ok(
      r.perWeek >= r.target * 1.3,
      `${r.id}: only ${r.perWeek} merit/wk available against a ${r.target} target`
    );
    assert.ok(r.n >= 5, `${r.id} has only ${r.n} duties available — too repetitive`);
  });
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
