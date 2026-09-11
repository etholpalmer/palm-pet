const GRAMMAR = /^-?[0-9]{1,9}$/;

/**
 * Parse a cents digit string (as typed on the capture keypad) into an
 * integer number of cents.
 *
 * @param {string} input - optionally signed run of 1-9 ASCII digits.
 * @returns {number} integer cents in -999999999..999999999, never -0.
 * @throws {Error} if input is not a string or does not match the grammar.
 */
export function parseCents(input) {
  if (typeof input !== "string") {
    throw new Error("parseCents: input must be a string primitive");
  }

  if (!GRAMMAR.test(input)) {
    throw new Error("parseCents: input must match ^-?[0-9]{1,9}$");
  }

  const isNegative = input.charCodeAt(0) === 45; // '-'
  const digitRun = isNegative ? input.slice(1) : input;

  let magnitude = 0;
  for (let i = 0; i < digitRun.length; i++) {
    magnitude = magnitude * 10 + (digitRun.charCodeAt(i) - 48);
  }

  let result = isNegative ? -magnitude : magnitude;

  // Normalise negative zero to positive zero (Object.is(result, 0) === true).
  if (result === 0) {
    result = 0;
  }

  return result;
}
