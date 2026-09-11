const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const INSTANT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const AMOUNT_LIMIT = 999999999;
const PATCH_KEY_ORDER = ['amount_cents', 'note', 'tags', 'source_of_funds', 'occurred_at', 'geo'];

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function isValidUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value);
}

function isValidInstant(value) {
  if (typeof value !== 'string') return false;
  if (!INSTANT_RE.test(value)) return false;
  if (Number.isNaN(Date.parse(value))) return false;
  return new Date(value).toISOString() === value;
}

function isCents(value) {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= -AMOUNT_LIMIT &&
    value <= AMOUNT_LIMIT
  );
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function isPin(value) {
  if (!isPlainObject(value)) return false;
  const keys = Object.keys(value);
  if (keys.length !== 2 || !hasOwn(value, 'lat') || !hasOwn(value, 'lng')) return false;
  if (!isFiniteNumber(value.lat) || !isFiniteNumber(value.lng)) return false;
  if (value.lat < -90 || value.lat > 90) return false;
  if (value.lng < -180 || value.lng > 180) return false;
  return true;
}

function validateKeySet(input, requiredKeys, optionalKeys) {
  const permitted = new Set([...requiredKeys, ...optionalKeys]);
  for (const key of Object.keys(input)) {
    if (!permitted.has(key)) {
      throw new Error(`unexpected key "${key}" for event_type "${input.event_type}"`);
    }
  }
  for (const key of requiredKeys) {
    if (!hasOwn(input, key)) {
      throw new Error(`missing required key "${key}" for event_type "${input.event_type}"`);
    }
  }
}

function buildPatch(patchInput) {
  if (!isPlainObject(patchInput)) {
    throw new Error('patch must be a plain object');
  }
  const suppliedKeys = Object.keys(patchInput);
  if (suppliedKeys.length === 0) {
    throw new Error('patch must have at least one key');
  }
  const allowed = new Set(PATCH_KEY_ORDER);
  for (const key of suppliedKeys) {
    if (!allowed.has(key)) {
      throw new Error(`unexpected patch key "${key}"`);
    }
  }

  const output = {};
  for (const key of PATCH_KEY_ORDER) {
    if (!hasOwn(patchInput, key)) continue;
    const value = patchInput[key];

    if (key === 'amount_cents') {
      if (!isCents(value)) throw new Error('invalid patch.amount_cents');
      output.amount_cents = value;
    } else if (key === 'occurred_at') {
      if (!isValidInstant(value)) throw new Error('invalid patch.occurred_at');
      output.occurred_at = value;
    } else if (key === 'note') {
      if (value !== null && typeof value !== 'string') throw new Error('invalid patch.note');
      output.note = value;
    } else if (key === 'source_of_funds') {
      if (value !== null && typeof value !== 'string') {
        throw new Error('invalid patch.source_of_funds');
      }
      output.source_of_funds = value;
    } else if (key === 'tags') {
      if (value === null) {
        output.tags = null;
      } else {
        if (!Array.isArray(value) || !value.every((tag) => typeof tag === 'string')) {
          throw new Error('invalid patch.tags');
        }
        output.tags = value.slice();
      }
    } else if (key === 'geo') {
      if (value === null) {
        output.geo = null;
      } else {
        if (!isPin(value)) throw new Error('invalid patch.geo');
        output.geo = { lat: value.lat, lng: value.lng };
      }
    }
  }

  return output;
}

export function buildEvent(input) {
  if (!isPlainObject(input)) {
    throw new Error('input must be a plain object');
  }

  const eventType = input.event_type;
  if (
    eventType !== 'ExpenseRecorded' &&
    eventType !== 'ExpenseAmended' &&
    eventType !== 'ExpenseVoided'
  ) {
    throw new Error('invalid event_type');
  }

  if (!isValidUuid(input.event_id)) {
    throw new Error('invalid event_id');
  }
  if (!isValidInstant(input.recorded_at)) {
    throw new Error('invalid recorded_at');
  }

  if (eventType === 'ExpenseRecorded') {
    validateKeySet(input, ['event_type', 'event_id', 'recorded_at', 'amount_cents'], ['geo']);

    if (!isCents(input.amount_cents)) {
      throw new Error('invalid amount_cents');
    }

    const hasGeo = hasOwn(input, 'geo') && input.geo !== undefined;
    let geo;
    if (hasGeo) {
      if (!isPin(input.geo)) {
        throw new Error('invalid geo');
      }
      geo = { lat: input.geo.lat, lng: input.geo.lng };
    }

    const output = {
      event_id: input.event_id,
      event_type: eventType,
      schema_version: 1,
      occurred_at: input.recorded_at,
      recorded_at: input.recorded_at,
      amount_cents: input.amount_cents,
    };
    if (hasGeo) {
      output.geo = geo;
    }
    return output;
  }

  if (eventType === 'ExpenseAmended') {
    validateKeySet(input, ['event_type', 'event_id', 'recorded_at', 'target_id', 'patch'], []);

    if (!isValidUuid(input.target_id)) {
      throw new Error('invalid target_id');
    }
    if (input.target_id === input.event_id) {
      throw new Error('target_id must differ from event_id');
    }

    const patch = buildPatch(input.patch);

    return {
      event_id: input.event_id,
      event_type: eventType,
      schema_version: 1,
      occurred_at: input.recorded_at,
      recorded_at: input.recorded_at,
      target_id: input.target_id,
      patch,
    };
  }

  // eventType === 'ExpenseVoided'
  validateKeySet(input, ['event_type', 'event_id', 'recorded_at', 'target_id'], []);

  if (!isValidUuid(input.target_id)) {
    throw new Error('invalid target_id');
  }
  if (input.target_id === input.event_id) {
    throw new Error('target_id must differ from event_id');
  }

  return {
    event_id: input.event_id,
    event_type: eventType,
    schema_version: 1,
    occurred_at: input.recorded_at,
    recorded_at: input.recorded_at,
    target_id: input.target_id,
  };
}
