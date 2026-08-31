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

// freshness() is derived from elapsed time, so a just-completed duty reads
// 0.99999994 rather than 1 — milliseconds pass between the write and the read.
// The UI rounds to whole percents so it never shows, but assertions have to
// allow for it rather than demand exact equality on a float.
const near = (a, b, tol = 1e-5) => Math.abs(a - b) <= tol;

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
  assert.ok(!ctx("DECK_ACCESS.k9.includes('bunkc')"), 'k9 can reach the other child\'s quarters');
  assert.ok(!ctx("DECK_ACCESS.k5.includes('bunkb')"), 'k5 can reach the other child\'s quarters');
  assert.ok(!ctx("DECK_ACCESS.k9.includes('bunka')"), 'k9 can reach the adults quarters');
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
      const orders = DUTIES.filter(d => d.owners && d.deck === 'galley').map(d => d.id);
      const seen = new Set();
      for (let i = 0; i < 4000; i++) { const d = draw('adult'); if (d) seen.add(d.id); }
      return {
        orders: orders.length,
        leaked: orders.filter(id => seen.has(id)),
        galleyStillOpen: [...seen].some(id => dutyById[id].deck === 'galley'),
      };
    })()`);
  assert.strictEqual(res.orders, 2, 'expected two duty-level standing orders in the Galley');
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

run('track duties never enter the card draw', () => {
  const leaked = ctx(`
    (() => {
      load();
      DUTIES.forEach(d => { state.duties[d.id].last = Date.now() - d.days * 86400000 * 3; });
      const seen = new Set();
      ['adult','k9','k5'].forEach(c => {
        for (let i = 0; i < 2000; i++) { const d = draw(c); if (d) seen.add(d.id); }
      });
      return [...seen].filter(id => dutyById[id].track);
    })()`);
  assert.strictEqual(leaked.length, 0, `track duties were dealt: ${[...leaked].join(', ')}`);
});

run('ticking a track earns no merit and no droid', () => {
  const res = ctx(`
    (() => {
      load();
      state.log = [];
      trackDuties('k5').forEach(d => trackDone(d.id, 'k5'));
      return { merit: weekTotal('k5'), droids: countSince('k5', weekStart()), moons: trackCount('k5') };
    })()`);
  assert.strictEqual(res.merit, 0, 'a track tick paid merit');
  assert.strictEqual(res.droids, 0, 'a track tick counted as a duty done');
  assert.strictEqual(res.moons, 2, `expected 2 track ticks, got ${res.moons}`);
});

run('every child has a track and it is reachable', () => {
  const res = ctx(`
    ['k9','k5'].map(id => {
      const t = TRACKS[id];
      const duties = trackDuties(id);
      return { id, goal: t.goal, unit: t.unit, perWeek: duties.reduce((a, d) => a + 7 / d.days, 0) };
    })`);
  [...res].forEach((r) => {
    assert.ok(r.perWeek >= r.goal, `${r.id}: goal ${r.goal} ${r.unit} but only ${r.perWeek} chances a week`);
    // A goal you can only hit by never missing a single day is a streak in
    // disguise, and streaks are the one thing this design refuses.
    assert.ok(r.goal < r.perWeek, `${r.id}: goal ${r.goal} requires a perfect week`);
  });
});

run('a track cannot be ticked twice in one day', () => {
  const res = ctx(`
    (() => {
      load();
      const d = trackDuties('k9')[0];
      // The seed can land inside today by chance, so start from a known state.
      state.duties[d.id].last = Date.now() - 86400000 * 2;
      const before = doneToday(d.id);
      trackDone(d.id, 'k9');
      return { before, after: doneToday(d.id) };
    })()`);
  assert.strictEqual(res.before, false, 'a two-day-old tick counted as done today');
  assert.strictEqual(res.after, true, 'doneToday did not latch after a tick');
});

run('chore balance between the children is even once tracks are separate', () => {
  // The whole reason for the split: bedtime paying merit let the five-year-old
  // win a week on twenty minutes of work against the nine-year-old's seventy.
  const res = ctx(`
    ['k9','k5'].map(id => {
      const pool = DUTIES.filter(d => !d.track && canAccess(id, d.deck) && d.who.includes(id));
      const merit = pool.reduce((a, d) => a + (d.pts * 7) / d.days, 0);
      const mins = pool.reduce((a, d) => a + (d.mins * 7) / d.days, 0);
      const target = CREW.find(c => c.id === id).target;
      return { id, minsToTarget: target / (merit / mins) };
    })`);
  const [a, b] = [...res].map((r) => r.minsToTarget);
  const ratio = Math.max(a, b) / Math.min(a, b);
  assert.ok(ratio < 1.6, `children's real workloads differ by ${ratio.toFixed(2)}x (${Math.round(a)} vs ${Math.round(b)} min/wk)`);
});

run('no single duty can complete a week by itself', () => {
  // A week of perfect bedtimes is allowed to win — that's the point of pricing
  // the night watch high. But no one duty repeated alone should do it, or the
  // app collapses to a single button.
  const res = ctx(`
    CREW.map(c => {
      const pool = DUTIES.filter(d => !d.track && canAccess(c.id, d.deck) && d.who.includes(c.id));
      return {
        id: c.id, target: c.target,
        bestMerit: Math.max(...pool.map(d => (d.pts * 7) / d.days)),
      };
    })`);
  [...res].forEach((r) => {
    assert.ok(r.bestMerit < r.target, `${r.id}: one duty alone yields ${r.bestMerit} of a ${r.target} target`);
  });
});

run('the night watch belongs to the younger child alone', () => {
  // The older child must not earn credit for the younger one's bedtime, and
  // never be dealt to an adult while it's merely due.
  const res = ctx(`
    (() => {
      const night = DUTIES.filter(d => d.deck === 'bunkc' && d.tier === 'daily');
      load();
      night.forEach(d => { state.duties[d.id].last = Date.now() - d.days * 86400000 * 1.1; });
      const ids = night.map(d => d.id);
      let adultSaw = false, k9Saw = false;
      for (let i = 0; i < 3000; i++) {
        const a = draw('adult'); if (a && ids.includes(a.id)) adultSaw = true;
        const b = draw('k9');    if (b && ids.includes(b.id)) k9Saw = true;
      }
      return { n: night.length, who: night.map(d => d.who.join(',')), adultSaw, k9Saw };
    })()`);
  assert.strictEqual(res.n, 2, 'expected two night-watch duties');
  [...res.who].forEach((w) => assert.strictEqual(w, 'k5', `night watch open to: ${w}`));
  assert.strictEqual(res.adultSaw, false, 'adult was dealt the night watch');
  assert.strictEqual(res.k9Saw, false, 'the older child was dealt the younger one\'s night watch');
});

run('both children run on identical mechanics', () => {
  // "Both kids are cadets" is a rule, not a coat of paint: no per-crew mode,
  // no separate win condition, nothing one child has that the other doesn't.
  const res = ctx(`
    ['k9','k5'].map(id => {
      const c = CREW.find(x => x.id === id);
      return { id, keys: Object.keys(c).sort().join(','), rank: rankOf(id).current.name };
    })`);
  const [a, b] = [...res];
  assert.strictEqual(a.keys, b.keys, `the children carry different fields: ${a.keys} vs ${b.keys}`);
  assert.ok(!a.keys.includes('mode'), 'a crew mode survived — simple mode is gone');
  assert.ok(!a.keys.includes('goal'), 'a per-crew goal survived — the week is merit for everyone');
  assert.ok(ctx('typeof rankOf("k5").progress') === 'number', 'the younger child has no rank progression');
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
  assert.ok(near(res.fresh, 1), `a just-done duty should be fully fresh, got ${res.fresh}`);
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
      // Mirror what eligible() actually considers — tracks are ticked off in
      // their own strip and are never rescue candidates.
      const pool = DUTIES.filter(d => !d.track && d.who.includes('k5') && dueness(d.id) >= 0.3
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
  // A cadet hitting their small target should rank up exactly as fast as the
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
  assert.strictEqual(res.duties, 0, 'a drill bonus was counted as a duty done');
});

run('reset: nothing done leaves the ship at zero and everything available', () => {
  const res = ctx(`
    (() => {
      load();
      resetShip('due');
      const seen = new Set();
      for (let i = 0; i < 6000; i++) { const d = draw('adult'); if (d) seen.add(d.id); }
      return {
        integrity: shipIntegrity(),
        merit: weekTotal('adult'),
        allOverdue: DUTIES.every(d => dueness(d.id) >= 1.5),
        reachable: seen.size,
        // Not the whole roster: the Cadet's night watch is who:['k5'], so no
        // amount of overdue makes it an adult's job.
        adultCapable: DUTIES.filter(d => d.who.includes('adult')).length,
      };
    })()`);
  assert.strictEqual(res.integrity, 0, `ship should be at 0%, got ${res.integrity}`);
  assert.strictEqual(res.merit, 0);
  assert.strictEqual(res.allOverdue, true, 'not every duty came out overdue');
  // Everything is past first refusal, so nothing is held back on ownership.
  assert.strictEqual(
    res.reachable,
    res.adultCapable,
    `only ${res.reachable} of ${res.adultCapable} adult-capable duties reachable`
  );
});

run('reset: everything done leaves the ship spotless', () => {
  const res = ctx(`
    (() => { load(); resetShip('clean'); return { integrity: shipIntegrity(), merit: weekTotal('adult') }; })()`);
  assert.ok(near(res.integrity, 1), `ship should be at 100%, got ${res.integrity}`);
  assert.strictEqual(res.merit, 0);
});

run('reset: wiping merit leaves the ship untouched', () => {
  const res = ctx(`
    (() => {
      load();
      const before = shipIntegrity();
      complete(draw('adult').id, 'adult');
      const mid = shipIntegrity();
      resetShip('scores');
      return { mid, after: shipIntegrity(), merit: weekTotal('adult'), droids: countSince('k5', 0) };
    })()`);
  assert.strictEqual(res.merit, 0, 'merit survived a score wipe');
  assert.strictEqual(res.droids, 0, 'completed duties survived a score wipe');
  assert.ok(near(res.after, res.mid), `wiping scores moved integrity: ${res.mid} -> ${res.after}`);
});

run('reset: renames and the signed-in crew member survive', () => {
  const res = ctx(`
    (() => {
      load();
      state.deckNames.bunkc = 'Alfie';
      state.crewNames.k5 = 'Alfie';
      state.activeCrew = 'k5';
      ['due','fresh','clean','scores'].forEach(m => resetShip(m));
      return { deck: state.deckNames.bunkc, crew: state.crewNames.k5, active: state.activeCrew };
    })()`);
  assert.strictEqual(res.deck, 'Alfie', 'a renamed deck was lost to a reset');
  assert.strictEqual(res.crew, 'Alfie', 'a renamed crew member was lost to a reset');
  assert.strictEqual(res.active, 'k5', 'the signed-in crew member was lost to a reset');
});

run('accepting a mission pays nothing until it is signed off', () => {
  const res = ctx(`
    (() => {
      load(); state.log = []; state.missions = {};
      // Earlier resets persist, so don't trust the seed — make everything due.
      DUTIES.forEach(x => { state.duties[x.id].last = Date.now() - x.days * 86400000 * 1.1; });
      const d = draw('k9');
      acceptMission('k9', d.id);
      const mid = { merit: weekTotal('k9'), fresh: freshness(d.id) };
      const pts = signOff('k9');
      return { mid, pts, after: weekTotal('k9'), fresh: freshness(d.id), cleared: !activeMission('k9') };
    })()`);
  assert.strictEqual(res.mid.merit, 0, 'accepting a mission paid out immediately');
  assert.ok(res.mid.fresh < 1, 'accepting a mission refreshed the duty before it was done');
  assert.ok(res.pts > 0, 'signing off paid nothing');
  assert.strictEqual(res.after, res.pts, 'merit did not land on sign-off');
  assert.ok(near(res.fresh, 1), `the duty was not refreshed on sign-off, got ${res.fresh}`);
  assert.strictEqual(res.cleared, true, 'the mission stayed open after sign-off');
});

run('merit goes to whoever did the work, not whoever signed it', () => {
  const res = ctx(`
    (() => {
      load(); state.log = []; state.missions = {};
      acceptMission('k5', draw('k5').id);
      signOff('k5');
      return { k5: weekTotal('k5'), adult: weekTotal('adult') };
    })()`);
  assert.ok(res.k5 > 0, 'the child earned nothing for their own work');
  assert.strictEqual(res.adult, 0, 'the adult was credited for a child mission');
});

run('only children need signing off', () => {
  assert.strictEqual(ctx("needsSignOff('adult')"), false);
  assert.strictEqual(ctx("needsSignOff('k9')"), true);
  assert.strictEqual(ctx("needsSignOff('k5')"), true);
  const queue = ctx(`
    (() => {
      load(); state.missions = {};
      acceptMission('adult', draw('adult').id);
      acceptMission('k9', draw('k9').id);
      return pendingSignOff().map(p => p.crewId);
    })()`);
  assert.deepStrictEqual([...queue], ['k9'], `unexpected sign-off queue: ${[...queue].join(', ')}`);
});

run('handing a mission back costs nothing', () => {
  // Abandoning isn't ducking — no hazard pay, no merit, nothing moved.
  const res = ctx(`
    (() => {
      load(); state.log = []; state.missions = {};
      const d = draw('k9');
      const before = { skips: state.duties[d.id].skips, fresh: freshness(d.id) };
      acceptMission('k9', d.id);
      sendBack('k9');
      return { before, after: { skips: state.duties[d.id].skips, fresh: freshness(d.id) },
               merit: weekTotal('k9'), open: !!activeMission('k9') };
    })()`);
  assert.strictEqual(res.after.skips, res.before.skips, 'handing back raised hazard pay');
  assert.strictEqual(res.after.fresh, res.before.fresh, 'handing back altered the duty');
  assert.strictEqual(res.merit, 0);
  assert.strictEqual(res.open, false, 'the mission stayed open after being sent back');
});

run("a child's drill banks nothing until it is signed off", () => {
  const res = ctx(`
    (() => {
      load(); state.log = []; state.missions = {};
      DUTIES.forEach(x => { state.duties[x.id].last = Date.now() - x.days * 86400000 * 1.1; });
      const tasks = drawSprint('k9', 3);
      acceptDrill('k9', tasks.map(t => t.id), true);
      const mid = { merit: weekTotal('k9'), fresh: tasks.map(t => freshness(t.id)) };
      const pts = signOff('k9');
      return {
        mid, pts, after: weekTotal('k9'), n: tasks.length,
        allFresh: tasks.every(t => freshness(t.id) > 0.9999),
        bonus: state.log.some(e => e.duty === 'bonus:redalert'),
      };
    })()`);
  assert.strictEqual(res.n, 3, 'a drill should deal three');
  assert.strictEqual(res.mid.merit, 0, 'a cleared drill paid out before sign-off');
  assert.ok([...res.mid.fresh].every((f) => f < 1), 'a cleared drill refreshed duties before sign-off');
  assert.strictEqual(res.after, res.pts, 'drill merit did not land on sign-off');
  assert.strictEqual(res.allFresh, true, 'sign-off did not refresh every duty in the drill');
  assert.strictEqual(res.bonus, true, 'a fully cleared drill paid no bonus');
});

run('a part-cleared drill pays no bonus', () => {
  const bonus = ctx(`
    (() => {
      load(); state.log = []; state.missions = {};
      const tasks = drawSprint('k5', 3);
      acceptDrill('k5', [tasks[0].id, tasks[1].id], false);
      signOff('k5');
      return state.log.some(e => e.duty === 'bonus:redalert');
    })()`);
  assert.strictEqual(bonus, false, 'a part-cleared drill paid the full-clear bonus');
});

run('sending a drill back scores nothing at all', () => {
  const res = ctx(`
    (() => {
      load(); state.log = []; state.missions = {};
      const tasks = drawSprint('k9', 3);
      acceptDrill('k9', tasks.map(t => t.id), true);
      sendBack('k9');
      return { merit: weekTotal('k9'), droids: countSince('k9', 0), open: !!activeMission('k9') };
    })()`);
  assert.strictEqual(res.merit, 0);
  assert.strictEqual(res.droids, 0, 'a rejected drill still awarded droids');
  assert.strictEqual(res.open, false);
});

run('an old single-duty mission still loads', () => {
  // Saves written before drills stored one duty, not a list.
  const res = ctx(`
    (() => {
      load();
      const id = DUTIES.find(d => !d.track).id;
      state.missions = { k9: { duty: id, at: Date.now() } };
      localStorage.setItem('shipshape.v1', JSON.stringify(state));
      load();
      const m = activeMission('k9');
      return { has: !!m, n: m ? m.duties.length : 0, same: m ? m.duties[0] === id : false };
    })()`);
  assert.strictEqual(res.has, true, 'an old-format mission was lost on load');
  assert.strictEqual(res.n, 1);
  assert.strictEqual(res.same, true);
});

run('a reset clears any open missions', () => {
  const open = ctx(`
    (() => {
      load();
      acceptMission('k9', draw('k9').id);
      resetShip('fresh');
      return !!activeMission('k9');
    })()`);
  assert.strictEqual(open, false, 'a mission survived a reset');
});

run('neglect raises the pay even with no skips', () => {
  // The dread tax used to catch only actively-ducked duties; a quietly
  // forgotten one stayed cheap forever, which is the wrong incentive.
  const res = ctx(`
    (() => {
      load();
      const d = DUTIES.find(x => !x.track);
      state.duties[d.id].skips = 0;
      const at = (mult) => {
        state.duties[d.id].last = Date.now() - d.days * 86400000 * mult;
        return { due: dueness(d.id), pay: payMult(d.id), value: value(d.id) };
      };
      return { fresh: at(0.5), due: at(1), late: at(2), rotten: at(4), ancient: at(20) };
    })()`);
  assert.strictEqual(res.fresh.pay, 1, 'a fresh duty should pay base rate');
  assert.strictEqual(res.due.pay, 1, 'a just-due duty should pay base rate');
  assert.ok(res.late.pay > 1, 'an overdue duty should pay more');
  assert.ok(res.rotten.pay > res.late.pay, 'pay should keep climbing with neglect');
  assert.ok(res.rotten.value > res.late.value, 'the value should follow the multiplier');
  assert.ok(res.ancient.pay <= 3, `combined pay must stay capped, got ${res.ancient.pay}`);
});

run('skips and neglect compound but stay capped', () => {
  const res = ctx(`
    (() => {
      load();
      const d = DUTIES.find(x => !x.track);
      state.duties[d.id].last = Date.now() - d.days * 86400000 * 3;
      state.duties[d.id].skips = 0;
      const neglectOnly = payMult(d.id);
      for (let i = 0; i < 3; i++) swap(d.id);
      const both = payMult(d.id);
      for (let i = 0; i < 40; i++) swap(d.id);
      return { neglectOnly, both, maxed: payMult(d.id) };
    })()`);
  assert.ok(res.both > res.neglectOnly, 'ducking an already-rotten job should cost more still');
  assert.strictEqual(res.maxed, 3, `combined multiplier should cap at 3, got ${res.maxed}`);
});

run('the week turns over on Friday morning', () => {
  const res = ctx(`
    (() => {
      const at = (iso) => { const s = weekStart(new Date(iso).getTime()); const d = new Date(s);
        return { day: d.getDay(), hour: d.getHours(), iso: d.toISOString() }; };
      return {
        // Thursday evening still belongs to the week being judged.
        thu: at('2026-09-03T21:00:00'),
        // Friday before the turn is still the old week.
        friEarly: at('2026-09-04T06:59:00'),
        // Friday after the turn starts the new one.
        friLate: at('2026-09-04T07:01:00'),
        sun: at('2026-09-06T12:00:00'),
      };
    })()`);
  [res.thu, res.friEarly, res.friLate, res.sun].forEach((r) => {
    assert.strictEqual(r.day, 5, `week should start on a Friday, got day ${r.day}`);
    assert.strictEqual(r.hour, 7, `week should start at 07:00, got ${r.hour}`);
  });
  assert.strictEqual(res.thu.iso, res.friEarly.iso, 'Thursday night and Friday 6am should share a week');
  assert.notStrictEqual(res.friEarly.iso, res.friLate.iso, 'the Friday turn did not start a new week');
  assert.strictEqual(res.friLate.iso, res.sun.iso, 'Friday after the turn and Sunday should share a week');
});

run('history is derived from the log, week by week', () => {
  const res = ctx(`
    (() => {
      load(); state.log = []; state.missions = {};
      const wk = weekStart();
      const WEEK = 7 * 86400000;
      // Three completed weeks back, with a known score each.
      [1, 2, 3].forEach(n => {
        for (let i = 0; i < n; i++) {
          state.log.push({ t: wk - n * WEEK + 3600000, crew: 'k9', duty: 'x', pts: 100 });
        }
      });
      // Something this week, which must not appear in past weeks.
      state.log.push({ t: Date.now(), crew: 'k9', duty: 'x', pts: 999 });
      const past = pastWeeks(8);
      return {
        n: past.length,
        scores: past.map(w => w.crew.k9.merit),
        hasCurrent: past.some(w => w.crew.k9.merit === 999),
        allTime: allTime().crew.k9.merit,
      };
    })()`);
  assert.strictEqual(res.n, 3, `expected 3 completed weeks, got ${res.n}`);
  // Newest first: one week ago scored 100, two ago 200, three ago 300.
  assert.deepStrictEqual([...res.scores], [100, 200, 300], `got ${[...res.scores].join(', ')}`);
  assert.strictEqual(res.hasCurrent, false, 'the current week leaked into history');
  assert.strictEqual(res.allTime, 1599, `all-time should include this week, got ${res.allTime}`);
});

run('a won week is the same rule for everybody', () => {
  // One measure now: your own merit against your own target. History has to use
  // the rule the weekly panel does, or the two disagree — and the targets have
  // to stay scaled, so a child's winning number must not win the adult's week.
  const res = ctx(`
    (() => {
      load(); state.log = []; state.missions = {};
      const wk = weekStart() - 7 * 86400000;
      const small = CREW.find(c => c.id === 'k5').target;
      state.log.push({ t: wk + 1000, crew: 'k5', duty: 'x', pts: small });
      state.log.push({ t: wk + 1000, crew: 'adult', duty: 'x', pts: small });
      const w = pastWeeks(2)[0];
      const all = allTime();
      return {
        k5Hit: w.crew.k5.hitTarget, adultHit: w.crew.adult.hitTarget,
        k5Won: all.crew.k5.weeksWon, adultWon: all.crew.adult.weeksWon,
      };
    })()`);
  assert.strictEqual(res.k5Hit, true, 'a child hit their own target and it was not recorded');
  assert.strictEqual(res.adultHit, false, "a child's winning number also won the adult's week");
  assert.strictEqual(res.k5Won, 1, 'the won week was not counted');
  assert.strictEqual(res.adultWon, 0, 'an unwon week was counted');
});

run('track ticks are counted separately in history', () => {
  const res = ctx(`
    (() => {
      load(); state.log = []; state.missions = {};
      const wk = weekStart() - 7 * 86400000;
      state.log.push({ t: wk + 1000, crew: 'k9', duty: 'x', pts: 50 });
      state.log.push({ t: wk + 2000, crew: 'k9', duty: 'y', pts: 0, track: 'research' });
      const w = pastWeeks(2)[0].crew.k9;
      return w;
    })()`);
  assert.strictEqual(res.merit, 50, 'a track tick leaked into merit');
  assert.strictEqual(res.duties, 1, 'a track tick was counted as a duty');
  assert.strictEqual(res.track, 1, 'the track tick was not counted');
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

// ── The hangar ──────────────────────────────────────────────────────────────

run('every duty counts towards exactly one speciality', () => {
  // A duty matching nothing can never be worked towards a droid, and would sit
  // in the roster looking identical to one that can.
  const res = ctx(`
    (() => {
      const unmatched = DUTIES.filter(d => !d.track && !d.spec).map(d => d.name);
      const tracked = DUTIES.filter(d => d.track && d.spec).map(d => d.name);
      const unknown = DUTIES.filter(d => d.spec && !SPECIALITIES.some(s => s.id === d.spec)).map(d => d.name);
      return { unmatched, tracked, unknown };
    })()`);
  assert.strictEqual([...res.unmatched].length, 0, `no speciality: ${[...res.unmatched].join(', ')}`);
  assert.strictEqual([...res.tracked].length, 0, `a track duty earns droids: ${[...res.tracked].join(', ')}`);
  assert.strictEqual([...res.unknown].length, 0, `unknown speciality: ${[...res.unknown].join(', ')}`);
});

run('droid thresholds only ever climb', () => {
  const bad = ctx(`
    SPECIALITIES.filter(s => s.droids.some((d, i) => i && d.at <= s.droids[i - 1].at)).map(s => s.id)`);
  assert.strictEqual([...bad].length, 0, `thresholds out of order: ${[...bad].join(', ')}`);
});

run('every crew member can reach several first droids at an ordinary pace', () => {
  // Two specialities live in rooms the children can't be sent to, so a child's
  // hangar is expected to fill more slowly and stop sooner. What isn't
  // acceptable is a hangar that stays empty: everyone needs a few droids
  // arriving in the first month or the collection never starts.
  const res = ctx(`
    CREW.map(c => {
      const near = SPECIALITIES.filter(s => {
        const perWeek = DUTIES
          .filter(d => d.spec === s.id && canAccess(c.id, d.deck) && d.who.includes(c.id))
          .reduce((a, d) => a + 7 / d.days, 0);
        return perWeek > 0 && s.droids[0].at / perWeek <= 4;
      });
      return { id: c.id, near: near.length };
    })`);
  [...res].forEach((r) => {
    assert.ok(r.near >= 4, `${r.id}: only ${r.near} specialities yield a droid inside four weeks`);
  });
});

run('droids come off the log, and a drill bonus earns none', () => {
  const res = ctx(`
    (() => {
      load(); state.log = []; state.missions = {};
      const win = DUTIES.find(d => d.spec === 'glass' && d.who.includes('k5'));
      const before = badgeSnapshot('k5');
      for (let i = 0; i < 3; i++) state.log.push({ t: Date.now(), crew: 'k5', duty: win.id, pts: 10 });
      state.log.push({ t: Date.now(), crew: 'k5', duty: 'bonus:redalert', pts: 40 });
      const crossed = badgesCrossed('k5', before);
      const glass = badgesFor('k5').find(s => s.id === 'glass');
      return {
        count: glass.count,
        earned: glass.droids.filter(d => d.earned).length,
        crossed: crossed.map(c => c.spec.id),
        aboard: droidsAboard('k5'),
      };
    })()`);
  assert.strictEqual(res.count, 3, 'window duties were not counted towards the Glazier');
  assert.strictEqual(res.earned, 1, 'the first Glazier droid did not arrive at its threshold');
  assert.strictEqual([...res.crossed].join(','), 'glass', 'the wrong droids were announced');
  assert.strictEqual(res.aboard, 1, 'a drill bonus conjured a droid');
});

run('droids are never taken away once earned', () => {
  // The whole reason the hangar replaced a weekly count: a bad week has to
  // cost you nothing you already had, or it's a streak wearing a hat.
  const res = ctx(`
    (() => {
      load(); state.log = [];
      const win = DUTIES.find(d => d.spec === 'glass' && d.who.includes('k5'));
      for (let i = 0; i < 3; i++)
        state.log.push({ t: weekStart() - 40 * 86400000, crew: 'k5', duty: win.id, pts: 10 });
      return { aboard: droidsAboard('k5'), thisWeek: weekTotal('k5') };
    })()`);
  assert.strictEqual(res.thisWeek, 0, 'the setup leaked into this week');
  assert.strictEqual(res.aboard, 1, 'a droid earned weeks ago was lost');
});

run('the v1 rank names are migrated, but a chosen name is kept', () => {
  const res = ctx(`
    (() => {
      const kept = localStorage.getItem(STORE_KEY);
      localStorage.setItem(STORE_KEY, JSON.stringify({
        v: 1,
        crewNames: { adult: 'Captain', k9: 'Commander', k5: 'Marnie' },
        deckNames: { bunkb: "Commander's Quarters", bunkc: "Cadet's Quarters" },
        duties: {}, log: [], missions: {}, activeCrew: 'k9',
      }));
      load();
      const out = {
        k9: state.crewNames.k9,
        k5: state.crewNames.k5,
        bunkb: state.deckNames.bunkb,
        v: state.v,
      };
      localStorage.setItem(STORE_KEY, kept);
      load();
      return out;
    })()`);
  assert.strictEqual(res.k9, 'Cadet 1', 'the old Commander was not made a cadet');
  assert.strictEqual(res.k5, 'Marnie', 'a name the crew chose was overwritten');
  assert.strictEqual(res.bunkb, "Cadet 1's Quarters", 'the quarters kept the old rank');
  assert.strictEqual(res.v, 2, 'the save was not marked as migrated');
});

run('nobody is shown a droid they could never earn', () => {
  // Sanitation lives entirely in rooms the children can't be sent to. A locked
  // slot reading "10 more to Sparky" for a droid that can never arrive is an
  // unmeetable goal wearing a reward's clothes, which is the one thing this
  // app must not put in front of a child.
  const res = ctx(`
    CREW.map(c => ({
      id: c.id,
      shown: specsFor(c.id).map(s => s.id),
      impossible: specsFor(c.id).filter(s =>
        !DUTIES.some(d => d.spec === s.id && canAccess(c.id, d.deck) && d.who.includes(c.id))
      ).map(s => s.id),
      total: droidTotal(c.id),
    }))`);
  [...res].forEach((r) => {
    assert.strictEqual([...r.impossible].length, 0, `${r.id} is shown unreachable: ${[...r.impossible].join(', ')}`);
    assert.ok([...r.shown].length >= 4, `${r.id} sees only ${[...r.shown].length} specialities`);
    assert.strictEqual(r.total, [...r.shown].length * 3, `${r.id}: denominator counts hidden droids`);
  });
  const kids = [...res].filter((r) => r.id !== 'adult');
  kids.forEach((r) =>
    assert.ok(![...r.shown].includes('sanitation'), `${r.id} is offered sanitation droids they cannot reach`)
  );
});
