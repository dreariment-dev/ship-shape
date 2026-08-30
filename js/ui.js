// Rendering and event wiring. Everything is re-rendered from state on change —
// the app is far too small to justify anything cleverer.

const $ = (sel) => document.querySelector(sel);
const el = (html) => {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
};

let view = 'duty';
let card = null;        // the duty currently on the table
let seenThisSession = []; // swapped-away cards, so a swap actually changes it
let sprint = null;

// ── Helpers ─────────────────────────────────────────────────────────────────

const crew = () => crewById(state.activeCrew);
const isSimple = () => crew().mode === 'simple';
const deckName = (id) => state.deckNames[id] || deckById[id].name;
const crewName = (id) => state.crewNames[id] || crewById(id).name;

// Calibrated against what the crew actually sign up for, not against a
// spotless house. Everyone hitting their weekly target lands the ship near
// 43% integrity, so that has to read as a job well done — a dashboard that
// sits permanently red is the guilt trip this whole app exists to avoid.
// Raise these only if you also raise the weekly targets.
function band(pct) {
  return pct >= 0.4 ? 'good' : pct >= 0.25 ? 'warn' : 'bad';
}

const STATUS = { good: 'All systems nominal', warn: 'Needs attention', bad: 'Critical' };

function toast(msg, ms = 2200) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toast._t);
  // Re-trigger the pop animation on a toast that's already showing.
  t.style.animation = 'none';
  void t.offsetWidth;
  t.style.animation = '';
  toast._t = setTimeout(() => t.classList.add('hidden'), ms);
}

// ── HUD ─────────────────────────────────────────────────────────────────────

function renderHud() {
  const pct = shipIntegrity();
  const b = band(pct);
  $('#ship-pct').textContent = `${Math.round(pct * 100)}%`;
  // The bare percentage invites the wrong reading, so say what it means.
  $('#ship-status').textContent = STATUS[b];
  $('#ship-status').className = `status ${b}`;
  const bar = $('#ship-bar');
  bar.style.width = `${Math.max(2, pct * 100)}%`;
  bar.className = b;

  $('#crew-switch').innerHTML = '';
  CREW.forEach((c) => {
    const b = el(`
      <button class="${c.id === state.activeCrew ? 'on' : ''}" data-crew="${c.id}">
        <span class="av">${c.emoji}</span>
        <span>${crewName(c.id)}</span>
      </button>`);
    b.onclick = () => {
      state.activeCrew = c.id;
      save();
      card = null;
      seenThisSession = [];
      document.body.classList.toggle('simple', crewById(c.id).mode === 'simple');
      renderAll();
    };
    $('#crew-switch').append(b);
  });
}

// ── Duty card ───────────────────────────────────────────────────────────────

/** The accepted mission, replacing the draw until it's resolved. */
function renderMission(m) {
  const slot = $('#card-slot');
  const waiting = needsSignOff(state.activeCrew);
  const v = missionValue(m);
  const first = dutyById[m.duties[0]];

  const body = m.drill
    ? `<div class="deck">Drill cleared</div>
       <div class="icon">🚨</div>
       <h2>${m.duties.length} job${m.duties.length > 1 ? 's' : ''} done</h2>
       <div class="drill-list">${m.duties.map((id) => `<span>${dutyById[id].icon} ${dutyById[id].name}</span>`).join('')}</div>`
    : `<div class="deck">On mission · ${deckName(first.deck)}</div>
       <div class="icon">${first.icon}</div>
       <h2>${first.name}</h2>`;

  const c = el(`
    <div class="card onmission">
      ${body}
      <div class="meta">${
        isSimple()
          ? `<span class="chip pts">🤖 ${m.duties.length} droid${m.duties.length > 1 ? 's' : ''} waiting</span>`
          : `<span class="chip pts">${v.total} merit</span>${v.bonus ? `<span class="chip hazard">+${v.bonus} drill bonus</span>` : ''}`
      }</div>
      <div class="actions">
        ${waiting
          ? `<div class="await">🫡 Tell the ${crewName('adult')} when it's done<span>They'll sign it off</span></div>`
          : '<button class="btn" id="done">Mark it done</button>'}
        <div class="row"><button class="ghost" id="drop">Hand ${m.duties.length > 1 ? 'them' : 'it'} back</button></div>
      </div>
    </div>`);
  slot.append(c);

  if (!waiting) {
    c.querySelector('#done').onclick = () => {
      const got = signOff(state.activeCrew);
      toast(`+${got} merit banked`);
      card = null;
      renderAll();
    };
  }
  c.querySelector('#drop').onclick = () => {
    abandonMission(state.activeCrew);
    card = null;
    renderAll();
    toast('Handed back. No harm done.');
  };
}

/** Missions waiting on an adult — only ever shown to an adult. */
function renderSignOff() {
  const host = $('#signoff-slot');
  host.innerHTML = '';
  if (needsSignOff(state.activeCrew)) return;
  const pending = pendingSignOff();
  if (!pending.length) return;

  const box = el(`<div class="signoff"><h3>Waiting on you</h3></div>`);
  pending.forEach((p) => {
    const cw = crewById(p.crewId);
    const v = missionValue(p);
    const one = dutyById[p.duties[0]];
    const row = el(`
      <div class="so-row">
        <span class="em">${p.drill ? '🚨' : one.icon}</span>
        <div class="body">
          <div class="t">${p.drill ? `Drill · ${p.duties.length} jobs` : one.name}</div>
          <div class="s">${cw.emoji} ${crewName(p.crewId)} · ${
            p.drill
              ? p.duties.map((id) => dutyById[id].name).join(', ')
              : deckName(one.deck)
          } · ${v.total} merit</div>
        </div>
        <button class="ok">✓</button>
        <button class="no">✕</button>
      </div>`);
    row.querySelector('.ok').onclick = () => {
      const pts = signOff(p.crewId);
      toast(`✅ ${crewName(p.crewId)} earned ${pts} merit`);
      renderAll();
    };
    row.querySelector('.no').onclick = () => {
      sendBack(p.crewId);
      toast(`Sent back to ${crewName(p.crewId)}.`);
      renderAll();
    };
    box.append(row);
  });
  host.append(box);
}

function renderCard() {
  const slot = $('#card-slot');
  slot.innerHTML = '';

  const m = activeMission(state.activeCrew);
  if (m) return renderMission(m);

  // Swapping repeatedly shouldn't strand you on "nothing to do" — once the
  // excluded list has eaten the pool, let the earlier cards back in.
  if (!card) card = draw(state.activeCrew, seenThisSession);
  if (!card && seenThisSession.length) {
    seenThisSession = [];
    card = draw(state.activeCrew);
  }

  if (!card) {
    slot.append(el(`
      <div class="empty">
        <span class="big">🛸</span>
        <strong>All systems nominal.</strong><br>
        Nothing needs ${crewName(state.activeCrew)} right now. Come back tomorrow.
      </div>`));
    return;
  }

  const pts = value(card.id);
  const haz = hazardMult(card.id);
  const over = dueness(card.id);

  const chips = isSimple()
    ? `<span class="chip pts">🤖 Rescue a droid</span>`
    : [
        `<span class="chip pts">${pts} merit</span>`,
        `<span class="chip mins">~${card.mins} min</span>`,
        `<span class="chip tier">${TIERS[card.tier].label}</span>`,
        haz > 1 ? `<span class="chip hazard">⚠ Hazard pay ×${+haz.toFixed(2)}</span>` : '',
        over >= 2 ? `<span class="chip">Critical</span>` : '',
      ].join('');

  const c = el(`
    <div class="card">
      <div class="deck">${deckName(card.deck)}</div>
      <div class="icon">${card.icon}</div>
      <h2>${card.name}</h2>
      <div class="meta">${chips}</div>
      <div class="actions">
        <button class="btn" id="do">${isSimple() ? '👍 I\'ll do it!' : 'Accept mission'}</button>
        <div class="row">
          <button class="ghost" id="swap">🔄 ${isSimple() ? 'Another one' : 'Swap'}</button>
          <button class="ghost" id="later">🌙 Not today</button>
        </div>
      </div>
    </div>`);
  slot.append(c);

  c.querySelector('#do').onclick = () => {
    acceptMission(state.activeCrew, card.id);
    card = null;
    seenThisSession = [];
    renderAll();
  };
  c.querySelector('#swap').onclick = () => {
    swap(card.id);
    seenThisSession.push(card.id);
    card = null;
    renderAll();
  };
  c.querySelector('#later').onclick = () => {
    dismiss(card.id);
    card = null;
    renderAll();
    toast('Filed for tomorrow. Hazard pay rising.');
  };
}

/**
 * The personal-track strip: tonight's habits, ticked off in place. Kept below
 * the card and out of the draw so it reads as a separate thing to win.
 */
function renderTrack() {
  const host = $('#track-slot');
  host.innerHTML = '';
  const t = trackFor(state.activeCrew);
  if (!t) return;

  const duties = trackDuties(state.activeCrew);
  const got = trackCount(state.activeCrew);
  const hit = trackHit(state.activeCrew);

  const box = el(`
    <div class="track ${hit ? 'hit' : ''}">
      <div class="track-head">
        <span class="track-name">${t.icon} ${t.name}</span>
        <span class="track-score">${got} <span>/ ${t.goal} ${t.unit}</span></span>
      </div>
      <div class="track-when">${t.when}</div>
      <div class="track-rows"></div>
      ${hit ? `<div class="hit">🏅 ${t.name} complete for the week</div>` : ''}
    </div>`);

  const rows = box.querySelector('.track-rows');
  duties.forEach((d) => {
    const done = doneToday(d.id);
    const row = el(`
      <button class="track-row ${done ? 'done' : ''}" ${done ? 'disabled' : ''}>
        <span class="em">${d.icon}</span>
        <span class="t">${d.name}</span>
        <span class="tick">${done ? '✓' : '○'}</span>
      </button>`);
    if (!done) {
      row.onclick = () => {
        trackDone(d.id, state.activeCrew);
        const n = trackCount(state.activeCrew);
        toast(
          trackHit(state.activeCrew)
            ? `🏅 ${t.name} complete — ${n} ${t.unit} this week!`
            : `${t.icon} ${n} of ${t.goal} ${t.unit}`
        );
        renderAll();
      };
    }
    rows.append(row);
  });
  host.append(box);
}

function doComplete(duty, bonus = 1) {
  const pts = complete(duty.id, state.activeCrew, bonus);
  if (isSimple()) {
    const n = countSince(state.activeCrew, 0);
    const [em, nm] = DROIDS[(n - 1) % DROIDS.length];
    toast(`${em} You rescued ${nm}!`, 2600);
  } else {
    toast(`+${pts} merit — ${deckName(duty.deck)} restored`);
  }
  card = null;
  seenThisSession = [];
  renderAll();
}

// ── Ship view ───────────────────────────────────────────────────────────────

function deckRow(d, muted) {
  const pct = deckIntegrity(d.id);
  const mine = eligible(state.activeCrew).filter((x) => x.deck === d.id).length;
  const row = el(`
    <button class="deck ${muted ? 'muted' : ''}">
      <span class="em">${d.emoji}</span>
      <div class="body">
        <div class="name">${deckName(d.id)}</div>
        <div class="sub">${d.sub}${mine ? ` · ${mine} for you` : ''}</div>
        <div class="bar ${band(pct)}"><span style="width:${Math.max(2, pct * 100)}%"></span></div>
      </div>
      <div class="pct">${Math.round(pct * 100)}%<span class="chev">›</span></div>
    </button>`);
  row.onclick = () => openDeck(d.id);
  return row;
}

/** How a duty stands, in words rather than a number. */
function dutyState(id) {
  const due = dueness(id);
  if (due < 0.5) return { cls: 'fresh', text: 'Done recently' };
  if (due < 1) return { cls: 'soon', text: 'Due soon' };
  if (due < 2) return { cls: 'due', text: 'Due now' };
  return { cls: 'over', text: 'Overdue' };
}

/**
 * A room, opened deliberately. Shows what's actually doable here by whoever is
 * signed in, with everything else dimmed underneath so the integrity figure at
 * the top is explainable rather than mysterious.
 */
function openDeck(deckId) {
  const deck = deckById[deckId];
  const pct = deckIntegrity(deckId);
  const all = DUTIES.filter((d) => d.deck === deckId && !d.track);
  const canDo = eligible(state.activeCrew).map((d) => d.id);
  const mine = all.filter((d) => canDo.includes(d.id));
  const theirs = all.filter((d) => !canDo.includes(d.id));
  // One mission at a time is the point — the accepted card is the whole of
  // what you're being asked for.
  const busy = !!activeMission(state.activeCrew);

  const line = (d, actionable) => {
    const st = dutyState(d.id);
    const haz = hazardMult(d.id);
    let why = '';
    if (!actionable) {
      const owners = d.owners ?? deck.owners;
      if (!d.who.includes(state.activeCrew)) why = 'Not your job';
      else if (owners && !owners.includes(state.activeCrew))
        why = `Held for ${owners.map(crewName).join(' & ')}`;
      else why = 'Put off until tomorrow';
    }
    return `
      <div class="dutyline ${actionable ? '' : 'off'}" data-id="${d.id}">
        <span class="em">${d.icon}</span>
        <div class="body">
          <div class="t">${d.name}</div>
          <div class="s"><span class="st ${st.cls}">${st.text}</span>${
            actionable && !isSimple() ? ` · ${value(d.id)} merit` : ''
          }${haz > 1 && actionable ? ` · ⚠ ×${+haz.toFixed(2)}` : ''}${why ? ` · ${why}` : ''}</div>
        </div>
        ${actionable ? `<button class="do"${busy ? ' disabled' : ''}>Take</button>` : ''}
      </div>`;
  };

  const ov = el(`
    <div class="overlay">
      <div class="sprint-inner">
        <div class="sprint-head">
          <h2>${deck.emoji} ${deckName(deckId)}</h2>
          <div class="clock" style="font-size:22px;color:var(--${band(pct) === 'good' ? 'green' : band(pct) === 'warn' ? 'amber' : 'red'})">${Math.round(pct * 100)}%</div>
        </div>
        <p class="sprint-sub">${deck.sub} · ${STATUS[band(pct)]}</p>
        <div class="bar ${band(pct)}" style="margin-bottom:16px"><span style="width:${Math.max(2, pct * 100)}%"></span></div>

        ${busy ? '<p class="sprint-sub" style="color:var(--amber)">You\'re already on a mission — finish or hand it back first.</p>' : ''}

        ${mine.length
          ? `<h3 class="seg">Yours to do here</h3>${mine.map((d) => line(d, true)).join('')}`
          : `<div class="empty" style="padding:24px 8px"><span class="big">✅</span>Nothing here for you right now.</div>`}

        ${theirs.length && !isSimple()
          ? `<h3 class="seg">Not yours right now</h3>${theirs.map((d) => line(d, false)).join('')}`
          : ''}

        <button class="ghost wide" id="close" style="margin-top:20px">Close</button>
      </div>
    </div>`);

  ov.querySelectorAll('.dutyline .do').forEach((b) => {
    b.onclick = () => {
      const id = b.closest('.dutyline').dataset.id;
      acceptMission(state.activeCrew, id);
      ov.remove();
      switchView('duty');
      toast(`🎯 Mission accepted — ${dutyById[id].name}`);
    };
  });
  ov.querySelector('#close').onclick = () => ov.remove();
  document.body.append(ov);
}

const worstFirst = (a, b) => deckIntegrity(a.id) - deckIntegrity(b.id);

function renderShip() {
  const wrap = $('#deck-list');
  wrap.innerHTML = '';
  const mine = decksFor(state.activeCrew);

  // Crew with the run of the ship get the full zone breakdown. Anyone on a
  // restricted rota gets their own decks first and the rest greyed behind
  // them — still one shared ship, but no wall of jobs they can't take.
  if (mine.length === DECKS.length) {
    Object.entries(ZONES).forEach(([zone, title]) => {
      const decks = DECKS.filter((d) => d.zone === zone);
      if (!decks.length) return;
      wrap.append(el(`<div class="zone-title">${title}</div>`));
      decks.slice().sort(worstFirst).forEach((d) => wrap.append(deckRow(d, false)));
    });
    return;
  }

  const rest = DECKS.filter((d) => !mine.includes(d));
  wrap.append(el('<div class="zone-title">Your decks</div>'));
  mine.slice().sort(worstFirst).forEach((d) => wrap.append(deckRow(d, false)));
  wrap.append(el('<div class="zone-title">Rest of the ship</div>'));
  rest.slice().sort(worstFirst).forEach((d) => wrap.append(deckRow(d, true)));
}

// ── Crew view ───────────────────────────────────────────────────────────────

const fmtDate = (ts) =>
  new Date(ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

/**
 * Past weeks, so a good run is visible rather than evaporating every Friday.
 * A won week is measured by whatever that crew member is actually chasing —
 * droids for the Cadet, merit for everyone else.
 */
function historyPanel(crewId) {
  const weeks = pastWeeks(8);
  const all = allTime();
  const me = all.crew[crewId];
  const c = crewById(crewId);
  const t = trackFor(crewId);

  const rows = weeks.length
    ? weeks
        .map((w) => {
          const r = w.crew[crewId];
          const won = c.goal ? r.hitGoal : r.hitTarget;
          const score = c.goal ? `${r.duties} droids` : `${r.merit}`;
          return `<div class="hrow">
            <span class="wk">${fmtDate(w.start)}</span>
            <span class="sc">${score}</span>
            ${t ? `<span class="tk">${t.icon} ${r.track}</span>` : '<span class="tk"></span>'}
            <span class="wn">${won ? '🏅' : '—'}</span>
          </div>`;
        })
        .join('')
    : '<div class="sub-num">No completed weeks yet — the first turns over on Friday morning.</div>';

  return el(`
    <div class="panel">
      <h3>Past weeks</h3>
      <div class="hgrid">
        <div class="hrow head">
          <span class="wk">Week from</span>
          <span class="sc">${c.goal ? 'Droids' : 'Merit'}</span>
          <span class="tk">${t ? t.unit : ''}</span>
          <span class="wn">Won</span>
        </div>
        ${rows}
      </div>
      <div class="sub-num" style="margin-top:12px">
        All time: <strong style="color:var(--text)">${me.merit}</strong> merit over
        <strong style="color:var(--text)">${me.duties}</strong> duties${
          t ? `, <strong style="color:var(--text)">${me.track}</strong> ${t.unit}` : ''
        } · <strong style="color:var(--text)">${me.weeksWon}</strong> week${me.weeksWon === 1 ? '' : 's'} won
      </div>
    </div>`);
}

/** The household's own running total, shown to whoever is signed in. */
function householdPanel() {
  const all = allTime();
  return el(`
    <div class="panel">
      <h3>The whole crew</h3>
      <div class="big-num">${all.total}</div>
      <div class="sub-num">merit earned between you, all time${
        all.weeks ? ` · ${all.weeks} week${all.weeks === 1 ? '' : 's'} on the books` : ''
      }</div>
      ${CREW.map((c) => {
        const r = all.crew[c.id];
        const share = all.total ? Math.round((r.merit / all.total) * 100) : 0;
        return `<div style="margin-top:10px">
          <div class="sub-num">${c.emoji} ${crewName(c.id)} — ${r.merit} merit · ${r.weeksWon} won</div>
          <div class="bar good"><span style="width:${share}%"></span></div>
        </div>`;
      }).join('')}
    </div>`);
}

/** The personal track as a peer of the chore reward, not a footnote to it. */
function trackPanel(crewId) {
  const t = trackFor(crewId);
  if (!t) return null;
  const got = trackCount(crewId);
  const pct = Math.min(1, got / t.goal);
  const best = Math.max(0, trackCount(crewId, 0)); // lifetime, for the long view
  return el(`
    <div class="panel">
      <h3>${t.icon} ${t.name}</h3>
      <div class="big-num">${got} <span style="font-size:16px;color:var(--dim)">/ ${t.goal}</span></div>
      <div class="sub-num">${t.unit} this week — kept separate from merit</div>
      <div class="bar ${band(pct)}"><span style="width:${pct * 100}%"></span></div>
      ${trackHit(crewId) ? `<div class="hit">🏅 ${t.name} complete</div>` : ''}
      <div class="sub-num" style="margin-top:8px">${best} ${t.unit} all told</div>
    </div>`);
}

/** The decks you're answerable for — responsibility you can see is responsibility. */
function quartersPanel(crewId) {
  const mine = DECKS.filter((k) => k.owners?.includes(crewId));
  if (!mine.length) return null;
  const rows = mine
    .map((deck) => {
      const pct = deckIntegrity(deck.id);
      const shared = deck.owners.length > 1;
      return `<div style="margin-bottom:12px">
        <div class="rank-name" style="font-size:17px">${deck.emoji} ${deckName(deck.id)}${shared ? ' <span style="font-size:12px;color:var(--dim);font-weight:400">· shared</span>' : ''}</div>
        <div class="bar ${band(pct)}" style="margin-top:8px"><span style="width:${Math.max(2, pct * 100)}%"></span></div>
        <div class="rank-next">${Math.round(pct * 100)}% — ${STATUS[band(pct)]}</div>
      </div>`;
    })
    .join('');
  return el(`
    <div class="panel">
      <h3>Yours to look after</h3>
      ${rows}
      <div class="sub-num">Nobody else is offered these until you've had your chance at them.</div>
    </div>`);
}

function renderCrew() {
  const wrap = $('#crew-panel');
  wrap.innerHTML = '';
  const id = state.activeCrew;
  const week = weekTotal(id);
  const target = crew().target;
  const pctToTarget = Math.min(1, week / target);

  if (isSimple()) {
    const done = countSince(id, weekStart());
    const goal = crew().goal;
    wrap.append(el(`
      <div class="panel">
        <h3>This week</h3>
        <div class="big-num">${done} / ${goal}</div>
        <div class="sub-num">droids rescued</div>
        <div class="bar ${band(done / goal)}"><span style="width:${Math.min(100, (done / goal) * 100)}%"></span></div>
        ${done >= goal ? '<div class="hit">🏅 Mission complete!</div>' : ''}
      </div>`));

    const tp = trackPanel(id);
    if (tp) wrap.append(tp);

    const q = quartersPanel(id);
    if (q) wrap.append(q);

    // The hangar IS the weekly goal made visible — one slot per droid needed,
    // so filling it by Sunday is the whole instruction. It empties each week;
    // the old lifetime version filled up for good inside a fortnight and
    // stopped being a reward at all.
    const slots = DROIDS.slice(0, goal);
    const crews = Math.floor(countSince(id, 0) / goal);
    wrap.append(el(`
      <div class="panel">
        <h3>Hangar bay</h3>
        <div class="hangar">
          ${slots.map(([em, nm], i) => `<div class="${i < done ? '' : 'locked'}" title="${nm}">${em}</div>`).join('')}
        </div>
        <div class="sub-num">${Math.min(done, goal)} of ${goal} aboard this week${crews ? ` · ${crews} crew${crews > 1 ? 's' : ''} rescued so far` : ''}</div>
      </div>`));

    wrap.append(historyPanel(id));
    return;
  }

  const r = rankOf(id);
  wrap.append(el(`
    <div class="panel">
      <h3>Weekly mission</h3>
      <div class="big-num">${week} <span style="font-size:16px;color:var(--dim)">/ ${target}</span></div>
      <div class="sub-num">merit earned since Monday</div>
      <div class="bar ${band(pctToTarget)}"><span style="width:${pctToTarget * 100}%"></span></div>
      ${targetHit(id) ? '<div class="hit">🏅 Target met — award earned</div>' : ''}
    </div>`));

  const tp = trackPanel(id);
  if (tp) wrap.append(tp);

  const q = quartersPanel(id);
  if (q) wrap.append(q);

  wrap.append(el(`
    <div class="panel">
      <h3>Rank</h3>
      <div class="rank-name">${r.current.name}</div>
      ${r.next
        ? `<div class="bar good" style="margin-top:10px"><span style="width:${r.progress * 100}%"></span></div>
           <div class="rank-next">${Math.round((1 - r.progress) * 100)}% to ${r.next.name}</div>`
        : '<div class="rank-next">Top of the ladder. Nothing left to prove.</div>'}
    </div>`));

  wrap.append(el(`
    <div class="panel">
      <h3>Service record</h3>
      <div class="sub-num">This month: <strong style="color:var(--text)">${monthTotal(id)}</strong> merit</div>
      <div class="sub-num">Lifetime: <strong style="color:var(--text)">${lifetime(id)}</strong> merit across ${countSince(id, 0)} duties</div>
    </div>`));

  // Everyone who hit their own number this week, so nobody is measured
  // against a bigger sibling.
  wrap.append(el(`
    <div class="panel">
      <h3>Crew standing</h3>
      ${CREW.map((c) => {
        const w = weekTotal(c.id);
        const p = Math.min(1, w / c.target);
        return `<div style="margin-bottom:10px">
          <div class="sub-num">${c.emoji} ${crewName(c.id)} — ${w} / ${c.target} ${targetHit(c.id) ? '🏅' : ''}</div>
          <div class="bar ${band(p)}"><span style="width:${p * 100}%"></span></div>
        </div>`;
      }).join('')}
    </div>`));

  wrap.append(historyPanel(id));
  wrap.append(householdPanel());
}

// ── Red alert ───────────────────────────────────────────────────────────────

function startSprint() {
  const tasks = drawSprint(state.activeCrew, 3);
  if (!tasks.length) return toast('Nothing to drill on — ship is clean.');
  sprint = { tasks, done: new Set(), endsAt: Date.now() + 15 * 60 * 1000, crew: state.activeCrew };
  $('#sprint').classList.remove('hidden');
  renderSprint();
  sprint.timer = setInterval(tickSprint, 500);
}

function tickSprint() {
  if (!sprint) return;
  const left = Math.max(0, sprint.endsAt - Date.now());
  const s = Math.ceil(left / 1000);
  const clock = $('#sprint-clock');
  clock.textContent = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  clock.classList.toggle('low', s <= 120);
  if (left === 0) {
    endSprint();
    toast('⏱ Drill over. Merit for everything you cleared is banked.');
  }
}

function renderSprint() {
  const list = $('#sprint-list');
  list.innerHTML = '';
  sprint.tasks.forEach((t) => {
    const done = sprint.done.has(t.id);
    const row = el(`
      <div class="sprint-task ${done ? 'done' : ''}">
        <span class="em">${t.icon}</span>
        <div class="body">
          <div class="t">${t.name}</div>
          <div class="d">${deckName(t.deck)}${isSimple() ? '' : ` · ${value(t.id)} merit`}</div>
        </div>
        <button aria-label="Mark done">${done ? '✓' : '○'}</button>
      </div>`);
    if (!done) {
      row.querySelector('button').onclick = () => {
        // An adult's ticks land immediately; a child's are held and banked as
        // one batch when the drill ends, so the whole thing gets signed off.
        if (!needsSignOff(sprint.crew)) complete(t.id, sprint.crew);
        sprint.done.add(t.id);
        renderSprint();
        renderHud();
        if (sprint.done.size === sprint.tasks.length) finishSprint();
      };
    }
    list.append(row);
  });
}

function finishSprint() {
  const full = sprint.done.size === sprint.tasks.length;
  if (needsSignOff(sprint.crew)) return endSprint();
  const earned = sprint.tasks.reduce((a, t) => a + dutyById[t.id].pts, 0);
  const bonus = Math.round(earned * 0.5);
  state.log.push({ t: Date.now(), crew: sprint.crew, duty: 'bonus:redalert', pts: bonus });
  save();
  endSprint();
  if (full) toast(`🎉 Drill cleared! +${bonus} bonus merit`, 3200);
}

/**
 * Ends the drill. A child's cleared jobs are banked as one mission for an
 * adult to approve — nothing they ticked is scored until it's signed.
 */
function endSprint() {
  if (sprint?.timer) clearInterval(sprint.timer);
  const s = sprint;
  sprint = null;
  $('#sprint').classList.add('hidden');

  if (s && needsSignOff(s.crew) && s.done.size) {
    acceptDrill(s.crew, [...s.done], s.done.size === s.tasks.length);
    toast(`🫡 ${s.done.size} job${s.done.size > 1 ? 's' : ''} sent to the ${crewName('adult')} to sign off`, 3200);
  }
  card = null;
  renderAll();
}

// ── Settings ────────────────────────────────────────────────────────────────

const RESETS = [
  {
    id: 'due',
    icon: '🧨',
    label: 'Nothing done',
    hint: 'Every duty overdue, ship at 0% — good for having a play',
    confirm: 'Every duty is marked undone and all merit is wiped.',
    done: '🧨 Nothing done. Everything is on the table.',
  },
  {
    id: 'fresh',
    icon: '🚀',
    label: 'New voyage',
    hint: 'Duties staggered as they are on a fresh install',
    confirm: 'The ship goes back to how it looked on day one and all merit is wiped.',
    done: '🚀 New voyage. Good luck out there.',
  },
  {
    id: 'clean',
    icon: '✨',
    label: 'Everything done',
    hint: 'Whole ship spotless at 100%',
    confirm: 'Every duty is marked just-done and all merit is wiped.',
    done: '✨ Spotless. It will not last.',
  },
  {
    id: 'scores',
    icon: '🎖️',
    label: 'Wipe merit only',
    hint: 'Leaves the ship as it is, resets scores and droids to zero',
    confirm: 'All merit, ranks and droids go to zero. The ship itself is untouched.',
    done: '🎖️ Merit wiped. The ship is as you left it.',
  },
];

function openSettings() {
  const rows = [
    '<h3 style="margin:18px 0 8px;font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:var(--dim)">Crew</h3>',
    ...CREW.map((c) => `<button class="ghost wide" data-kind="crew" data-id="${c.id}">${c.emoji} ${crewName(c.id)}</button>`),
    '<h3 style="margin:18px 0 8px;font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:var(--dim)">Decks</h3>',
    ...DECKS.map((d) => `<button class="ghost wide" data-kind="deck" data-id="${d.id}">${d.emoji} ${deckName(d.id)}</button>`),
  ].join('');

  const ov = el(`
    <div class="overlay">
      <div class="sprint-inner">
        <div class="sprint-head"><h2>⚙ Ship's log</h2></div>
        <p class="sprint-sub">Tap a name to rename it. Make the quarters theirs — it matters more than you'd think.</p>
        ${rows}

        <h3 style="margin:22px 0 8px;font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:var(--dim)">Reset</h3>
        <p class="sprint-sub" style="margin-top:0">Names you've set are always kept. Everything else goes.</p>
        ${RESETS.map(
          (r) => `<button class="ghost wide danger" data-reset="${r.id}">${r.icon} ${r.label}<span class="hint">${r.hint}</span></button>`
        ).join('')}

        <button class="ghost wide" id="close" style="margin-top:22px">Close</button>
      </div>
    </div>`);

  ov.querySelectorAll('[data-reset]').forEach((b) => {
    b.onclick = () => {
      const r = RESETS.find((x) => x.id === b.dataset.reset);
      if (!confirm(`${r.label}\n\n${r.confirm}\n\nThis can't be undone.`)) return;
      resetShip(r.id);
      card = null;
      seenThisSession = [];
      ov.remove();
      switchView('duty');
      toast(r.done, 3000);
    };
  });

  ov.querySelectorAll('[data-kind]').forEach((b) => {
    b.onclick = () => {
      const { kind, id } = b.dataset;
      const store = kind === 'crew' ? state.crewNames : state.deckNames;
      const next = prompt('New name', store[id]);
      if (next && next.trim()) {
        store[id] = next.trim();
        save();
        ov.remove();
        openSettings();
        renderAll();
      }
    };
  });
  ov.querySelector('#close').onclick = () => ov.remove();
  document.body.append(ov);
}

// ── Boot ────────────────────────────────────────────────────────────────────

function renderAll() {
  renderHud();
  if (view === 'duty') {
    renderSignOff();
    renderCard();
    renderTrack();
  }
  if (view === 'ship') renderShip();
  if (view === 'crew') renderCrew();
}

function switchView(next) {
  view = next;
  document.querySelectorAll('.tabs button').forEach((b) =>
    b.classList.toggle('active', b.dataset.view === next)
  );
  ['duty', 'ship', 'crew'].forEach((v) =>
    $(`#view-${v}`).classList.toggle('hidden', v !== next)
  );
  renderAll();
}

function init() {
  load();
  document.body.classList.toggle('simple', isSimple());

  document.querySelectorAll('.tabs button').forEach((b) => {
    b.onclick = () => switchView(b.dataset.view);
  });
  $('#btn-alert').onclick = () => {
    if (activeMission(state.activeCrew))
      return toast('Finish or hand back your current mission first.');
    startSprint();
  };
  $('#sprint-end').onclick = endSprint;
  $('#btn-settings').onclick = openSettings;
  $('#btn-rescue').onclick = () => {
    if (activeMission(state.activeCrew))
      return toast('Finish or hand back your current mission first.');
    const d = rescue(state.activeCrew);
    if (!d) return toast('Nothing small left. Ship is in good order.');
    card = d;
    renderCard();
    toast(`Smallest job aboard — ${d.mins} min. Just this one.`);
  };

  // Time passes while the app sits in the background; decay should be visible
  // when it comes back rather than frozen at whatever it was on close.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) renderAll();
  });

  renderAll();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});

    // A new worker taking over means new files are cached. Reload once so the
    // crew get the update without anyone reinstalling anything — the guard
    // stops the classic refresh loop if the worker changes again mid-load.
    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloading) return;
      reloading = true;
      location.reload();
    });
  }
}

init();
