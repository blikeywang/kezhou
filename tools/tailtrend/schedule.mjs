import { isTradingDay } from '../scheduler/refresh-runner.mjs';

// A prospective policy, never a reinterpretation of old missing snapshots.
export const TAILTREND_SCHEDULE = Object.freeze({
  version: 'weekly-close-v1', effectiveFrom: '2026-11-10',
  frequency: 'weekly', timezone: 'America/New_York',
  sampleUnit: 'signal_observation', forwardUnit: 'trading_session',
});
export function scheduledSessionForWeek(dateText) {
  const day = new Date(`${dateText}T12:00:00Z`);
  const weekday = day.getUTCDay();
  day.setUTCDate(day.getUTCDate() + (5 - (weekday || 7)));
  while (!isTradingDay(day.toISOString().slice(0, 10))) day.setUTCDate(day.getUTCDate() - 1);
  return day.toISOString().slice(0, 10);
}
export function isPlannedNonRun(dateText) {
  return dateText >= TAILTREND_SCHEDULE.effectiveFrom &&
    isTradingDay(dateText) && dateText !== scheduledSessionForWeek(dateText);
}

// Refuse horizon counting across absent trading bars; a weekly fetch can
// backfill observed prices, never backdate a signal or silently skip a session.
export function assertAuditContinuity(ledger, barsBySymbol, through) {
  for (const entry of ledger?.entries ?? []) {
    const reference = entry.execution?.alertReference;
    if (reference === null || reference === undefined || reference === "" || !Number.isFinite(Number(reference)) || Number(reference) <= 0) continue;
    const after = entry.forward?.lastObservedDate ?? entry.originDate;
    if (!after || after >= through) continue;
    const bars = new Map((barsBySymbol.get(entry.symbol) ?? []).map(bar => [bar.date, bar]));
    const day = new Date(`${after}T12:00:00Z`);
    day.setUTCDate(day.getUTCDate() + 1);
    for (; day.toISOString().slice(0, 10) <= through; day.setUTCDate(day.getUTCDate() + 1)) {
      const date = day.toISOString().slice(0, 10);
      if (!isTradingDay(date)) continue;
      const bar = bars.get(date);
      if (!bar || !['open', 'high', 'low'].every(key => Number.isFinite(bar[key]))) {
        throw new Error(`AUDIT_CONTINUITY_GAP ${entry.symbol} ${date}: restore daily bars before counting trading-session horizons`);
      }
    }
  }
}
