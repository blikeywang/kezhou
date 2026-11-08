import assert from "node:assert/strict";
import test from "node:test";
import { expectedSession, hoursSinceClose, inFridayWindow, isDue, isTradingDay } from "./refresh-runner.mjs";

// 2026-11-06 is a Friday. New York is UTC-5 in November.
test("before the close the expected session is the previous weekday", () => {
  assert.equal(expectedSession(new Date("2026-11-06T15:00:00Z")), "2026-11-05"); // Fri 10:00 ET
  assert.equal(expectedSession(new Date("2026-11-09T14:00:00Z")), "2026-11-06"); // Mon 09:00 ET -> Fri
});

test("after 16:20 ET the same day counts; weekends map back to Friday", () => {
  assert.equal(expectedSession(new Date("2026-11-06T21:30:00Z")), "2026-11-06"); // Fri 16:30 ET
  assert.equal(expectedSession(new Date("2026-11-07T16:00:00Z")), "2026-11-06"); // Sat
  assert.equal(expectedSession(new Date("2026-11-08T23:00:00Z")), "2026-11-06"); // Sun
});

test("Friday action window is 10:00-15:30 ET only", () => {
  assert.equal(inFridayWindow(new Date("2026-11-06T15:10:00Z")), "2026-11-06"); // 10:10 ET
  assert.equal(inFridayWindow(new Date("2026-11-06T14:50:00Z")), null);        // 09:50 ET
  assert.equal(inFridayWindow(new Date("2026-11-06T20:45:00Z")), null);        // 15:45 ET
  assert.equal(inFridayWindow(new Date("2026-11-05T15:10:00Z")), null);        // Thursday
});

test("market jobs run when the stamp is older; daily-trade runs when the source fingerprint differs", () => {
  assert.equal(isDue({ due: "afterClose" }, "2026-11-05", "2026-11-06"), true);
  assert.equal(isDue({ due: "afterClose" }, "2026-11-06", "2026-11-06"), false);
  assert.equal(isDue({ due: "sourceChanged" }, "2026-09-21:aaaa", "2026-09-21:bbbb"), true);
  assert.equal(isDue({ due: "sourceChanged" }, "2026-09-21:aaaa", "2026-09-21:aaaa"), false);
  assert.equal(isDue({ due: "sourceChanged" }, null, "unknown"), true);
});

test("NYSE holidays and early closes from the 2026–2027 calendar", () => {
  assert.equal(isTradingDay("2026-11-26"), false);                                  // Thanksgiving
  assert.equal(expectedSession(new Date("2026-11-27T14:00:00Z")), "2026-11-25");    // Fri 09:00 ET -> Wed (Thu closed)
  assert.equal(expectedSession(new Date("2026-11-27T18:30:00Z")), "2026-11-27");    // early close 13:00, ready 13:20 ET
  assert.equal(expectedSession(new Date("2026-04-06T14:00:00Z")), "2026-04-02");    // Mon after Good Friday -> Thu
  assert.equal(expectedSession(new Date("2027-07-06T14:00:00Z")), "2027-07-02");    // Tue after observed July 4th
});

test("hours since close separate 'not yet' from 'failed'", () => {
  assert.equal(hoursSinceClose("2026-11-06", new Date("2026-11-06T22:20:00Z")), 1); // Fri 17:20 ET
  assert.equal(hoursSinceClose("2026-11-06", new Date("2026-11-07T15:20:00Z")), 18); // Sat 10:20 ET
});
