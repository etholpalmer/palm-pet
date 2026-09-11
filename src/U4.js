// U4 — fold event log -> expense set.
// Pure, synchronous, stateless. See spec/units/U4/spec.md for the full contract.

const ENVELOPE_KEYS = ['event_id', 'event_type', 'schema_version', 'recorded_at', 'occurred_at'];

const RECORDED_KNOWN_KEYS = new Set([
  ...ENVELOPE_KEYS,
  'amount_cents',
  'note',
  'tags',
  'source_of_funds',
  'geo',
]);

const PATCH_FORBIDDEN_KEYS = new Set([
  'event_id',
  'event_type',
  'schema_version',
  'recorded_at',
  'expense_id',
  'voided',
]);

const PATCH_REQUIRED_DOMAIN_KEYS = new Set(['amount_cents', 'occurred_at']);
const PATCH_NULLABLE_DOMAIN_KEYS = new Set(['note', 'tags', 'source_of_funds', 'geo']);

const TIMESTAMP_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.(\d{3})Z$/;
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function isLeapYear(year) {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function isTimestamp(value) {
  if (typeof value !== 'string' || value.length !== 24) return false;
  const match = TIMESTAMP_RE.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  if (month < 1 || month > 12) return false;
  const maxDay = month === 2 && isLeapYear(year) ? 29 : DAYS_IN_MONTH[month - 1];
  if (day < 1 || day > maxDay) return false;
  if (hour > 23) return false;
  if (minute > 59) return false;
  if (second > 59) return false;
  return true;
}

function isEventId(value) {
  return typeof value === 'string' && value.length > 0;
}

function isAmountCents(value) {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= -999999999 &&
    value <= 999999999
  );
}

function isNote(value) {
  return typeof value === 'string';
}

function isTags(value) {
  return Array.isArray(value) && value.every((t) => typeof t === 'string');
}

function isSourceOfFunds(value) {
  return typeof value === 'string';
}

function isGeo(value) {
  if (!isPlainObject(value)) return false;
  if (!hasOwn(value, 'lat') || !hasOwn(value, 'lng')) return false;
  const { lat, lng } = value;
  if (typeof lat !== 'number' || !Number.isFinite(lat) || lat < -90 || lat > 90) return false;
  if (typeof lng !== 'number' || !Number.isFinite(lng) || lng < -180 || lng > 180) return false;
  return true;
}

function isUnknownVersion(el) {
  if (!isPlainObject(el)) return false;
  if (!hasOwn(el, 'schema_version')) return false;
  const v = el.schema_version;
  return typeof v === 'number' && Number.isInteger(v) && v >= 2;
}

function hasAnyNullOwnValue(el) {
  return Object.keys(el).some((k) => el[k] === null);
}

function isWellFormedRecorded(el) {
  if (hasOwn(el, 'expense_id') || hasOwn(el, 'voided')) return false;
  if (!hasOwn(el, 'amount_cents') || !isAmountCents(el.amount_cents)) return false;
  if (hasOwn(el, 'note') && !isNote(el.note)) return false;
  if (hasOwn(el, 'tags') && !isTags(el.tags)) return false;
  if (hasOwn(el, 'source_of_funds') && !isSourceOfFunds(el.source_of_funds)) return false;
  if (hasOwn(el, 'geo') && !isGeo(el.geo)) return false;
  if (hasAnyNullOwnValue(el)) return false;
  return true;
}

function isWellFormedAmended(el) {
  if (!hasOwn(el, 'target_id') || !isEventId(el.target_id)) return false;
  if (!hasOwn(el, 'patch') || !isPlainObject(el.patch)) return false;
  const patch = el.patch;
  for (const key of Object.keys(patch)) {
    const value = patch[key];
    if (PATCH_FORBIDDEN_KEYS.has(key)) return false;
    if (PATCH_REQUIRED_DOMAIN_KEYS.has(key)) {
      if (key === 'amount_cents' && !isAmountCents(value)) return false;
      if (key === 'occurred_at' && !isTimestamp(value)) return false;
      continue;
    }
    if (PATCH_NULLABLE_DOMAIN_KEYS.has(key)) {
      if (value === null) continue;
      if (key === 'note' && !isNote(value)) return false;
      if (key === 'tags' && !isTags(value)) return false;
      if (key === 'source_of_funds' && !isSourceOfFunds(value)) return false;
      if (key === 'geo' && !isGeo(value)) return false;
      continue;
    }
    // any other key: any value at all, null included — no check.
  }
  return true;
}

function isWellFormedVoided(el) {
  return hasOwn(el, 'target_id') && isEventId(el.target_id);
}

function isWellFormed(el) {
  if (!isPlainObject(el)) return false;
  if (!hasOwn(el, 'schema_version') || el.schema_version !== 1) return false;
  if (!hasOwn(el, 'event_type')) return false;
  const type = el.event_type;
  if (type !== 'ExpenseRecorded' && type !== 'ExpenseAmended' && type !== 'ExpenseVoided') {
    return false;
  }
  if (!hasOwn(el, 'event_id') || !isEventId(el.event_id)) return false;
  if (!hasOwn(el, 'recorded_at') || !isTimestamp(el.recorded_at)) return false;
  if (!hasOwn(el, 'occurred_at') || !isTimestamp(el.occurred_at)) return false;
  if (type === 'ExpenseRecorded') return isWellFormedRecorded(el);
  if (type === 'ExpenseAmended') return isWellFormedAmended(el);
  return isWellFormedVoided(el);
}

function compareStrings(a, b) {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function totalOrderCompare(a, b) {
  const byRecordedAt = compareStrings(a.event.recorded_at, b.event.recorded_at);
  if (byRecordedAt !== 0) return byRecordedAt;
  const byEventId = compareStrings(a.event.event_id, b.event.event_id);
  if (byEventId !== 0) return byEventId;
  return a.index - b.index;
}

function buildBaseExpense(event) {
  const expense = {
    expense_id: event.event_id,
    recorded_at: event.recorded_at,
    occurred_at: event.occurred_at,
    amount_cents: event.amount_cents,
    voided: false,
  };
  if (hasOwn(event, 'note')) expense.note = event.note;
  if (hasOwn(event, 'tags')) expense.tags = event.tags.slice();
  if (hasOwn(event, 'source_of_funds')) expense.source_of_funds = event.source_of_funds;
  if (hasOwn(event, 'geo')) expense.geo = { ...event.geo };
  for (const key of Object.keys(event)) {
    if (RECORDED_KNOWN_KEYS.has(key)) continue;
    expense[key] = event[key];
  }
  return expense;
}

function omitKey(obj, key) {
  const rest = {};
  for (const k of Object.keys(obj)) {
    if (k === key) continue;
    rest[k] = obj[k];
  }
  return rest;
}

function applyPatch(expense, patch) {
  let next = expense;
  for (const key of Object.keys(patch)) {
    const value = patch[key];
    if (value === null) {
      next = hasOwn(next, key) ? omitKey(next, key) : next;
      continue;
    }
    if (key === 'tags') {
      next = { ...next, tags: value.slice() };
    } else if (key === 'geo') {
      next = { ...next, geo: { ...value } };
    } else {
      next = { ...next, [key]: value };
    }
  }
  return next;
}

function applyVoid(expense) {
  return { ...expense, voided: true };
}

export function foldExpenses(events) {
  if (!Array.isArray(events)) {
    throw new TypeError('foldExpenses: events must be an array');
  }

  const skipped = { malformed: 0, unknown_version: 0, duplicate: 0, orphaned: 0 };
  const wellFormed = [];

  for (let index = 0; index < events.length; index += 1) {
    const el = events[index];
    if (isUnknownVersion(el)) {
      skipped.unknown_version += 1;
      continue;
    }
    if (!isWellFormed(el)) {
      skipped.malformed += 1;
      continue;
    }
    wellFormed.push({ event: el, index });
  }

  wellFormed.sort(totalOrderCompare);

  const retained = [];
  const seenIds = new Set();
  for (const item of wellFormed) {
    const id = item.event.event_id;
    if (seenIds.has(id)) {
      skipped.duplicate += 1;
      continue;
    }
    seenIds.add(id);
    retained.push(item);
  }

  const expenseMap = new Map();
  for (const item of retained) {
    const event = item.event;
    if (event.event_type !== 'ExpenseRecorded') continue;
    expenseMap.set(event.event_id, buildBaseExpense(event));
  }

  for (const item of retained) {
    const event = item.event;
    if (event.event_type === 'ExpenseRecorded') continue;
    const target = expenseMap.get(event.target_id);
    if (!target) {
      skipped.orphaned += 1;
      continue;
    }
    if (event.event_type === 'ExpenseVoided') {
      expenseMap.set(event.target_id, applyVoid(target));
    } else {
      expenseMap.set(event.target_id, applyPatch(target, event.patch));
    }
  }

  const expenses = Array.from(expenseMap.values());
  expenses.sort((a, b) => {
    const byRecordedAt = compareStrings(a.recorded_at, b.recorded_at);
    if (byRecordedAt !== 0) return byRecordedAt;
    return compareStrings(a.expense_id, b.expense_id);
  });

  return { expenses, skipped };
}
