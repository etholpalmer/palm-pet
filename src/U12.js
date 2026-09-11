export function formatCents(cents) {
  if (Number.isSafeInteger(cents) === false) {
    throw new TypeError("formatCents: cents must be a safe integer");
  }

  const isNegative = cents < 0;
  const magnitude = isNegative ? -cents : cents;
  const digits = String(magnitude);

  let paddedDigits = digits;
  while (paddedDigits.length < 3) {
    paddedDigits = "0" + paddedDigits;
  }

  const integerPart = paddedDigits.slice(0, -2);
  const fractionPart = paddedDigits.slice(-2);
  const sign = isNegative ? "-" : "";

  return sign + integerPart + "." + fractionPart;
}
