import assert from "node:assert/strict";
import test from "node:test";
import { expectedSession, inFridayWindow, isDue } from "./refresh-runner.mjs";

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
