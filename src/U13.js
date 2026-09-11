const CANONICAL_INSTANT_RE =
  /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/;

function fold(s) {
  return s.trim().toLowerCase();
}

export function tagVocabulary(expenses, seeds) {
  if (!Array.isArray(expenses)) {
    throw new TypeError('expenses must be an array');
  }
  if (!Array.isArray(seeds)) {
    throw new TypeError('seeds must be an array');
  }

  for (const expense of expenses) {
    if (typeof expense !== 'object' || expense === null) {
      throw new TypeError('each expense must be a non-null object');
    }

    const { recorded_at, tags, voided } = expense;

    if (typeof recorded_at !== 'string' || !CANONICAL_INSTANT_RE.test(recorded_at)) {
      throw new TypeError('expense.recorded_at must be a CanonicalInstant string');
    }

    if (voided !== undefined && typeof voided !== 'boolean') {
      throw new TypeError('expense.voided must be a boolean when present');
    }

    if (tags !== undefined && tags !== null) {
      if (!Array.isArray(tags)) {
        throw new TypeError('expense.tags must be an array when present and not null');
      }
      for (const tag of tags) {
        if (typeof tag !== 'string') {
          throw new TypeError('every element of expense.tags must be a string');
        }
      }
    }
  }

  for (const seed of seeds) {
    if (typeof seed !== 'string') {
      throw new TypeError('every seed must be a string');
    }
    if (fold(seed).length === 0) {
      throw new TypeError('every seed must fold to a non-empty string');
    }
  }

  const recency = new Map();

  for (const expense of expenses) {
    if (expense.voided === true) {
      continue;
    }
    const tags = expense.tags;
    if (!tags) {
      continue;
    }
    for (const tag of tags) {
      const canonicalTag = fold(tag);
      if (canonicalTag.length === 0) {
        continue;
      }
      const current = recency.get(canonicalTag);
      if (current === undefined || expense.recorded_at > current) {
        recency.set(canonicalTag, expense.recorded_at);
      }
    }
  }

  for (const seed of seeds) {
    const canonicalTag = fold(seed);
    if (!recency.has(canonicalTag)) {
      recency.set(canonicalTag, null);
    }
  }

  const entries = Array.from(recency.entries());

  entries.sort((a, b) => {
    const [tagA, lastUsedA] = a;
    const [tagB, lastUsedB] = b;

    if (lastUsedA !== null && lastUsedB === null) {
      return -1;
    }
    if (lastUsedA === null && lastUsedB !== null) {
      return 1;
    }
    if (lastUsedA !== null && lastUsedB !== null && lastUsedA !== lastUsedB) {
      return lastUsedA > lastUsedB ? -1 : 1;
    }

    if (tagA < tagB) {
      return -1;
    }
    if (tagA > tagB) {
      return 1;
    }
    return 0;
  });

  return entries.map(([tag]) => tag);
}
