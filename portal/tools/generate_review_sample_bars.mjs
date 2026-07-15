import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const output = resolve(here, "../vendor/review/sample-bars.csv");
const start = Date.parse("2026-05-13T06:50:00Z");
const anchors = [
  [0, 96720],
  [30, 96860],
  [50, 96980],
  [59, 97092],
  [60, 97110],
  [90, 97380],
  [100, 97320],
  [115, 97180],
  [132, 96984],
  [160, 97040],
];

function centerAt(index) {
  const rightIndex = anchors.findIndex(([point]) => point >= index);
  if (rightIndex <= 0) return anchors[0][1];
  const [leftPoint, leftPrice] = anchors[rightIndex - 1];
  const [rightPoint, rightPrice] = anchors[rightIndex];
  const progress = (index - leftPoint) / (rightPoint - leftPoint);
  return leftPrice + (rightPrice - leftPrice) * progress;
}

const rows = ["symbol,time,open,high,low,close,volume"];
let previousClose = centerAt(0);
for (let index = 0; index <= 160; index += 1) {
  let close = centerAt(index) + Math.sin(index * .73) * 2.4;
  if ([59, 60, 90, 132].includes(index)) close = centerAt(index);
  const open = index === 0 ? close - 2 : previousClose;
  const high = Math.max(open, close) + 6 + index % 3;
  const low = Math.min(open, close) - 6 - index % 2;
  const time = new Date(start + index * 60000).toISOString();
  rows.push(["BTCUSDT", time, open.toFixed(2), high.toFixed(2), low.toFixed(2), close.toFixed(2), 120 + index % 37].join(","));
  previousClose = close;
}

mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${rows.join("\n")}\n`, "utf8");
console.log(`Wrote ${rows.length - 1} bars to ${output}`);
