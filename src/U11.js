// U11 — buildAmend: derive a sparse patch from a back-fill sheet's values and
// the current expense projection. Pure, synchronous, no environment reads.

const INSTANT_RE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/;
const DATE_RE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
const TIME_RE = /^[0-9]{2}:[0-9]{2}$/;

const MIN_CENTS = -999999999;
const MAX_CENTS = 999999999;

function isLeapYear(year) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function daysInMonth(year, month) {
  const lengths = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month === 2 && isLeapYear(year)) return 29;
  return lengths[month - 1];
}

function isIntegerInCentsRange(value) {
  return Number.isSafeInteger(value) && value >= MIN_CENTS && value <= MAX_CENTS;
}

function isValidLocalDate(s) {
  if (typeof s !== 'string' || !DATE_RE.test(s)) return false;
  const [yStr, mStr, dStr] = s.split('-');
  const year = Number(yStr);
  const month = Number(mStr);
  const day = Number(dStr);
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > daysInMonth(year, month)) return false;
  return true;
}

function isValidLocalTime(s) {
  if (typeof s !== 'string' || !TIME_RE.test(s)) return false;
  const [hStr, mStr] = s.split(':');
  const hour = Number(hStr);
  const minute = Number(mStr);
  return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59;
}

function isValidInstant(s) {
  if (typeof s !== 'string' || !INSTANT_RE.test(s)) return false;
  const d = new Date(s);
  return d.toISOString() === s;
}

function fail(message) {
  throw new Error(message);
}

function validate(input) {
  if (input === null || typeof input !== 'object') {
    fail('U11: input must be an object');
  }
  const { current, sheet, zone } = input;

  // P3
  if (typeof zone !== 'string' || zone.length === 0) {
    fail('U11: zone must be a non-empty string');
  }
  let formatter;
  try {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    fail('U11: zone is not accepted by Intl.DateTimeFormat');
  }

  if (current === null || typeof current !== 'object') {
    fail('U11: current must be an object');
  }
  if (sheet === null || typeof sheet !== 'object') {
    fail('U11: sheet must be an object');
  }

  // P5
  if (!isIntegerInCentsRange(current.amount_cents)) {
    fail('U11: current.amount_cents must be an integer in -999999999..999999999');
  }

  // P6
  if (!isValidInstant(current.occurred_at)) {
    fail('U11: current.occurred_at must be an Instant');
  }

  // P7
  if (current.note !== undefined && current.note !== null && typeof current.note !== 'string') {
    fail('U11: current.note must be a string, null, or absent');
  }
  if (
    current.source_of_funds !== undefined &&
    current.source_of_funds !== null &&
    typeof current.source_of_funds !== 'string'
  ) {
    fail('U11: current.source_of_funds must be a string, null, or absent');
  }
  if (current.tags !== undefined && current.tags !== null) {
    if (!Array.isArray(current.tags) || !current.tags.every((t) => typeof t === 'string')) {
      fail('U11: current.tags must be an array of strings, null, or absent');
    }
  }

  // P8
  if (!isIntegerInCentsRange(sheet.amount_cents)) {
    fail('U11: sheet.amount_cents must be an integer in -999999999..999999999');
  }

  // P9
  if (!isValidLocalDate(sheet.date)) {
    fail('U11: sheet.date must be a LocalDate');
  }
  if (!isValidLocalTime(sheet.time)) {
    fail('U11: sheet.time must be a LocalTime');
  }

  // P10
  if (typeof sheet.note !== 'string') {
    fail('U11: sheet.note must be a string');
  }
  if (typeof sheet.tags !== 'string') {
    fail('U11: sheet.tags must be a string');
  }
  if (typeof sheet.source_of_funds !== 'string') {
    fail('U11: sheet.source_of_funds must be a string');
  }

  return formatter;
}

function formatParts(formatter, ms) {
  const parts = formatter.formatToParts(new Date(ms));
  const get = (type) => {
    const part = parts.find((p) => p.type === type);
    let value = part ? part.value : undefined;
    if (type === 'hour' && value === '24') value = '00';
    return value;
  };
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    hour: Number(get('hour')),
    minute: Number(get('minute')),
    second: Number(get('second')),
  };
}

function wallDateString(parts) {
  const y = String(parts.year).padStart(4, '0');
  const m = String(parts.month).padStart(2, '0');
  const d = String(parts.day).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function wallTimeString(parts) {
  const h = String(parts.hour).padStart(2, '0');
  const mi = String(parts.minute).padStart(2, '0');
  return `${h}:${mi}`;
}

function offsetAt(formatter, ms) {
  const parts = formatParts(formatter, ms);
  const wallAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second, 0);
  const msFloorSecond = Math.floor(ms / 1000) * 1000;
  return wallAsUtc - msFloorSecond;
}

function rebuildInstant(formatter, date, time) {
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  const W = Date.UTC(year, month - 1, day, hour, minute, 0, 0);

  const oPre = offsetAt(formatter, W - 86400000);
  const oPost = offsetAt(formatter, W + 86400000);

  const candidateA = W - oPre;
  const candidateB = W - oPost;

  const isValidCandidate = (ms) => {
    const parts = formatParts(formatter, ms);
    return wallDateString(parts) === date && wallTimeString(parts) === time;
  };

  const validA = isValidCandidate(candidateA);
  const validB = isValidCandidate(candidateB);

  let result;
  if (validA && validB) {
    result = Math.min(candidateA, candidateB);
  } else if (validA) {
    result = candidateA;
  } else if (validB) {
    result = candidateB;
  } else {
    // gap: no valid candidate, shift forward using the pre-transition offset
    result = candidateA;
  }

  return new Date(result).toISOString();
}

function effectiveTrimmed(value) {
  if (value === undefined || value === null) return { empty: true, value: null };
  const trimmed = value.trim();
  if (trimmed === '') return { empty: true, value: null };
  return { empty: false, value: trimmed };
}

function normaliseTagPieces(pieces) {
  const trimmed = pieces.map((p) => p.trim()).filter((p) => p !== '');
  const lowered = trimmed.map((p) => p.toLowerCase());
  const seen = new Set();
  const result = [];
  for (const tag of lowered) {
    if (!seen.has(tag)) {
      seen.add(tag);
      result.push(tag);
    }
  }
  return result;
}

function effectiveSheetTags(rawText) {
  const pieces = rawText.split(',');
  const list = normaliseTagPieces(pieces);
  return list.length === 0 ? { empty: true, value: null } : { empty: false, value: list };
}

function effectiveCurrentTags(tags) {
  if (tags === undefined || tags === null) return { empty: true, value: null };
  const list = normaliseTagPieces(tags);
  return list.length === 0 ? { empty: true, value: null } : { empty: false, value: list };
}

function arraysEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

export function buildAmend(input) {
  const formatter = validate(input);
  const { current, sheet, zone } = input;
  void zone; // zone is only used indirectly through `formatter`

  const patch = {};

  // amount_cents
  if (sheet.amount_cents !== current.amount_cents) {
    patch.amount_cents = sheet.amount_cents;
  }

  // occurred_at (B9, B10, B11)
  const currentParts = formatParts(formatter, Date.parse(current.occurred_at));
  const currentWallDate = wallDateString(currentParts);
  const currentWallTime = wallTimeString(currentParts);
  if (currentWallDate !== sheet.date || currentWallTime !== sheet.time) {
    patch.occurred_at = rebuildInstant(formatter, sheet.date, sheet.time);
  }

  // note
  {
    const sheetEff = effectiveTrimmed(sheet.note);
    const currentEff = effectiveTrimmed(current.note);
    if (sheetEff.empty && currentEff.empty) {
      // untouched, no key
    } else if (sheetEff.empty && !currentEff.empty) {
      patch.note = null;
    } else if (!sheetEff.empty && sheetEff.value !== currentEff.value) {
      patch.note = sheetEff.value;
    }
  }

  // source_of_funds
  {
    const sheetEff = effectiveTrimmed(sheet.source_of_funds);
    const currentEff = effectiveTrimmed(current.source_of_funds);
    if (sheetEff.empty && currentEff.empty) {
      // untouched, no key
    } else if (sheetEff.empty && !currentEff.empty) {
      patch.source_of_funds = null;
    } else if (!sheetEff.empty && sheetEff.value !== currentEff.value) {
      patch.source_of_funds = sheetEff.value;
    }
  }

  // tags
  {
    const sheetEff = effectiveSheetTags(sheet.tags);
    const currentEff = effectiveCurrentTags(current.tags);
    if (sheetEff.empty && currentEff.empty) {
      // untouched, no key
    } else if (sheetEff.empty && !currentEff.empty) {
      patch.tags = null;
    } else if (!sheetEff.empty && (currentEff.empty || !arraysEqual(sheetEff.value, currentEff.value))) {
      patch.tags = sheetEff.value;
    }
  }

  if (Object.keys(patch).length === 0) {
    return null;
  }
  return patch;
}
