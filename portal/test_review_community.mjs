import assert from "node:assert/strict";
import test from "node:test";

import {
  createCasePacket,
  createFeedbackPacket,
  createPublicCase,
  decodeSharePayload,
  encodeSharePayload,
} from "./vendor/review/review-community.mjs";

const trade = {
  id: "PRIVATE-7",
  symbol: "BTCUSDT",
  side: "long",
  strategy: "breakout",
  entryTime: Date.parse("2026-01-01T10:00:00Z"),
  exitTime: Date.parse("2026-01-01T10:05:00Z"),
  durationMinutes: 5,
  entryPrice: 50000,
  exitPrice: 50500,
  stop: 49500,
  target: 51000,
  rMultiple: 1,
  mfeR: 1.4,
  maeR: .3,
  netPnl: 500,
  currency: "USD",
  notes: "private journal",
  marketBars: [
    { time: Date.parse("2026-01-01T09:59:00Z"), open: 49900, high: 50000, low: 49800, close: 49950 },
    { time: Date.parse("2026-01-01T10:00:00Z"), open: 49950, high: 50200, low: 49900, close: 50100 },
    { time: Date.parse("2026-01-01T10:01:00Z"), open: 50100, high: 50300, low: 50000, close: 50200 },
  ],
};

test("case links hide exact account fields by default and preserve chart structure", () => {
  const packet = createCasePacket({ trade, alias: "A", question: "哪里做错了？", createdAt: "2026-01-02T00:00:00Z" });
  assert.equal(packet.trade.entry, 100);
  assert.equal(packet.trade.netPnl, null);
  assert.equal(packet.trade.entryTime, null);
  assert.equal(packet.trade.notes, null);
  assert.equal(packet.chart.bars[0].open, 99.8);
  assert.equal(packet.chart.bars[0].minute, -1);
  assert.doesNotMatch(JSON.stringify(packet), /PRIVATE-7|private journal|50000|2026-01-01/);

  const decoded = decodeSharePayload(encodeSharePayload(packet));
  assert.deepEqual(decoded, packet);
});

test("private feedback stays private until the case owner selects it", () => {
  const packet = createCasePacket({ trade, alias: "owner", createdAt: "2026-01-02T00:00:00Z" });
  const first = createFeedbackPacket({ casePacket: packet, alias: "coach one", stance: "caution", thesis: "方向可以，追价不行。", plan: "等回踩，失效就退。", createdAt: "2026-01-02T01:00:00Z" });
  const second = createFeedbackPacket({ casePacket: packet, alias: "coach two", stance: "oppose", thesis: "这笔不做。", plan: "等待下一段结构。", createdAt: "2026-01-02T02:00:00Z" });
  const published = createPublicCase(packet, [first, second], [first.id], "2026-01-03T00:00:00Z");

  assert.equal(published.publicFeedback.length, 1);
  assert.equal(published.publicFeedback[0].author, "coach one");
  assert.equal(published.publicFeedback[0].visibility, "owner_selected_public");
  assert.doesNotMatch(JSON.stringify(published), /coach two/);
});
