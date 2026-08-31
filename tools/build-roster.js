// Generates the duty roster reference page directly from the app's data.js,
// so the published list can't drift from what the app actually deals.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const c = { console };
vm.createContext(c);
vm.runInContext(fs.readFileSync(`${root}/js/data.js`, 'utf8'), c);

const DUTIES = vm.runInContext('DUTIES', c);
const DECKS = vm.runInContext('DECKS', c);
const TIERS = vm.runInContext('TIERS', c);
const ZONES = vm.runInContext('ZONES', c);
const DECK_ACCESS = vm.runInContext('DECK_ACCESS', c);
const TRACKS = vm.runInContext('TRACKS', c);
const deckById = Object.fromEntries(DECKS.map((d) => [d.id, d]));

// Eligibility is both gates: may you be sent to this deck, and is the job safe
// for you. The page must show the same intersection the app deals from.
const access = (crewId, deckId) =>
  DECK_ACCESS[crewId] === null || DECK_ACCESS[crewId].includes(deckId);
const canDo = (crewId, d) => access(crewId, d.deck) && d.who.includes(crewId);

// Read the crew from data.js too — hardcoding targets here is how this page
// starts quietly lying about the app.
// Both children are cadets, so the abbreviations can't be ranks any more.
const SHORT = { adult: 'Cpt', k9: 'C1', k5: 'C2' };
const CREW = vm.runInContext('CREW', c).map((cw) => ({ ...cw, short: SHORT[cw.id] ?? cw.id }));

const TIER_ORDER = ['daily', 'often', 'weekly', 'biweekly', 'monthly', 'seasonal'];
const TIER_META = {
  daily:    { label: 'Daily',     every: 'every day',     cls: 'dl' },
  often:    { label: 'Routine',   every: 'every 3 days',  cls: 'r' },
  weekly:   { label: 'Scheduled', every: 'every week',    cls: 's' },
  biweekly: { label: 'Fortnightly', every: 'every 2 weeks', cls: 'f' },
  monthly:  { label: 'Overhaul',  every: 'every month',   cls: 'o' },
  seasonal: { label: 'Drydock',   every: 'every 3 months', cls: 'd' },
};

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ── Aggregates for the summary band ─────────────────────────────────────────
const CHORES = DUTIES.filter((d) => !d.track);
const total = CHORES.length;
const byTier = TIER_ORDER.map((t) => ({
  t,
  n: CHORES.filter((d) => d.tier === t).length,
  pts: DUTIES.filter((d) => d.tier === t).reduce((a, d) => a + d.pts, 0),
}));
const byCrew = CREW.map((cw) => {
  const pool = CHORES.filter((d) => canDo(cw.id, d));
  return {
    ...cw,
    n: pool.length,
    mins: pool.reduce((a, d) => a + d.mins, 0),
  };
});

// Weekly load: how much merit each duty is worth per week at its own cadence.
// This is the number that says whether a target is realistic.
const weeklyLoad = (pool) =>
  Math.round(pool.reduce((a, d) => a + (d.pts * 7) / d.days, 0));

const crewLoad = CREW.map((cw) => ({
  ...cw,
  load: weeklyLoad(CHORES.filter((d) => canDo(cw.id, d))),
  decks: DECK_ACCESS[cw.id],
}));

// ── Rows ────────────────────────────────────────────────────────────────────
function dutyRow(d) {
  const m = TIER_META[d.tier];
  const who = CREW.filter((cw) => canDo(cw.id, d)).map((cw) => cw.id);
  const owners = d.owners ?? deckById[d.deck].owners;
  const held = (cwId) =>
    owners && !owners.includes(cwId) && owners.some((o) => d.who.includes(o));
  const pills = CREW.map(function (cw) {
    if (!who.includes(cw.id)) return `<span class="pill off" title="${cw.name}">${cw.short}</span>`;
    if (held(cw.id))
      return `<span class="pill held" title="${cw.name} — backstop only, once well past due">${cw.short}</span>`;
    return `<span class="pill on" title="${cw.name}">${cw.short}</span>`;
  }).join('');
  return `<tr data-tier="${d.tier}" data-who="${who.join(' ')}">
  <td class="c-icon">${d.icon}</td>
  <td class="c-name">${esc(d.name)}</td>
  <td class="c-tier"><span class="tier ${m.cls}">${m.label}</span><span class="every">${m.every}</span></td>
  <td class="c-num merit">${d.pts}</td>
  <td class="c-num mins">${d.mins}<span class="u">m</span></td>
  <td class="c-who">${pills}</td>
</tr>`;
}

function deckSection(deck) {
  const pool = CHORES.filter((d) => d.deck === deck.id);
  const pts = pool.reduce((a, d) => a + d.pts, 0);
  const rows = pool
    .slice()
    .sort((a, b) => TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier) || b.pts - a.pts)
    .map(dutyRow)
    .join('\n');
  return `<section class="deck" data-deck="${deck.id}">
  <header class="deck-head">
    <span class="deck-em">${deck.emoji}</span>
    <div class="deck-id">
      <h3>${esc(deck.name)}</h3>
      <p>${esc(deck.sub)}${deck.owners && !deck.owners.includes('adult')
        ? ` · <span class="owned">${deck.owners
            .map((o) => CREW.find((c) => c.id === o).name)
            .join(' &amp; ')}'s responsibility</span>`
        : ''}</p>
    </div>
    <dl class="deck-stats">
      <div><dt>Duties</dt><dd>${pool.length}</dd></div>
      <div><dt>Merit</dt><dd>${pts}</dd></div>
      <div><dt>Per week</dt><dd>${weeklyLoad(pool)}</dd></div>
    </dl>
  </header>
  <div class="table-wrap">
    <table>
      <thead><tr>
        <th></th><th>Duty</th><th>Cadence</th><th class="c-num">Merit</th><th class="c-num">Time</th><th>Eligible</th>
      </tr></thead>
      <tbody>
${rows}
      </tbody>
    </table>
  </div>
</section>`;
}


const trackBlock = Object.entries(TRACKS)
  .map(([crewId, t]) => {
    const cw = CREW.find((c) => c.id === crewId);
    const rows = DUTIES.filter((d) => d.track === t.id)
      .map(
        (d) => `<tr><td class="c-icon">${d.icon}</td><td class="c-name">${esc(d.name)}</td>
        <td class="c-tier"><span class="tier dl">Daily</span><span class="every">every day</span></td>
        <td class="c-who"><span class="pill on">${cw.short}</span></td></tr>`
      )
      .join('\n');
    return `<section class="deck">
  <header class="deck-head">
    <span class="deck-em">${t.icon}</span>
    <div class="deck-id"><h3>${t.name}</h3><p><span class="owned">${cw.emoji} ${cw.name} only</span></p></div>
    <dl class="deck-stats"><div><dt>Weekly goal</dt><dd>${t.goal} ${t.unit}</dd></div><div><dt>Chances</dt><dd>14</dd></div></dl>
  </header>
  <div class="table-wrap"><table><thead><tr><th></th><th>Habit</th><th>Cadence</th><th>Whose</th></tr></thead>
  <tbody>\n${rows}\n</tbody></table></div>
</section>`;
  })
  .join('\n');

const zoneBlocks = Object.entries(ZONES)
  .map(([zone, title]) => {
    const decks = DECKS.filter((d) => d.zone === zone);
    if (!decks.length) return '';
    return `<h2 class="zone">${title}</h2>\n${decks.map(deckSection).join('\n')}`;
  })
  .join('\n');

const html = `<title>Ship Shape Duty Roster</title>
<style>
/* Committed to a single dark treatment: this is the ship's manifest for a
   dark HUD app, so it keeps that world rather than inventing a second one.
   Every colour is painted explicitly so the page holds on any host ground. */
:root {
  --ground: #060910;
  --panel: #0f1726;
  --panel-2: #131d31;
  --rule: #223354;
  --text: #d3e2f7;
  --dim: #7d90ae;
  --cyan: #4fd6ff;
  --daily: #4fd6ff;
  --routine: #46d98a;
  --scheduled: #b8d94a;
  --fortnightly: #dfc93f;
  --overhaul: #ffb845;
  --drydock: #ff6b8a;
  --mono: ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, monospace;
  --sans: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
}

* { box-sizing: border-box; }

body {
  margin: 0;
  background: var(--ground);
  color: var(--text);
  font-family: var(--sans);
  line-height: 1.5;
  -webkit-text-size-adjust: 100%;
}

.wrap {
  max-width: 1040px;
  margin: 0 auto;
  padding: 32px 18px 80px;
  display: flex;
  flex-direction: column;
  gap: 28px;
}

/* ── Masthead ───────────────────────────────────────────────────────────── */
.mast { display: flex; flex-direction: column; gap: 10px; }
.eyebrow {
  font-family: var(--mono);
  font-size: 11px;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: var(--cyan);
}
h1 {
  margin: 0;
  font-family: var(--mono);
  font-size: clamp(26px, 6vw, 40px);
  font-weight: 600;
  letter-spacing: -0.01em;
  text-wrap: balance;
}
.lede { margin: 0; color: var(--dim); max-width: 62ch; font-size: 15px; }
.lede strong { color: var(--text); font-weight: 600; }

/* ── Summary ────────────────────────────────────────────────────────────── */
.summary {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 10px;
}
.stat {
  background: var(--panel);
  border: 1px solid var(--rule);
  border-radius: 12px;
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.stat dt {
  font-family: var(--mono);
  font-size: 10px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--dim);
}
.stat dd {
  margin: 0;
  font-family: var(--mono);
  font-size: 25px;
  font-variant-numeric: tabular-nums;
  color: var(--cyan);
}
.stat .note { font-size: 12px; color: var(--dim); }

/* ── Filters ────────────────────────────────────────────────────────────── */
.filters {
  position: sticky;
  top: 0;
  z-index: 5;
  background: var(--ground);
  border-bottom: 1px solid var(--rule);
  padding: 12px 0;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}
.filters .lbl {
  font-family: var(--mono);
  font-size: 10px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--dim);
  margin-right: 2px;
}
.filters button {
  font: inherit;
  font-size: 13px;
  color: var(--dim);
  background: var(--panel);
  border: 1px solid var(--rule);
  border-radius: 99px;
  padding: 7px 14px;
  min-height: 38px;
  cursor: pointer;
}
.filters button:hover { color: var(--text); border-color: #33507f; }
.filters button:focus-visible { outline: 2px solid var(--cyan); outline-offset: 2px; }
.filters button[aria-pressed="true"] {
  background: var(--panel-2);
  border-color: var(--cyan);
  color: var(--text);
  box-shadow: inset 0 0 0 1px var(--cyan);
}
.count { margin-left: auto; font-family: var(--mono); font-size: 12px; color: var(--dim); font-variant-numeric: tabular-nums; }

/* ── Decks ──────────────────────────────────────────────────────────────── */
.zone {
  margin: 12px 0 0;
  font-family: var(--mono);
  font-size: 11px;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: var(--dim);
  border-top: 1px solid var(--rule);
  padding-top: 14px;
}
.deck {
  background: var(--panel);
  border: 1px solid var(--rule);
  border-radius: 14px;
  overflow: hidden;
}
.deck-head {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px 16px;
  border-bottom: 1px solid var(--rule);
  flex-wrap: wrap;
}
.deck-em { font-size: 24px; line-height: 1; }
.deck-id { flex: 1; min-width: 140px; }
.deck-id h3 { margin: 0; font-size: 17px; font-weight: 600; }
.deck-id p { margin: 0; font-size: 12px; color: var(--dim); }
.deck-stats { display: flex; gap: 18px; margin: 0; }
.deck-stats div { display: flex; flex-direction: column; }
.deck-stats dt {
  font-family: var(--mono);
  font-size: 9px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--dim);
}
.deck-stats dd {
  margin: 0;
  font-family: var(--mono);
  font-size: 15px;
  font-variant-numeric: tabular-nums;
}

/* ── Table ──────────────────────────────────────────────────────────────── */
.table-wrap { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; font-size: 14px; }
thead th {
  text-align: left;
  font-family: var(--mono);
  font-size: 9px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--dim);
  font-weight: 500;
  padding: 8px 10px;
  border-bottom: 1px solid var(--rule);
  white-space: nowrap;
}
tbody tr { border-bottom: 1px solid #1a2740; }
tbody tr:last-child { border-bottom: 0; }
td { padding: 10px; vertical-align: middle; }
.c-icon { width: 30px; font-size: 17px; text-align: center; padding-right: 0; }
.c-name { min-width: 190px; }
.c-num { text-align: right; font-family: var(--mono); font-variant-numeric: tabular-nums; white-space: nowrap; }
.merit { color: var(--cyan); }
.mins { color: var(--dim); }
.mins .u { font-size: 11px; opacity: 0.7; }
.c-tier { white-space: nowrap; }
.c-who { white-space: nowrap; text-align: right; }

.tier {
  display: inline-block;
  font-family: var(--mono);
  font-size: 10px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  padding: 3px 8px;
  border-radius: 99px;
  border: 1px solid currentColor;
}
.tier.dl { color: var(--daily); }
.tier.r { color: var(--routine); }
.tier.s { color: var(--scheduled); }
.tier.f { color: var(--fortnightly); }
.tier.o { color: var(--overhaul); }
.tier.d { color: var(--drydock); }
.every { display: block; font-size: 11px; color: var(--dim); margin-top: 3px; }

.pill {
  display: inline-block;
  width: 34px;
  font-family: var(--mono);
  font-size: 10px;
  text-align: center;
  padding: 4px 0;
  border-radius: 6px;
  margin-left: 3px;
}
.pill.on { background: #17324a; color: var(--cyan); border: 1px solid #2c5f80; }
/* Capable, but the job is held for whoever's room it is — backstop only. */
.pill.held { background: transparent; color: var(--overhaul); border: 1px dashed #6b5326; }
.pill.off { background: transparent; color: #2c3a52; border: 1px solid #1a2740; }
.owned { color: var(--overhaul); }

.deck.hidden, tr.hidden { display: none; }

/* ── Footnote ───────────────────────────────────────────────────────────── */
.foot {
  border-top: 1px solid var(--rule);
  padding-top: 18px;
  color: var(--dim);
  font-size: 13px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.foot h4 {
  margin: 0;
  font-family: var(--mono);
  font-size: 10px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--text);
}
.foot p { margin: 0; max-width: 70ch; }
.foot code {
  font-family: var(--mono);
  font-size: 12px;
  background: var(--panel);
  border: 1px solid var(--rule);
  border-radius: 4px;
  padding: 1px 5px;
}

@media (prefers-reduced-motion: reduce) { * { animation: none !important; transition: none !important; } }
</style>

<div class="wrap">

  <header class="mast">
    <div class="eyebrow">Ship Shape · Standing orders</div>
    <h1>Duty Roster</h1>
    <p class="lede">Every job the app can deal, across ten decks. <strong>Eligible</strong> is who <em>can</em> be dealt a duty, not who owns it — nothing is assigned. The draw picks from whoever's eligible, weighted by how overdue the job is and how many times it's been ducked.</p>
    <p class="lede">Eligibility clears two gates. <strong>Access</strong>: the children keep their own quarters and share the Playroom and Galley, and the adults cover everything else. <strong>Safety</strong>: anything involving chemicals, heights or heft stays with the adults — so a child still isn't handed the window cleaner in their own bedroom.</p>
    <p class="lede">A third rule sits on top. Your own patch is your responsibility, so a job you can do there is <strong>held for you</strong> — nobody else is offered it until it's half again past due, and only then does an adult pick up the slack. A <span class="pill held" style="width:auto;padding:2px 7px">dashed</span> pill means backstop only. Each child owns their bedroom and the two of them share the Playroom; the Galley is the one deck open to everybody at any time.</p>
  </header>

  <dl class="summary">
    <div class="stat"><dt>Duties</dt><dd>${total}</dd><span class="note">across ${DECKS.length} decks</span></div>
    ${crewLoad
      .map(
        (cw) => `<div class="stat">
      <dt>${cw.emoji} ${cw.name}</dt>
      <dd>${byCrew.find((b) => b.id === cw.id).n}</dd>
      <span class="note">eligible · ${cw.load} merit/wk available vs ${cw.target} target</span>
    </div>`
      )
      .join('\n    ')}
  </dl>

  <div class="filters">
    <span class="lbl">Show</span>
    <button data-f="who" data-v="all" aria-pressed="true">Everyone</button>
    ${CREW.map((cw) => `<button data-f="who" data-v="${cw.id}" aria-pressed="false">${cw.emoji} ${cw.name}</button>`).join('\n    ')}
    <span class="lbl" style="margin-left:10px">Cadence</span>
    <button data-f="tier" data-v="all" aria-pressed="true">Any</button>
    ${TIER_ORDER.map((t) => `<button data-f="tier" data-v="${t}" aria-pressed="false">${TIER_META[t].label}</button>`).join('\n    ')}
    <span class="count" id="count"></span>
  </div>

<h2 class="zone">Personal tracks — scored separately</h2>
  <p class="lede" style="margin:-14px 0 0">Bedtime and homework aren't cleaning. These earn no merit and no droids, never appear in the card draw, and are ticked off in their own strip — so each child has two rewards to chase and neither can substitute for the other.</p>
${trackBlock}

${zoneBlocks}

  <div class="foot">
    <h4>Reading the numbers</h4>
    <p><strong style="color:var(--text)">Merit</strong> is the base payout. It rises in play — every time a duty is swapped away its hazard pay climbs by 25%, capping at ×3, so the jobs nobody wants become the best-paid ones on the ship.</p>
    <p><strong style="color:var(--text)">Merit/wk available</strong> is what each cadence would generate if every eligible duty were done exactly on schedule. The Captain's figure — ${crewLoad[0].load} — is the whole roster, so it's the ship's full upkeep: about ${Math.round((crewLoad[0].load * 0.4) / 60)} hours of cleaning a week, which is an honest number for a house this size.</p>

    <h4 style="margin-top:6px">Why the ship sits near ${Math.round((crewLoad.reduce((a, c) => a + c.target, 0) / crewLoad[0].load) * 100)}% and that's fine</h4>
    <p>The three weekly targets add up to <strong style="color:var(--text)">${crewLoad.reduce((a, c) => a + c.target, 0)}</strong> against full upkeep of <strong style="color:var(--text)">${crewLoad[0].load}</strong>. So everyone can hit their target every week and the ship still settles around <strong style="color:var(--routine)">${Math.round((crewLoad.reduce((a, c) => a + c.target, 0) / crewLoad[0].load) * 100)}% integrity</strong> rather than climbing toward 100 — nobody deep-cleans an oven exactly on schedule forever.</p>
    <p>The integrity bands are calibrated to that reality, not to a spotless house: <strong style="color:var(--routine)">green from 40%</strong>, amber from 25%, red below. A well-run house reads <em>All systems nominal</em>. Raise the bands only if you also raise the weekly targets, or the dashboard turns into a guilt trip — which is the one thing this design is built to avoid.</p>
    <p>Edit the roster in <code>js/data.js</code>. Duty ids are derived from deck and name, so renaming a duty resets its history; changing only its points, cadence or eligibility keeps it.</p>
  </div>

</div>

<script>
(function () {
  var state = { who: 'all', tier: 'all' };
  var rows = Array.prototype.slice.call(document.querySelectorAll('tbody tr'));
  var decks = Array.prototype.slice.call(document.querySelectorAll('.deck'));
  var countEl = document.getElementById('count');

  function apply() {
    var shown = 0;
    rows.forEach(function (tr) {
      var okWho = state.who === 'all' || tr.dataset.who.split(' ').indexOf(state.who) > -1;
      var okTier = state.tier === 'all' || tr.dataset.tier === state.tier;
      var vis = okWho && okTier;
      tr.classList.toggle('hidden', !vis);
      if (vis) shown++;
    });
    // A deck with nothing left to show is noise, not information.
    decks.forEach(function (d) {
      var any = d.querySelectorAll('tbody tr:not(.hidden)').length > 0;
      d.classList.toggle('hidden', !any);
    });
    countEl.textContent = shown + ' of ' + rows.length + ' duties';
  }

  document.querySelectorAll('.filters button').forEach(function (b) {
    b.addEventListener('click', function () {
      var f = b.dataset.f;
      state[f] = b.dataset.v;
      document.querySelectorAll('.filters button[data-f="' + f + '"]').forEach(function (o) {
        o.setAttribute('aria-pressed', String(o === b));
      });
      apply();
    });
  });

  apply();
})();
</script>
`;

const out = path.join(__dirname, 'roster.html');
fs.writeFileSync(out, html);
console.log('wrote', out, '—', total, 'duties');
crewLoad.forEach((c) => console.log(`  ${c.name}: ${c.load} merit/wk available vs ${c.target} target`));
