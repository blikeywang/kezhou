import unittest
from unittest.mock import patch
from crypto_flow import STEP, LAG, Client, align, collect_asset, divergences, stream, window

START = 1_790_000_100_000 // STEP * STEP


def data(n=80):
    flow, candles, oi = [], [], []
    for i in range(n):
        t = START+i*STEP
        flow.append([str(t), '3', '7'])
        candles.append([str(t), '100', '102', '99', '101', '1000', '10', '1010', '1'])
        oi.append([str(t+STEP), '10000', '100', '10100'])
    return flow, candles, oi


class CryptoFlowTests(unittest.TestCase):
    def test_direction_units_sort_dedupe_and_closed_boundary(self):
        f, c, o = data()
        now = START+80*STEP+LAG
        rows, _ = align(list(reversed(f))+[f[0]], c, o, now, True)
        self.assertEqual(len(rows), 80)
        self.assertEqual(rows[0]['delta'], 4)
        self.assertEqual(rows[-1]['cvd'], 320)
        self.assertEqual(rows[-1]['oi'], 100)
        self.assertEqual(rows[-1]['volumeCoverage'], 1)
        c[-1][-1] = '0'
        self.assertEqual(len(align(f, c, o, now, True)[0]), 79)
        self.assertEqual(len(align(f, data()[1], o, now-STEP, True)[0]), 79)

    def test_missing_bucket_resets_cvd_and_blocks_long_window(self):
        f, c, o = data()
        del f[-10]
        rows, dropped = align(f, c, o, START+80*STEP+LAG, True)
        self.assertEqual(len(rows), 9)
        self.assertEqual(dropped, 70)
        self.assertEqual(rows[0]['cvd'], 4)
        self.assertEqual(window(rows, 12, True)['status'], 'insufficient')
        self.assertEqual(divergences(rows), [])

    def test_oi_is_coin_quantity_not_price_driven_usd_valuation(self):
        f, c, o = data()
        o[-1][-1] = '20200'
        rows, _ = align(f, c, o, START+80*STEP+LAG, True)
        w = window(rows, 12, True)
        self.assertEqual(w['oiPct'], 0)
        self.assertEqual(w['oiUsdPct'], 100)
        self.assertEqual(w['delta'], 48)
        del rows[-3]['oi']
        w = window(rows, 12, True)
        self.assertEqual(w['oiStatus'], 'incomplete')
        self.assertNotIn('oiPct', w)
        self.assertEqual(w['status'], 'ok')

    def test_divergence_is_known_before_confirmation_not_a_backfilled_entry(self):
        f, c, o = data(52)
        f[48][1:3] = ['300', '0']
        c[49][4] = '103'
        c[49][2] = '104'
        rows, _ = align(f, c, o, START+52*STEP+LAG, True)
        first = divergences(rows[:49])[-1]
        self.assertEqual(first['kind'], 'bullish')
        self.assertEqual(first['status'], 'candidate')
        self.assertNotIn('confirmedAt', first)
        later = divergences(rows)[-1]
        self.assertEqual(later['observedAt'], first['observedAt'])
        self.assertEqual(later['status'], 'confirmed')
        self.assertGreater(later['confirmedAt'], later['observedAt'])
        rows[-1]['close'] = 97
        self.assertEqual(divergences(rows)[-1]['status'], 'invalidated')

    def test_a_late_breakout_cannot_revive_an_expired_candidate(self):
        f, c, o = data(64)
        f[48][1:3] = ['300', '0']
        c[-1][2], c[-1][4] = '104', '103'
        rows, _ = align(f, c, o, START+64*STEP+LAG, True)
        event = next(e for e in divergences(rows) if e['observedAt'] == rows[48]['time'])
        self.assertEqual(event['status'], 'expired')
        self.assertNotIn('confirmedAt', event)

    def test_lower_price_low_does_not_count_as_bullish_absorption(self):
        f, c, o = data(49)
        f[-1][1:3] = ['300', '0']
        c[-1][3] = '97'
        rows, _ = align(f, c, o, START+49*STEP+LAG, True)
        self.assertEqual(divergences(rows), [])

    def test_stale_data_has_no_actionable_divergence(self):
        f, c, o = data(49)
        f[-1][1:3] = ['300', '0']
        result = stream('BTC', 'perpetual', f, c, o, START+49*STEP+60*60_000)
        self.assertEqual(result['status'], 'stale')
        self.assertEqual(result['divergences'], [])

    def test_pagination_explicitly_requests_coin_unit_and_older_cursor(self):
        client = Client()
        calls = []
        def fetch(path, params):
            calls.append(dict(params))
            t = 1000-len(calls)*100
            return [[str(t), '1', '2']]
        with patch.object(client, 'get', side_effect=fetch), patch('crypto_flow.time.sleep'):
            rows = client.history('/unused', {'unit': '0'})
        self.assertEqual(len(rows), 3)
        self.assertTrue(all(p['unit'] == '0' for p in calls))
        self.assertEqual(calls[1]['end'], 900)

    def test_source_failure_is_unavailable_not_zero(self):
        class Offline:
            def get(self, *args): raise OSError('private internal diagnostic')
            history = get
        result = collect_asset('BTC', START, Offline())
        for name in ('spot', 'perpetual'):
            self.assertEqual(result[name]['status'], 'unavailable')
            self.assertEqual(result[name]['windows'], {})
            self.assertNotIn('private internal', str(result))


if __name__ == '__main__':
    unittest.main()
