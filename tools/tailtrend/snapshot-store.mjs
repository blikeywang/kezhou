import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  }
  return value;
}

export function sha256Json(value) {
  return createHash("sha256").update(JSON.stringify(stableValue(value))).digest("hex");
}

export async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return fallback;
    throw error;
  }
}

export function findMissingTradingDates(index, calendarDates, currentDate) {
  const entries = Array.isArray(index?.entries) ? index.entries : [];
  if (!entries.length) return [];
  const known = new Set(entries.map((entry) => entry.dataAsOf));
  const lastKnown = entries.map((entry) => entry.dataAsOf).filter(Boolean).sort().at(-1);
  return [...new Set(calendarDates ?? [])]
    .filter((date) => date > lastKnown && date < currentDate && !known.has(date))
    .sort();
}

function missingSnapshot(date, runAt, metadata, reason = "NO_COMPLETE_REFRESH") {
  const health = metadata.health ?? { fresh: 0, cached: 0, stale: 0, error: 0, missing: metadata.symbols ?? [], errors: [] };
  return {
    schema: metadata.schema,
    version: metadata.version,
    frameworkVersion: metadata.frameworkVersion,
    status: "MISSING",
    dataAsOf: date,
    tradingDate: date,
    runAt,
    asOf: runAt,
    engineVersion: metadata.engineVersion,
    engineSourceHash: metadata.engineSourceHash,
    paramsHash: metadata.paramsHash,
    missingReason: reason,
    mode: "missing",
    source: metadata.source ?? "Longbridge Securities",
    sourceMethod: metadata.sourceMethod ?? "daily OHLCV · forward adjusted · regular session",
    signalTimeframe: "daily_close",
    universe: { version: metadata.universeVersion ?? null, description: metadata.universeDescription ?? "TailTrend research universe", requested: metadata.requested ?? 0, published: 0 },
    health,
    dataQuality: {
      fresh: health.fresh ?? 0,
      cached: health.cached ?? 0,
      stale: health.stale ?? 0,
      missing: Array.isArray(health.missing) ? health.missing.length : Number(health.missing) || 0,
      errors: health.errors ?? [],
    },
    summary: { records: 0, actionable: 0, blocked: 0, bucketCounts: {}, stateCounts: {} },
    transitions: [],
    records: [],
    researchStatus: "shadow_test_missing_observation",
    privacy: metadata.privacy,
  };
}

async function writeImmutable(path, value) {
  try {
    await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    return { created: true, value };
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    return { created: false, value: await readJson(path, null) };
  }
}

function indexEntry(snapshot) {
  return {
    dataAsOf: snapshot.dataAsOf ?? snapshot.tradingDate,
    status: snapshot.status ?? (snapshot.mode === "complete" ? "COMPLETE" : "MISSING"),
    file: `snapshots/${snapshot.dataAsOf ?? snapshot.tradingDate}.json`,
    runAt: snapshot.runAt ?? snapshot.asOf,
    engineVersion: snapshot.engineVersion ?? null,
    engineSourceHash: snapshot.engineSourceHash ?? null,
    paramsHash: snapshot.paramsHash ?? null,
    summary: snapshot.summary ?? null,
    health: snapshot.health ?? snapshot.dataQuality ?? null,
    transitions: snapshot.transitions ?? [],
  };
}

function staleLatest(snapshot, latestEntry) {
  if (!snapshot || latestEntry?.status !== "MISSING") return snapshot;
  const missingDate = latestEntry.dataAsOf;
  return {
    ...snapshot,
    mode: "stale_after_missing_run",
    displayStatus: "LATEST_COMPLETE_WITH_MISSING_DAY",
    missingDataAsOf: missingDate,
    records: (snapshot.records ?? []).map((record) => ({
      ...record,
      dataStatus: "STALE",
      newPositionAllowed: false,
      riskModule: null,
      blockers: [...new Set([...(record.blockers ?? []), `缺少 ${missingDate} 完整快照，旧状态不得触发新仓`])],
    })),
  };
}

export async function persistDailySnapshots({ dataDir, snapshot, calendarDates = [] }) {
  const snapshotsDir = resolve(dataDir, "snapshots");
  const indexPath = resolve(dataDir, "index.json");
  const latestPath = resolve(dataDir, "latest.json");
  const compatibilityPath = resolve(dataDir, "tailtrend-snapshot.json");
  await mkdir(snapshotsDir, { recursive: true });

  const previousIndex = await readJson(indexPath, { schema: "traderhome_tailtrend_snapshot_index_v1", entries: [] });
  const metadata = {
    schema: snapshot.schema,
    version: snapshot.version,
    frameworkVersion: snapshot.frameworkVersion,
    engineVersion: snapshot.engineVersion,
    engineSourceHash: snapshot.engineSourceHash,
    paramsHash: snapshot.paramsHash,
    requested: snapshot.universe?.requested,
    symbols: snapshot.universe?.symbols,
    universeVersion: snapshot.universe?.version,
    universeDescription: snapshot.universe?.description,
    source: snapshot.source,
    sourceMethod: snapshot.sourceMethod,
    privacy: snapshot.privacy,
  };
  const generatedMissing = [];
  for (const date of findMissingTradingDates(previousIndex, calendarDates, snapshot.dataAsOf)) {
    const placeholder = missingSnapshot(date, snapshot.runAt, metadata);
    const result = await writeImmutable(resolve(snapshotsDir, `${date}.json`), placeholder);
    if (result.created) generatedMissing.push(date);
  }

  const official = snapshot.mode === "complete"
    ? { ...snapshot, status: "COMPLETE" }
    : missingSnapshot(snapshot.dataAsOf, snapshot.runAt, {
      ...metadata,
      health: snapshot.health ?? snapshot.dataQuality,
    }, "INCOMPLETE_REFRESH");
  const persisted = await writeImmutable(resolve(snapshotsDir, `${snapshot.dataAsOf}.json`), official);

  const files = (await readdir(snapshotsDir)).filter((name) => /^\d{4}-\d{2}-\d{2}\.json$/.test(name)).sort();
  const daily = await Promise.all(files.map((name) => readJson(resolve(snapshotsDir, name), null)));
  const entries = daily.filter(Boolean).map(indexEntry).sort((left, right) => right.dataAsOf.localeCompare(left.dataAsOf));
  const index = {
    schema: "traderhome_tailtrend_snapshot_index_v1",
    version: 1,
    updatedAt: snapshot.runAt,
    latestDataAsOf: entries[0]?.dataAsOf ?? null,
    latestCompleteDataAsOf: entries.find((entry) => entry.status === "COMPLETE")?.dataAsOf ?? null,
    missingDates: entries.filter((entry) => entry.status === "MISSING").map((entry) => entry.dataAsOf),
    entries,
  };
  await writeFile(indexPath, `${JSON.stringify(index, null, 2)}\n`, "utf8");

  const latestCompleteEntry = entries.find((entry) => entry.status === "COMPLETE");
  const latestComplete = latestCompleteEntry
    ? await readJson(resolve(dataDir, latestCompleteEntry.file), null)
    : null;
  const displayLatest = latestComplete
    ? staleLatest(latestComplete, entries[0])
    : entries[0] ? await readJson(resolve(dataDir, entries[0].file), null) : null;
  if (displayLatest) {
    await writeFile(latestPath, `${JSON.stringify(displayLatest, null, 2)}\n`, "utf8");
    await writeFile(compatibilityPath, `${JSON.stringify(displayLatest, null, 2)}\n`, "utf8");
  }
  return {
    persistedSnapshot: persisted.value,
    created: persisted.created,
    generatedMissing,
    index,
    displayLatest,
  };
}
