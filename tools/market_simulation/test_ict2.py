import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))
import ict2  # noqa: E402

M5, H1, H4, D1 = ict2.M5, ict2.H1, ict2.H4, ict2.D1
# 2026-11-25 03:00 New York (EST, UTC-5) = 08:00 UTC: inside the London Kill Zone.
CONF_CLOSE = 1795564800000 + 8 * H1


def bar(t, o, h, l, c):
    return {'time': t, 'open': o, 'high': h, 'low': l, 'close': c, 'volume': 1}


def scenario(conf_close=CONF_CLOSE, extra_after=0):
    """Long setup: swing low 99.5 -> swing high 100.6 -> sweep to 99.3 -> displacement + FVG -> OB retest."""
    n_base = 60
    start = conf_close - (n_base + 14 + extra_after) * M5
    rows = [bar(start + i * M5, 100, 100.15, 99.85, 100) for i in range(n_base)]
    k = n_base
    shape = [
        (100, 100.15, 99.85, 100), (100, 100.15, 99.7, 99.9), (99.9, 100.0, 99.5, 99.8),  # k+2: swing low 99.5
        (99.8, 100.1, 99.7, 100.0), (100.0, 100.15, 99.85, 100.1),
        (100.1, 100.3, 99.9, 100.2), (100.2, 100.6, 100.0, 100.3),  # k+6: swing high 100.6
        (100.3, 100.35, 99.9, 100.0), (99.9, 100.1, 99.85, 100.0),
        (99.9, 99.95, 99.3, 99.6),     # k+9 sweep, bearish -> order block
        (99.6, 100.6, 99.55, 100.5),   # displacement
        (100.5, 100.9, 100.2, 100.8),  # MSS close above 100.6, FVG 99.95-100.2
        (100.8, 100.85, 100.3, 100.4),
        (100.4, 100.45, 99.9, 100.0),  # touches OB, closes above its mean: confirmation
    ]
    for j, (o, h, l, c) in enumerate(shape):
        rows.append(bar(start + (k + j) * M5, o, h, l, c))
    for j in range(extra_after):
        rows.append(bar(start + (k + len(shape) + j) * M5, 100.0, 100.1, 99.9, 100.05))
    sweep_index = k + 9
    # H4: swing low 92, prior high 98, breakout to 110, pull back towards 100.
    path = [96, 94, 92, 94, 96, 98, 96, 95, 97, 100, 104, 108, 110, 108, 106, 104, 102, 101, 100.5, 100.2]
    h4_end = (conf_close // H4) * H4
    h4_start = h4_end - len(path) * H4
    hourly = []
    for i, p in enumerate(path):
        for q in range(4):
            hourly.append(bar(h4_start + i * H4 + q * H1, p, p + 0.5, p - 0.5, p))
    day0 = (conf_close // D1) * D1
    daily = [bar(day0 - (30 - i) * D1, 100, 111, 91, 100) for i in range(30)]
    return {'symbol': 'ETH', 'executionBars': rows, 'contextBars': hourly, 'dailyBars': daily}, sweep_index


def flow_doc(bars, sweep_index, displacement_buy=30, now=None):
    series = []
    for i, b in enumerate(bars):
        buy, sell = 20, 20
        if i == sweep_index:
            buy, sell = 10, 40
        elif i in (sweep_index + 1, sweep_index + 2):
            buy, sell = displacement_buy, 10 if displacement_buy > 10 else 30
        series.append({'time': b['time'] + M5, 'buy': buy, 'sell': sell, 'oi': 1000 - (5 if i == sweep_index else 0) + (i - sweep_index if i > sweep_index else 0)})
    return {'assets': [{'symbol': 'ETH', 'perpetual': {'series': series}}]}


class KillZoneTest(unittest.TestCase):
    def test_new_york_daylight_saving_moves_utc_window(self):
        # 08:00 New York is 13:00 UTC on 2026-03-06 (EST) and 12:00 UTC on 2026-03-09 (EDT).
        est = 1772755200000 + 13 * H1 + 5 * 60_000
        edt = 1773014400000 + 12 * H1 + 5 * 60_000
        self.assertEqual(ict2.in_kill_zone('BTC', est)['name'], '纽约上午')
        self.assertEqual(ict2.in_kill_zone('BTC', edt)['name'], '纽约上午')
        self.assertIsNone(ict2.in_kill_zone("BTC", est - 2 * H1))
        self.assertIsNone(ict2.in_kill_zone('CL', est))  # CL opens at 09:00 New York


class StructureTest(unittest.TestCase):
    def test_bias_requires_h4_break_and_no_daily_conflict(self):
        market, _ = scenario()
        now = CONF_CLOSE + 60_000
        bias = ict2.htf_bias(ict2.closed(market['dailyBars'], D1, now), ict2.h4_bars(ict2.closed(market['contextBars'], H1, now)))
        self.assertEqual((bias['d1'], bias['h4'], bias['side']), ('neutral', 'bull', 'long'))
        self.assertEqual((bias['rangeHigh'], bias['rangeLow']), (110.5, 94.5))


class EvaluateTest(unittest.TestCase):
    def run_eval(self, market, flow=None, state=None, now=CONF_CLOSE + 60_000, symbol='ETH'):
        state = state or {'cash': 100_000.0, 'trades': [], 'processedThrough': 0}
        return ict2.evaluate(symbol, market, flow, state, now)

    def test_full_setup_is_ready_with_order_flow(self):
        market, s = scenario()
        report, signal = self.run_eval(market, flow_doc(market['executionBars'], s))
        self.assertEqual(report['stage'], 'ready', report.get('reason'))
        self.assertEqual(signal['side'], 1)
        self.assertEqual(report['ob']['low'], 99.3)
        self.assertEqual(report['flow']['verdict'], 'pass')
        self.assertLess(signal['stop'], 99.3)
        self.assertGreaterEqual(signal['netRR'], ict2.MIN_NET_R)
        self.assertEqual(signal['kz']['name'], '伦敦')

    def test_aggressive_selling_during_displacement_rejects(self):
        market, s = scenario()
        report, signal = self.run_eval(market, flow_doc(market['executionBars'], s, displacement_buy=10))
        self.assertEqual(report['stage'], 'flow_reject')
        self.assertIsNone(signal)

    def test_missing_flow_is_unavailable_not_pass(self):
        market, s = scenario()
        report, signal = self.run_eval(market, None)
        self.assertEqual(report['flow']['verdict'], 'unavailable')
        self.assertEqual(report['stage'], 'ready')  # unavailable is recorded, it does not veto
        market['symbol'] = 'CL'
        report, _ = self.run_eval(market, None, symbol='CL')
        self.assertNotEqual(report.get('flow', {}).get('verdict'), 'pass')

    def test_outside_kill_zone_waits(self):
        market, s = scenario(conf_close=CONF_CLOSE + 5 * H1)  # 08:00 New York; ETH London zone is over
        report, signal = self.run_eval(market, flow_doc(market['executionBars'], s), now=CONF_CLOSE + 5 * H1 + 60_000)
        self.assertIn(report['stage'], ('outside_kz', 'ready'))
        # 08:00 NY sits inside ETH's 07:00-10:00 New York zone, so move further: 06:00 NY.
        market, s = scenario(conf_close=CONF_CLOSE + 3 * H1)
        report, signal = self.run_eval(market, flow_doc(market['executionBars'], s), now=CONF_CLOSE + 3 * H1 + 60_000)
        self.assertEqual(report['stage'], 'outside_kz')
        self.assertIsNone(signal)

    def test_already_seen_confirmation_is_not_back_filled(self):
        market, s = scenario()
        state = {'cash': 100_000.0, 'trades': [], 'processedThrough': CONF_CLOSE}
        report, signal = self.run_eval(market, flow_doc(market['executionBars'], s), state=state)
        self.assertEqual(report['stage'], 'invalid')
        self.assertIsNone(signal)

    def test_future_bars_do_not_change_frozen_event(self):
        market, s = scenario(extra_after=3)
        now = CONF_CLOSE + 60_000
        truncated = {**market, 'executionBars': [b for b in market['executionBars'] if b['time'] + M5 <= CONF_CLOSE]}
        a, _ = self.run_eval(truncated, None, now=now)
        b, _ = self.run_eval(market, None, now=now)  # bars after now are ignored as unclosed
        self.assertEqual((a['stage'], a.get('eventId'), a.get('ob')), (b['stage'], b.get('eventId'), b.get('ob')))


class LedgerTest(unittest.TestCase):
    def test_step_opens_once_and_stop_wins_same_bar(self):
        market, s = scenario()
        latest = {'markets': [market], 'cryptoOrderFlow': flow_doc(market['executionBars'], s)}
        state = ict2.fresh_state(CONF_CLOSE)
        out = ict2.step(state, latest, CONF_CLOSE + 60_000)
        self.assertEqual(len(out['trades']), 1)
        out = ict2.step({k: v for k, v in out.items() if k not in ('reports', 'metrics', 'label', 'rules')}, latest, CONF_CLOSE + 120_000)
        self.assertEqual(len(out['trades']), 1)
        trade = out['trades'][0]
        later = bar(CONF_CLOSE, 100, 120, 90, 100)  # both stop and target inside one bar
        market['executionBars'].append(later)
        out = ict2.step({k: v for k, v in out.items() if k not in ('reports', 'metrics', 'label', 'rules')}, latest, CONF_CLOSE + M5 + 60_000)
        trade = out['trades'][0]
        self.assertEqual(trade['reason'], '触及原始止损')
        self.assertLess(trade['pnl'], 0)
        self.assertAlmostEqual(out['cash'], 100_000 + trade['pnl'])
        self.assertEqual(out['metrics']['closed'], 1)


class PersistenceTest(unittest.TestCase):
    def test_transient_failure_without_cache_does_not_reset(self):
        with mock.patch('urllib.request.urlopen', side_effect=TimeoutError()):
            prev, errors = ict2.load_previous('https://example.invalid/ict2.json', None)
        self.assertIsNone(prev)
        self.assertTrue(errors)

    def test_newest_of_cache_and_published_wins(self):
        newer = {**ict2.fresh_state(1), 'updated': 50}
        with tempfile.TemporaryDirectory() as d:
            cache = Path(d) / 'ict2.json'
            cache.write_text(json.dumps(newer))
            with mock.patch('urllib.request.urlopen', side_effect=TimeoutError()):
                prev, _ = ict2.load_previous('https://example.invalid/ict2.json', cache)
        self.assertEqual(prev['updated'], 50)


if __name__ == '__main__':
    unittest.main()
