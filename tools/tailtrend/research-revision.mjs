import {createHash} from 'node:crypto';
import {mkdir, readFile, writeFile, rename, unlink} from 'node:fs/promises';
import {resolve} from 'node:path';
import {assertTailtrendQuality, snapshotHashes, assertHistoryUnchanged} from './publication-quality.mjs';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export function assertNoRevisionDowngrade(latest, incomingDate) {
  if (latest?.revision && incomingDate <= latest.dataAsOf) {
    throw new Error('Existing research revision display must not be downgraded; wait for a new session or explicitly publish a new-engine research revision');
  }
}
const protectedFiles = ['index.json', 'tailtrend-audit.json', 'run-history.json'];
export async function persistResearchRevision({dataDir, snapshot, expectedDate}) {
  assertTailtrendQuality(snapshot, expectedDate);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expectedDate) || !/^[a-f0-9]{64}$/.test(snapshot.engineSourceHash ?? '')) {
    throw new Error('Revision requires a valid session and full engine hash');
  }
  const originalPath = `snapshots/${expectedDate}.json`;
  const originalBytes = await readFile(resolve(dataDir, originalPath));
  const original = JSON.parse(originalBytes);
  if (original.status !== 'COMPLETE' || original.dataAsOf !== expectedDate || original.revision) {
    throw new Error('Revision requires an original COMPLETE same-session snapshot');
  }
  if (original.engineSourceHash === snapshot.engineSourceHash) throw new Error('Revision requires a different engine');
  if (!Number.isFinite(Date.parse(snapshot.runAt)) || !Number.isFinite(Date.parse(original.runAt))
      || Date.parse(snapshot.runAt) <= Date.parse(original.runAt)) throw new Error('Invalid revision run time');
  const historyBefore = await snapshotHashes(resolve(dataDir, 'snapshots'));
  const protectedBefore = Object.fromEntries(await Promise.all(protectedFiles.map(async name =>
    [name, digest(await readFile(resolve(dataDir, name)))])));
  const revisionsBefore = await snapshotHashes(resolve(dataDir, 'revisions'));
  const filename = `revisions/${expectedDate}-${snapshot.engineSourceHash}.json`;
  const revision = {
    ...snapshot, status: 'COMPLETE', researchStatus: 'retrospective_research_revision_not_original_signal',
    revision: {
      kind: 'RETROSPECTIVE_RESEARCH_REVISION',
      label: '事后新版研究重算，非当时信号',
      originalSnapshot: originalPath, originalRunAt: original.runAt,
      originalEngineSourceHash: original.engineSourceHash,
      originalSnapshotSha256: digest(originalBytes),
      revisedAt: snapshot.runAt, file: filename,
      historicalAuditUnchanged: true,
    },
    // These observations were reconstructed now, not transitions published then.
    transitions: [],
    records: snapshot.records.map(record => ({...record, change: null,
      prevState: null, previousObservationDate: null,
      transitionReason: [], observationKind: 'RETROSPECTIVE_RESEARCH_REVISION'})),
  };
  assertTailtrendQuality(revision, expectedDate, {persisted: true});
  const encoded = `${JSON.stringify(revision, null, 2)}\n`;
  await mkdir(resolve(dataDir, 'revisions'), {recursive: true});
  // Exclusive creation: a repeated engine/session may not overwrite its evidence.
  await writeFile(resolve(dataDir, filename), encoded, {encoding: 'utf8', flag: 'wx'});
  const verifyProtected = async () => {
    assertHistoryUnchanged(historyBefore, await snapshotHashes(resolve(dataDir, 'snapshots')));
    assertHistoryUnchanged(revisionsBefore, await snapshotHashes(resolve(dataDir, 'revisions')));
    for (const name of protectedFiles) if (digest(await readFile(resolve(dataDir, name))) !== protectedBefore[name]) {
      throw new Error(`Revision historical file changed: ${name}`);
    }
  };
  await verifyProtected();
  // Atomic per alias. If a process stops between aliases, rerun must not overwrite
  // the revision; read back the existing immutable revision to diagnose/recover.
  for (const alias of ['latest.json', 'tailtrend-snapshot.json']) {
    const temp = resolve(dataDir, `.${alias}.${process.pid}.revision.tmp`);
    try {
      await writeFile(temp, encoded, {encoding: 'utf8', flag: 'wx'});
      await rename(temp, resolve(dataDir, alias));
    } finally { await unlink(temp).catch(error => {if (error.code !== 'ENOENT') throw error;}); }
  }
  await verifyProtected();
  for (const name of [filename, 'latest.json', 'tailtrend-snapshot.json']) {
    if (await readFile(resolve(dataDir, name), 'utf8') !== encoded) throw new Error(`Revision readback mismatch: ${name}`);
  }
  return {revision, file: filename};
}
