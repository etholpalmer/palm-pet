// U7 — NDJSON export of the raw event log.
// ES module. The module's only export is exportNdjson(events).

const HIGH_SURROGATE_MIN = 0xd800;
const HIGH_SURROGATE_MAX = 0xdbff;
const LOW_SURROGATE_MIN = 0xdc00;
const LOW_SURROGATE_MAX = 0xdfff;

function isPlainObject(v) {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

/**
 * Validate the container and the envelope of every element (P1-P4, B5, B6).
 * Throws on the first violation found while scanning in array order.
 */
function validateEnvelope(events) {
  if (!Array.isArray(events)) {
    throw new Error('exportNdjson: events must be an Array');
  }

  const seenIds = new Set();

  for (let i = 0; i < events.length; i++) {
    const e = events[i];

    if (!isPlainObject(e)) {
      throw new Error(`exportNdjson: events[${i}] must be a plain object`);
    }
    if (
      !Object.prototype.hasOwnProperty.call(e, 'event_id') ||
      typeof e.event_id !== 'string'
    ) {
      throw new Error(`exportNdjson: events[${i}].event_id must be a string`);
    }
    if (
      !Object.prototype.hasOwnProperty.call(e, 'recorded_at') ||
      typeof e.recorded_at !== 'string'
    ) {
      throw new Error(`exportNdjson: events[${i}].recorded_at must be a string`);
    }
    if (seenIds.has(e.event_id)) {
      throw new Error(`exportNdjson: duplicate event_id "${e.event_id}"`);
    }
    seenIds.add(e.event_id);
  }
}

/**
 * Recursively confirm that a value is a JsonValue (P5, B8). Throws on the
 * first violation found. Runs as its own pass, before any serialisation, so
 * that no case is silently coerced by a stringifier.
 */
function assertJsonValue(v, path) {
  if (v === null) return;

  const t = typeof v;

  if (t === 'boolean' || t === 'string') return;

  if (t === 'number') {
    if (!Number.isFinite(v)) {
      throw new Error(`exportNdjson: ${path} is not a finite number`);
    }
    return;
  }

  if (t === 'undefined' || t === 'bigint' || t === 'function' || t === 'symbol') {
    throw new Error(`exportNdjson: ${path} has an unrepresentable value`);
  }

  // t === 'object' from here on.
  if (Array.isArray(v)) {
    for (let i = 0; i < v.length; i++) {
      assertJsonValue(v[i], `${path}[${i}]`);
    }
    return;
  }

  if (!isPlainObject(v)) {
    throw new Error(`exportNdjson: ${path} is not a plain object`);
  }

  const keys = Object.keys(v);
  for (const key of keys) {
    assertJsonValue(v[key], `${path}.${key}`);
  }
}

function validateValueTrees(events) {
  for (let i = 0; i < events.length; i++) {
    assertJsonValue(events[i], `events[${i}]`);
  }
}

function compareBySortKey(a, b) {
  if (a.recorded_at < b.recorded_at) return -1;
  if (a.recorded_at > b.recorded_at) return 1;
  if (a.event_id < b.event_id) return -1;
  if (a.event_id > b.event_id) return 1;
  return 0;
}

function toHex4(codeUnit) {
  return codeUnit.toString(16).padStart(4, '0');
}

/**
 * Encode a string as JSON text between double quotes, per B9.
 */
function encodeString(s) {
  let out = '"';

  for (let i = 0; i < s.length; i++) {
    const cu = s.charCodeAt(i);

    if (cu === 0x22) {
      out += '\\"';
    } else if (cu === 0x5c) {
      out += '\\\\';
    } else if (cu === 0x08) {
      out += '\\b';
    } else if (cu === 0x09) {
      out += '\\t';
    } else if (cu === 0x0a) {
      out += '\\n';
    } else if (cu === 0x0c) {
      out += '\\f';
    } else if (cu === 0x0d) {
      out += '\\r';
    } else if (cu <= 0x1f) {
      out += '\\u' + toHex4(cu);
    } else if (cu === 0x85 || cu === 0x2028 || cu === 0x2029) {
      out += '\\u' + toHex4(cu);
    } else if (cu >= HIGH_SURROGATE_MIN && cu <= HIGH_SURROGATE_MAX) {
      const next = i + 1 < s.length ? s.charCodeAt(i + 1) : -1;
      if (next >= LOW_SURROGATE_MIN && next <= LOW_SURROGATE_MAX) {
        // Properly paired surrogate — write both code units literally.
        out += s[i] + s[i + 1];
        i++;
      } else {
        // Lone high surrogate.
        out += '\\u' + toHex4(cu);
      }
    } else if (cu >= LOW_SURROGATE_MIN && cu <= LOW_SURROGATE_MAX) {
      // A low surrogate reached without having been consumed above as the
      // second half of a pair is by definition lone.
      out += '\\u' + toHex4(cu);
    } else {
      out += s[i];
    }
  }

  out += '"';
  return out;
}

/**
 * Encode a finite number exactly as ECMAScript Number::toString writes it
 * (B10). String(n) on a finite double is that algorithm.
 */
function encodeNumber(n) {
  return String(n);
}

/**
 * Encode any JsonValue as canonical JSON text (B7, B9, B10, B15). Assumes
 * the value has already passed assertJsonValue.
 */
function encodeValue(v) {
  if (v === null) return 'null';

  const t = typeof v;

  if (t === 'boolean') return v ? 'true' : 'false';
  if (t === 'number') return encodeNumber(v);
  if (t === 'string') return encodeString(v);

  if (Array.isArray(v)) {
    let out = '[';
    for (let i = 0; i < v.length; i++) {
      if (i > 0) out += ',';
      out += encodeValue(v[i]);
    }
    out += ']';
    return out;
  }

  // Plain object.
  const keys = Object.keys(v).sort();
  let out = '{';
  for (let i = 0; i < keys.length; i++) {
    if (i > 0) out += ',';
    const key = keys[i];
    out += encodeString(key) + ':' + encodeValue(v[key]);
  }
  out += '}';
  return out;
}

export function exportNdjson(events) {
  validateEnvelope(events);
  validateValueTrees(events);

  if (events.length === 0) return '';

  const ordered = events.slice().sort(compareBySortKey);

  let out = '';
  for (const e of ordered) {
    out += encodeValue(e) + '\n';
  }
  return out;
}
