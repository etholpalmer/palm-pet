const INSTANT_GRAMMAR = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/;

export function localDayKey(occurredAt, timeZone) {
  if (typeof occurredAt !== 'string') {
    throw new TypeError('occurredAt must be a string');
  }
  if (typeof timeZone !== 'string') {
    throw new TypeError('timeZone must be a string');
  }

  if (!INSTANT_GRAMMAR.test(occurredAt)) {
    throw new RangeError('occurredAt does not match the Instant string grammar');
  }

  const d = new Date(occurredAt);
  if (
    Number.isNaN(d.getTime()) ||
    d.toISOString() !== occurredAt ||
    occurredAt.startsWith('0000')
  ) {
    throw new RangeError('occurredAt does not denote a real instant');
  }

  let formatter;
  try {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      calendar: 'gregory',
      numberingSystem: 'latn',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  } catch (err) {
    if (err instanceof RangeError) {
      throw err;
    }
    throw new RangeError('timeZone is not a recognised IANA time zone');
  }

  const parts = formatter.formatToParts(d);
  let year;
  let month;
  let day;
  for (const part of parts) {
    if (part.type === 'year') year = part.value;
    else if (part.type === 'month') month = part.value;
    else if (part.type === 'day') day = part.value;
  }

  return `${year.padStart(4, '0')}-${month}-${day}`;
}
