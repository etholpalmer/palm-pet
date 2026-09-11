// U3 — apply one ExpenseAmended sparse patch to one expense.
//
// export function applyAmend(expense, patch) -> Expense, or throws
//
// Pure, total over its declared inputs. No environment reads, no mutation,
// no coercion. See spec/units/U3/spec.md for the full contract.

const RESERVED_KEYS = new Set([
  'expense_id',
  'event_id',
  'event_type',
  'schema_version',
  'recorded_at',
  'voided',
  '__proto__',
  'constructor',
  'prototype',
]);

const AMOUNT_CENTS_MIN = -999999999;
const AMOUNT_CENTS_MAX = 999999999;

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

const INSTANT_SHAPE =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.(\d{3})Z$/;

function isPlainObject(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function isLeapYear(year) {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function isInstant(value) {
  if (typeof value !== 'string') {
    return false;
  }
  const match = INSTANT_SHAPE.exec(value);
  if (match === null) {
    return false;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);

  if (month < 1 || month > 12) {
    return false;
  }
  if (hour > 23 || minute > 59 || second > 59) {
    return false;
  }
  const monthLength =
    month === 2 && isLeapYear(year) ? 29 : DAYS_IN_MONTH[month - 1];
  if (day < 1 || day > monthLength) {
    return false;
  }
  return true;
}

function isAmountCents(value) {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= AMOUNT_CENTS_MIN &&
    value <= AMOUNT_CENTS_MAX
  );
}

function isStringArray(value) {
  if (!Array.isArray(value)) {
    return false;
  }
  for (const element of value) {
    if (typeof element !== 'string') {
      return false;
    }
  }
  return true;
}

function isPin(value) {
  if (!isPlainObject(value)) {
    return false;
  }
  const { lat, lng } = value;
  if (typeof lat !== 'number' || !Number.isFinite(lat) || lat < -90 || lat > 90) {
    return false;
  }
  if (
    typeof lng !== 'number' ||
    !Number.isFinite(lng) ||
    lng < -180 ||
    lng > 180
  ) {
    return false;
  }
  return true;
}

// One clearable amendable key: null clears, non-null must satisfy `check`.
function clearableRule(check) {
  return (value) => value === null || check(value);
}

const AMENDABLE_VALIDATORS = {
  amount_cents: (value) => value !== null && isAmountCents(value),
  occurred_at: (value) => value !== null && isInstant(value),
  note: clearableRule((value) => typeof value === 'string'),
  tags: clearableRule(isStringArray),
  source_of_funds: clearableRule((value) => typeof value === 'string'),
  geo: clearableRule(isPin),
};

function fail(message) {
  throw new Error(message);
}

export function applyAmend(expense, patch) {
  if (!isPlainObject(expense)) {
    fail('applyAmend: expense must be a plain object');
  }
  if (!isPlainObject(patch)) {
    fail('applyAmend: patch must be a plain object');
  }

  const patchKeys = Object.keys(patch);
  let firstDefectKey = null;

  for (const key of patchKeys) {
    const value = patch[key];

    if (value === undefined) {
      if (firstDefectKey === null) firstDefectKey = key;
      continue;
    }

    if (RESERVED_KEYS.has(key)) {
      if (firstDefectKey === null) firstDefectKey = key;
      continue;
    }

    const validator = AMENDABLE_VALIDATORS[key];
    if (validator !== undefined) {
      if (!validator(value)) {
        if (firstDefectKey === null) firstDefectKey = key;
      }
      continue;
    }

    // Unknown key: any defined, non-undefined JSON value is acceptable.
  }

  if (firstDefectKey !== null) {
    fail(`applyAmend: patch key "${firstDefectKey}" is malformed`);
  }

  const result = { ...expense };
  for (const key of patchKeys) {
    const value = patch[key];
    if (value === null) {
      delete result[key];
    } else {
      result[key] = value;
    }
  }

  return result;
}
