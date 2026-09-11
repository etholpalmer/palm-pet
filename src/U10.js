// Unit U10 — keypad key-press reducer.
// A pure ES module. Turns key presses on the capture screen's custom keypad
// into the digit string that the amount parser (U1) reads.

export const REST_STATE = "";
export const MAX_DIGITS = 9;

const STATE_PATTERN = /^([1-9][0-9]{0,8})?$/;

const DIGIT_KEYS = new Set([
  "0", "1", "2", "3", "4", "5", "6", "7", "8", "9",
]);

const KEYS = new Set([...DIGIT_KEYS, "00", "backspace"]);

function isState(value) {
  return typeof value === "string" && STATE_PATTERN.test(value);
}

function isKey(value) {
  return typeof value === "string" && KEYS.has(value);
}

function assertState(value) {
  if (!isState(value)) {
    throw new RangeError("Invalid State: must be a string matching ^([1-9][0-9]{0,8})?$");
  }
}

function assertKey(value) {
  if (!isKey(value)) {
    throw new RangeError("Invalid Key: must be one of the twelve Key tokens");
  }
}

function pressDigit(state, digit) {
  if (state === "" && digit === "0") {
    return state;
  }
  if (state.length < MAX_DIGITS) {
    return state + digit;
  }
  return state;
}

export function press(state, key) {
  assertState(state);
  assertKey(key);

  if (key === "backspace") {
    if (state === "") {
      return state;
    }
    return state.slice(0, -1);
  }

  if (key === "00") {
    return pressDigit(pressDigit(state, "0"), "0");
  }

  return pressDigit(state, key);
}

export function pressAll(keys, start) {
  const startState = start === undefined ? REST_STATE : start;
  assertState(startState);

  if (!Array.isArray(keys)) {
    throw new RangeError("Invalid keys: must be an array");
  }

  let result = startState;
  for (let i = 0; i < keys.length; i++) {
    result = press(result, keys[i]);
  }
  return result;
}
