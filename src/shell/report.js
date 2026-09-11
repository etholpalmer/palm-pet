// Report derivations over the projection U4 produced.
//
// Shell, not a unit, for the reason A21 records: these are display derivations over already-
// persisted data. Wrong, they are redrawn; nothing in the log is corrupted. Only persisted,
// append-only semantics earn the specification pipeline.
//
// Pure, though — no DOM, no clock, no storage. `todayKey` is decided by the caller, the same
// injection U9's specification requires, so the same inputs give the same report on any device
// at any wall-clock time. That is what makes these testable, and what lets them be checked
// against tools/report.sql, which computes the same figures a different way.
//
// A2: every aggregation is on the `occurred_at` day key. `recorded_at` carries audit and
// ordering and never aggregation.
// B110: voided expenses are excluded everywhere below.

import { localDayKey } from '../U5.js';

const live = (expenses) => (expenses ?? []).filter((e) => e && e.voided === false);

// ISO day keys sort lexically, which is why the strings are compared directly rather than
// parsed. The UTC round trip is only used to COUNT days, never to decide which day a thing
// falls on — that is U5's job and it is done before we get here.
const asUTC = (k) => Date.UTC(+k.slice(0, 4), +k.slice(5, 7) - 1, +k.slice(8, 10));
const addDays = (k, n) => new Date(asUTC(k) + n * 86400000).toISOString().slice(0, 10);
export const daysBetween = (from, to) => Math.round((asUTC(to) - asUTC(from)) / 86400000);

// Every calendar day from the first recorded day to `todayKey` inclusive — INCLUDING the days
// with nothing on them. Those days are the point: they are what the daily rate divides by, and
// a series that omits them flatters by construction.
export function dailySeries(expenses, todayKey, zone) {
  const rows = live(expenses).map((e) => ({ day: localDayKey(e.occurred_at, zone), cents: e.amount_cents }));
  if (rows.length === 0) return [];
  let first = todayKey;
  for (const r of rows) if (r.day < first) first = r.day;

  const byDay = new Map();
  for (const r of rows) {
    const cur = byDay.get(r.day) ?? { cents: 0, n: 0 };
    byDay.set(r.day, { cents: cur.cents + r.cents, n: cur.n + 1 });
  }

  const out = [];
  const span = Math.max(0, daysBetween(first, todayKey));
  for (let i = 0; i <= span; i++) {
    const day = addDays(first, i);
    const hit = byDay.get(day) ?? { cents: 0, n: 0 };
    out.push({ day, cents: hit.cents, n: hit.n });
  }
  return out;
}

// The figure the capture screen shows, computed from the same series so the two cannot drift.
export function perDay(series) {
  if (series.length === 0) return null;
  const total = series.reduce((a, r) => a + r.cents, 0);
  return { cents: Math.round(total / series.length), total, days: series.length, first: series[0].day };
}

// How much of the elapsed time has an entry on it, and the current run ending today.
//
// Deliberately NOT the U6 coverage streak. U6 is deferred (A1) because its hazards are
// questions about a habit that does not exist yet — what "covered" means, whether grace is
// calendar or rolling, whether a bulk back-fill counts. None of that is decided here. These
// are two plain facts about the data: how many days carry an entry, and how many consecutive
// days ending today do. No grace, no repair, no "broken", nothing that turns red.
export function coverage(series) {
  if (series.length === 0) return { days: 0, withEntry: 0, run: 0 };
  const withEntry = series.filter((r) => r.n > 0).length;
  let run = 0;
  for (let i = series.length - 1; i >= 0; i--) {
    if (series[i].n === 0) break;
    run++;
  }
  return { days: series.length, withEntry, run };
}

// Totals for a field that may be absent, a string, or a list of strings. Absent is its own
// bucket and is never folded into a real value: "not recorded" is a fact about the log, and
// hiding it would make the breakdown look more complete than the data is.
function tally(expenses, pick, absentLabel) {
  const acc = new Map();
  for (const e of live(expenses)) {
    const keys = pick(e);
    const list = keys.length === 0 ? [absentLabel] : keys;
    // An expense carrying two tags counts once against each, so these columns sum to MORE
    // than the total. Stated rather than hidden; the caller prints the caveat.
    for (const k of list) {
      const cur = acc.get(k) ?? { cents: 0, n: 0 };
      acc.set(k, { cents: cur.cents + e.amount_cents, n: cur.n + 1 });
    }
  }
  return [...acc.entries()]
    .map(([key, v]) => ({ key, cents: v.cents, n: v.n }))
    .sort((a, b) => b.cents - a.cents || a.key.localeCompare(b.key));
}

export const byTag = (expenses) =>
  tally(expenses, (e) => (Array.isArray(e.tags) ? e.tags.filter((t) => typeof t === 'string' && t !== '') : []), 'untagged');

export const bySource = (expenses) =>
  tally(expenses, (e) => (typeof e.source_of_funds === 'string' && e.source_of_funds !== '' ? [e.source_of_funds] : []), 'not recorded');

// Everything the report view needs, from one pass over one projection.
export function report(expenses, todayKey, zone) {
  const series = dailySeries(expenses, todayKey, zone);
  return {
    series,
    rate: perDay(series),
    coverage: coverage(series),
    tags: byTag(expenses),
    sources: bySource(expenses),
    entries: live(expenses).length,
  };
}
