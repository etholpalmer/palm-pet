// Wiring. Every behavioural decision below already lives in a verified unit; this file
// carries values between them and touches the DOM. Where it makes a choice of its own, the
// choice is a shell fact the units are given, and it is named.

import { REST_STATE, pressAll }  from '../U10.js';
import { parseCents }            from '../U1.js';
import { buildEvent }            from '../U2.js';
import { foldExpenses }          from '../U4.js';
import { localDayKey }           from '../U5.js';
import { exportNdjson }          from '../U7.js';
import { todayList }             from '../U9.js';
import { buildAmend }            from '../U11.js';
import { formatCents }           from '../U12.js';
import { tagVocabulary }         from '../U13.js';
import { ZONE, SEED_TAGS, EXPORT_STAMP_KEY } from './config.js';
import { report as buildReport } from './report.js';
import * as db   from './db.js';
import * as geo  from './geo.js';

const $ = (id) => document.getElementById(id);

// A1: no router. There is one screen; `keys` is the whole of the app's state, and it is
// deliberately not persisted — cold start goes to the bare keypad with nothing restored.
let keys = [];
let projection = { expenses: [], skipped: {} };
let sheetFor = null;   // the expense the back-fill sheet is open on, or null

// ---------------------------------------------------------------- capture

function digits() { return pressAll(keys, REST_STATE); }

function renderAmount() {
  const s = digits();
  // B3: rest is the empty string; B116/B12: it displays as "0.00". The parser is never
  // asked to interpret rest — the shell maps it directly, which is the interception the
  // U1 checker flagged as unowned. It is owned here.
  const cents = s === REST_STATE ? 0 : parseCents(s);
  $('amount').textContent = formatCents(cents);
  // B8: save is disabled while the amount is zero.
  $('save').disabled = cents === 0;
  return cents;
}

function key(k) { keys.push(k); renderAmount(); }

async function save() {
  const cents = renderAmount();
  if (cents === 0) return;                     // B8, belt and braces

  // B21: recorded_at is sampled at the save tap — not first key-down, not commit.
  const now = new Date().toISOString();
  const event = buildEvent({
    event_type: 'ExpenseRecorded',
    event_id: crypto.randomUUID(),             // B18
    recorded_at: now,
    amount_cents: cents,
    geo: geo.pinForSave(),                     // B27: absent key when there is no pin
  });

  await db.append(event);
  keys = [];                                   // CHECKLIST: "returns to zero", no prompt
  renderAmount();
  flash();
  await refresh();
}

function flash() {
  const el = $('confirm');
  el.classList.remove('on');
  void el.offsetWidth;                         // restart the animation
  el.classList.add('on');
}

// ---------------------------------------------------------------- today

async function refresh() {
  const events = await db.allEvents();
  projection = foldExpenses(events);
  const todayKey = localDayKey(new Date().toISOString(), ZONE);
  const { items, total_cents } = todayList(projection.expenses, todayKey, ZONE);

  $('total').textContent = formatCents(Math.max(0, total_cents));  // B114: clamp at render
  $('day').textContent = todayKey;

  // A21: the reframing. Quiet, secondary to today's number, and absent until there is
  // anything to average — an average over one partial day is noise presented as a rate.
  const rate = buildReport(projection.expenses, todayKey, ZONE).rate;
  const rateEl = $('rate');
  rateEl.hidden = rate === null;
  if (rate) {
    rateEl.querySelector('.rate-figure').textContent = formatCents(Math.max(0, rate.cents));
    rateEl.querySelector('.rate-span').textContent =
      `over ${rate.days} day${rate.days === 1 ? '' : 's'}, since ${rate.first}`;
  }

  const list = $('list');
  list.replaceChildren(...items.map((e) => {
    const li = document.createElement('li');
    li.className = 'entry';
    li.tabIndex = 0;
    li.dataset.id = e.expense_id;
    const amt = document.createElement('span');
    amt.className = 'entry-amount';
    amt.textContent = formatCents(e.amount_cents);
    const meta = document.createElement('span');
    meta.className = 'entry-meta';
    meta.textContent = e.note || (e.tags?.length ? e.tags.join(' · ') : 'no details');
    li.append(amt, meta);
    li.addEventListener('click', () => openSheet(e));
    li.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') openSheet(e); });
    return li;
  }));
  $('empty').hidden = items.length > 0;
  // A20: offered only while today is empty. Once a zero is logged the row disappears, so a
  // second tap is structurally impossible rather than guarded against.
  $('nospend').hidden = items.length > 0;
}

// ---------------------------------------------------------------- reports

/**
 * A21's spend-per-day and the report view are one derivation, in src/shell/report.js. It used
 * to be a second copy here; two implementations of one figure drift, and the drift shows the
 * user two different numbers for the same thing on two screens of the same app.
 *
 * The denominator is every calendar day from the first recorded day to today inclusive, days
 * with no entry included. Voided expenses are excluded (B110) and day keys come from U5 over
 * occurred_at (A2) — these are reports, and reports aggregate on the occurred_at day key.
 */
function renderReport() {
  const todayKey = localDayKey(new Date().toISOString(), ZONE);
  const r = buildReport(projection.expenses, todayKey, ZONE);

  $('report-empty').hidden = r.series.length > 0;
  $('report-main').hidden = r.series.length === 0;
  if (r.series.length === 0) return;

  $('r-rate').textContent = formatCents(Math.max(0, r.rate.cents));
  $('r-span').textContent =
    `${formatCents(Math.max(0, r.rate.total))} over ${r.rate.days} day${r.rate.days === 1 ? '' : 's'}, since ${r.rate.first}`;

  // Two plain facts, not the U6 streak. U6 is deferred (A1) because its rules are questions
  // about a habit that does not exist yet; nothing here decides them, and nothing turns red.
  const c = r.coverage;
  // Phrased without a verb, so it reads correctly at one day and at fifty. "1 of 1 days have
  // an entry" was the first version.
  $('r-cover').innerHTML =
    `<b>${c.withEntry}</b> of <b>${c.days}</b> days recorded`
    + (c.run > 1 ? ` · <b>${c.run}</b> in a row up to today` : '');

  // The strip. A day with nothing is a hairline rather than a gap: the empty days are what
  // the rate divides by, and a chart that drops them flatters by construction.
  const peak = Math.max(...r.series.map((d) => d.cents), 1);
  $('r-strip').replaceChildren(...r.series.map((d, i) => {
    const bar = document.createElement('i');
    // Today is marked whether or not it has an entry. An empty today is the day most worth
    // finding on this strip, and the first version left it indistinguishable from any other
    // blank day because the nil branch came first.
    // Three states, not two. A recorded zero — the A20 "No spend today" — is a day you turned
    // up for, and it is not the same fact as a day with nothing on it. Both are short marks, so
    // the first version drew them identically and lost the distinction the feature exists for.
    const cls = [];
    if (d.n === 0) cls.push('nil');
    else if (d.cents === 0) cls.push('zero');
    if (i === r.series.length - 1) cls.push('today');
    bar.className = cls.join(' ');
    bar.style.height = `${Math.max(2, Math.round((d.cents / peak) * 128))}px`;
    bar.title = `${d.day} — ${formatCents(d.cents)}`
      + (d.n === 0 ? ' (nothing recorded)' : d.cents === 0 ? ' (no spend, recorded)' : '');
    return bar;
  }));
  const zeros = r.series.filter((d) => d.n > 0 && d.cents === 0).length;
  $('r-strip-cap').textContent =
    `${r.series.length} days, ${r.series[0].day} to ${r.series[r.series.length - 1].day}. `
    + 'A faint mark is a day with nothing recorded'
    + (zeros > 0 ? `; a bright one is a recorded no-spend day (${zeros}).` : '.');
  requestAnimationFrame(() => { const w = $('r-strip').parentElement; w.scrollLeft = w.scrollWidth; });

  const rows = (el, list, absent) => {
    el.replaceChildren(...list.map((x) => {
      const li = document.createElement('li');
      const k = document.createElement('span');
      k.className = x.key === absent ? 'k absent' : 'k';
      k.textContent = x.key;
      const n = document.createElement('span');
      n.className = 'n';
      n.textContent = `${x.n}`;
      const v = document.createElement('span');
      v.className = 'v';
      v.textContent = formatCents(Math.max(0, x.cents));
      li.append(k, n, v);
      return li;
    }));
  };
  // Shown only when the log carries the field. A breakdown whose every row says "not
  // recorded" tells the user about the capture design, not about their spending.
  const realTags = r.tags.filter((x) => x.key !== 'untagged');
  $('r-tags-sec').hidden = realTags.length === 0;
  rows($('r-tags'), r.tags, 'untagged');
  const realSources = r.sources.filter((x) => x.key !== 'not recorded');
  $('r-sources-sec').hidden = realSources.length === 0;
  rows($('r-sources'), r.sources, 'not recorded');
}

async function noSpend() {
  await db.append(buildEvent({
    event_type: 'ExpenseRecorded',
    event_id: crypto.randomUUID(),
    recorded_at: new Date().toISOString(),
    amount_cents: 0,
    geo: geo.pinForSave(),
  }));
  flash();
  await refresh();
}

// ---------------------------------------------------------------- back-fill

// U13 B3 / U11 B7 fold a tag by trim-then-lowercase, and that is the identity two tags are
// compared by. This is a third copy of that rule and it is deliberately for DISPLAY ONLY —
// deciding which chips look applied. U11 does the authoritative fold when the sheet is saved,
// so if this ever drifts the highlight is wrong and the stored data is still right.
const foldTag = (t) => String(t).trim().toLowerCase();
const sheetTags = () => $('f-tags').value.split(',').map((s) => s.trim()).filter(Boolean);

// Which chips are currently applied. Without this a toggle is guesswork: the user has to read
// the text field to know what a tap will do.
function syncChips() {
  const applied = new Set(sheetTags().map(foldTag));
  for (const b of $('f-vocab').children) {
    const on = applied.has(b.dataset.tag);
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', String(on));
  }
}

function openSheet(expense) {
  sheetFor = expense;
  const local = new Intl.DateTimeFormat('en-CA', {
    timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date(expense.occurred_at));
  const part = (t) => local.find((p) => p.type === t).value;

  $('f-date').value = `${part('year')}-${part('month')}-${part('day')}`;
  $('f-time').value = `${part('hour') === '24' ? '00' : part('hour')}:${part('minute')}`;
  $('f-amount').value = formatCents(expense.amount_cents);
  $('f-note').value = expense.note ?? '';
  $('f-tags').value = (expense.tags ?? []).join(', ');
  $('f-source').value = expense.source_of_funds ?? '';

  // B120/D9: tap targets from the log's own vocabulary, unioned with the seeds.
  const vocab = tagVocabulary(projection.expenses, SEED_TAGS);
  $('f-vocab').replaceChildren(...vocab.map((tag) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip';
    b.dataset.tag = tag;
    b.textContent = tag;
    b.setAttribute('aria-pressed', 'false');
    // A chip toggles. Tapping an applied tag removes it, which is what a chip looks like it
    // does; the first version's second tap was a dead tap with no feedback of any kind.
    b.addEventListener('click', () => {
      const cur = sheetTags();
      const at = cur.findIndex((t) => foldTag(t) === tag);
      if (at === -1) cur.push(tag); else cur.splice(at, 1);
      $('f-tags').value = cur.join(', ');
      syncChips();
    });
    return b;
  }));
  syncChips();
  $('sheet').showModal();
}

async function saveSheet(ev) {
  ev.preventDefault();
  const patch = buildAmend({
    current: sheetFor,
    sheet: {
      amount_cents: parseCents($('f-amount').value.replace('.', '')),
      date: $('f-date').value,
      time: $('f-time').value,
      note: $('f-note').value,
      tags: $('f-tags').value,
      source_of_funds: $('f-source').value,
    },
    zone: ZONE,
  });

  // B33: nothing changed means no event is appended. The sheet just closes.
  if (patch !== null) {
    await db.append(buildEvent({
      event_type: 'ExpenseAmended',
      event_id: crypto.randomUUID(),
      recorded_at: new Date().toISOString(),
      target_id: sheetFor.expense_id,          // B26: target_id, and it is the Recorded id
      patch,
    }));
  }
  $('sheet').close();
  sheetFor = null;
  await refresh();
}

async function voidExpense() {
  // A5: there is no ExpenseUnvoided and hard delete is CUT, so this is irreversible.
  // The two-tap confirm is the mitigation A5 records.
  if (!confirm('Void this entry? This cannot be undone.')) return;
  await db.append(buildEvent({
    event_type: 'ExpenseVoided',
    event_id: crypto.randomUUID(),
    recorded_at: new Date().toISOString(),
    target_id: sheetFor.expense_id,
  }));
  $('sheet').close();
  sheetFor = null;
  await refresh();
}

// ---------------------------------------------------------------- export

async function exportLog() {
  const text = exportNdjson(await db.allEvents());   // B93: always full, never incremental
  const url = URL.createObjectURL(new Blob([text], { type: 'application/x-ndjson' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `palm-pet-${new Date().toISOString().slice(0, 10)}.ndjson`;
  a.click();
  URL.revokeObjectURL(url);
  // B94: the page cannot see whether iOS saved it, so the stamp says what is true —
  // a file was prepared. The label reads "last export prepared", not "last backed up".
  localStorage.setItem(EXPORT_STAMP_KEY, new Date().toISOString());
  renderStamp();
}

function renderStamp() {
  const at = localStorage.getItem(EXPORT_STAMP_KEY);
  $('stamp').textContent = at
    ? `last export prepared ${localDayKey(at, ZONE)}`
    : 'no export prepared yet';
}

// ---------------------------------------------------------------- boot

for (const el of document.querySelectorAll('[data-key]')) {
  el.addEventListener('click', () => key(el.dataset.key));
}
$('save').addEventListener('click', save);
$('export').addEventListener('click', exportLog);
$('reports').addEventListener('click', () => { renderReport(); $('report').showModal(); });
$('report-close').addEventListener('click', () => $('report').close());
$('nospend').addEventListener('click', noSpend);
$('sheet-form').addEventListener('submit', saveSheet);
$('sheet-cancel').addEventListener('click', () => { $('sheet').close(); sheetFor = null; });
// Typing is the other way the field changes, and the chips have to follow it or they lie.
$('f-tags').addEventListener('input', syncChips);
$('sheet-void').addEventListener('click', voidExpense);

renderAmount();
renderStamp();
geo.warm();
db.requestPersistence();
await refresh();

if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
