// Geo pin. D10: raw lat/lng, no reverse geocoding (that needs a network and a key at
// capture time, when the user may be offline).
//
// CHECKLIST: "silent after first grant". CUT: the geo checkbox — the pin is captured
// silently or not at all. The one rule that overrides everything here: **never block a
// save.** Every failure path resolves to undefined, and B27 makes an absent key the single
// encoding of "no pin".

const TIMEOUT_MS = 2000;

let lastKnown;

/** Warm the pin in the background. Never awaited by the save path. */
export function warm() {
  if (!navigator.geolocation) return;
  if (navigator.permissions?.query) {
    navigator.permissions.query({ name: 'geolocation' })
      .then((s) => { if (s.state === 'granted') sample(); })
      .catch(() => {});
  }
}

function sample() {
  navigator.geolocation.getCurrentPosition(
    (p) => { lastKnown = { lat: p.coords.latitude, lng: p.coords.longitude }; },
    () => {},
    { timeout: TIMEOUT_MS, maximumAge: 60_000 },
  );
}

/**
 * The pin to attach to the event being saved, or undefined.
 * Returns synchronously from the last known fix: a save never waits on a satellite.
 */
export function pinForSave() {
  sample();               // refresh for next time
  return lastKnown;       // undefined until a fix has ever arrived
}
