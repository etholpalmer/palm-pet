// U9 — today list and running total.
//
// Pure projection: given the expense set produced by the fold (U4), the day key the
// shell has decided is "today" (U5's output), and an IANA time zone, answers which
// expenses belong on today's list, in what order, and what they add up to.
//
// No clock, no device zone, no storage, no dependency on any other module.

const INSTANT_RE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/;
const DAY_KEY_RE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;

const MIN_AMOUNT_CENTS = -999999999;
const MAX_AMOUNT_CENTS = 999999999;

/**
 * A string is a valid instant iff it matches the fixed-width ISO-8601 UTC grammar,
 * parses to a finite instant, and re-serialises (toISOString) to the identical string.
 * The round-trip is what rejects calendar overflow such as 2026-02-30 or 24:00:00.
 */
function isValidInstant(value) {
  if (typeof value !== "string" || !INSTANT_RE.test(value)) {
    return false;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return false;
  }
  return parsed.toISOString() === value;
}

/**
 * A day key is valid iff it matches the YYYY-MM-DD grammar and names a real
 * proleptic-Gregorian date. Uses the same round-trip technique as isValidInstant:
 * append local midnight, parse as an instant, and re-serialise the date portion.
 * A syntactically-plausible but non-existent date (2026-02-30, month 13, ...) either
 * fails to parse or rolls over onto a different date, so the round-trip catches it
 * without any manual leap-year arithmetic or numeric parsing of the input.
 */
function isValidDayKey(value) {
  if (typeof value !== "string" || !DAY_KEY_RE.test(value)) {
    return false;
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    return false;
  }
  return parsed.toISOString().slice(0, 10) === value;
}

/**
 * P5/B13: `zone` must be a string the runtime recognises as a time zone, checked
 * before any element of `expenses` is examined. Attempts the same zone-dependent
 * construction the day-key computation (B3, dayKeyInZone below) performs and lets a
 * rejection propagate. "Recognises" means whatever the runtime itself accepts, and
 * nothing narrower: a zone the runtime construction accepts is accepted here, whatever
 * its spelling, because U5 (to which B3 delegates) accepts the same case variants and
 * returns the correct key. There is no further echo check against the runtime's
 * canonical spelling.
 */
function assertZoneRecognised(zone) {
  if (typeof zone !== "string" || zone.length === 0) {
    throw new Error("zone must be a non-empty string");
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
  } catch (error) {
    throw new Error(`zone "${zone}" is not a time zone the runtime recognises`);
  }
}

/**
 * The day key of an instant in a zone: the calendar date a clock set to `zone`
 * displays at that instant. Computed via Intl.DateTimeFormat/formatToParts only —
 * never via device-local getters and never via a fixed UTC offset — so daylight-saving
 * transitions follow the zone's own rules. By the time this runs, `zone` has already
 * passed assertZoneRecognised in step 1, so the construction here cannot fail.
 */
function dayKeyInZone(instant, zone) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  let year = "";
  let month = "";
  let day = "";
  for (const part of formatter.formatToParts(new Date(instant))) {
    if (part.type === "year") year = part.value;
    else if (part.type === "month") month = part.value;
    else if (part.type === "day") day = part.value;
  }
  return `${year}-${month}-${day}`;
}

function describeEntry(entry, index) {
  if (
    entry !== null &&
    typeof entry === "object" &&
    typeof entry.expense_id === "string" &&
    entry.expense_id.length > 0
  ) {
    return `expense_id "${entry.expense_id}"`;
  }
  return `expenses[${index}]`;
}

function validateEntry(entry, index, seenIds) {
  if (entry === null || typeof entry !== "object") {
    throw new Error(`expenses[${index}] must be a non-null object`);
  }

  if (typeof entry.expense_id !== "string" || entry.expense_id.length === 0) {
    throw new Error(`expenses[${index}].expense_id must be a non-empty string`);
  }

  const label = describeEntry(entry, index);

  if (
    typeof entry.amount_cents !== "number" ||
    !Number.isInteger(entry.amount_cents) ||
    entry.amount_cents < MIN_AMOUNT_CENTS ||
    entry.amount_cents > MAX_AMOUNT_CENTS
  ) {
    throw new Error(
      `${label}: amount_cents must be an integer between ${MIN_AMOUNT_CENTS} and ${MAX_AMOUNT_CENTS}`
    );
  }

  if (!isValidInstant(entry.occurred_at)) {
    throw new Error(`${label}: occurred_at must be a valid ISO-8601 UTC instant`);
  }

  if (!isValidInstant(entry.recorded_at)) {
    throw new Error(`${label}: recorded_at must be a valid ISO-8601 UTC instant`);
  }

  if (typeof entry.voided !== "boolean") {
    throw new Error(`${label}: voided must be a boolean`);
  }

  if (seenIds.has(entry.expense_id)) {
    throw new Error(`duplicate expense_id "${entry.expense_id}"`);
  }
  seenIds.add(entry.expense_id);
}

export function todayList(expenses, todayKey, zone) {
  // Step 1: validate zone (P5, B13) and todayKey (P4) before examining `expenses` at
  // all. B13 requires the zone check to run on every call, whatever `expenses` holds —
  // an empty set, an all-voided set, or a set with nothing on `todayKey` would each
  // otherwise reach step 3's zone-dependent computation zero times, letting an
  // unrecognised zone through unnoticed with the same {items: [], total_cents: 0} a
  // correct empty day returns.
  assertZoneRecognised(zone);
  if (!isValidDayKey(todayKey)) {
    throw new Error("todayKey must be a YYYY-MM-DD string naming a real calendar date");
  }

  // Step 2: validate every entry (P1, P2, P3) before doing anything else.
  if (!Array.isArray(expenses)) {
    throw new Error("expenses must be an Array");
  }
  const seenIds = new Set();
  for (let index = 0; index < expenses.length; index += 1) {
    validateEntry(expenses[index], index, seenIds);
  }

  // Step 3: select the candidates (B2, B3, B5).
  const candidates = expenses.filter(
    (entry) => entry.voided === false && dayKeyInZone(entry.occurred_at, zone) === todayKey
  );

  // Step 4: order the candidates (B6, B7) — never sort the input array.
  candidates.sort((a, b) => {
    if (a.recorded_at !== b.recorded_at) {
      return a.recorded_at > b.recorded_at ? -1 : 1;
    }
    if (a.expense_id !== b.expense_id) {
      return a.expense_id > b.expense_id ? -1 : 1;
    }
    return 0;
  });

  // Step 5: sum (B8).
  let totalCents = 0;
  for (const entry of candidates) {
    totalCents += entry.amount_cents;
  }

  // Step 6: return.
  return { items: candidates, total_cents: totalCents };
}
