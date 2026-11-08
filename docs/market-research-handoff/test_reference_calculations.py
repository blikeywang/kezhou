"""Synthetic arithmetic tests only. Not a backtest or a market-data check."""

import math
import unittest

import reference_calculations as c


class PriceTests(unittest.TestCase):
    def test_fall_and_recovery_are_not_symmetric(self):
        self.assertAlmostEqual(c.percent_change(80, 100), -20)
        self.assertAlmostEqual(c.percent_change(100, 80), 25)

    def test_zero_terminal_price(self):
        self.assertEqual(c.percent_change(0, 100), -100)

    def test_strike_distance_signed(self):
        self.assertAlmostEqual(c.strike_distance_pct(100, 105), 5)
        self.assertAlmostEqual(c.strike_distance_pct(100, 95), -5)

    def test_relative_percentage_points_vs_ratio(self):
        r = c.relative_performance(2, -1)
        self.assertEqual(r["difference_pp"], 3)
        self.assertAlmostEqual(r["ratio_change_pct"], 3.0303030303)

    def test_volume_ratio_vs_rvol(self):
        self.assertEqual(c.volume_ratio(300, 100), 3)
        self.assertEqual(c.rvol(300, [100, 200, 300]), 1.5)

    def test_stock_split_preserves_value(self):
        r = c.split_terms(300, 7, 3)
        self.assertEqual(r, {"price": 100, "shares": 21})
        self.assertEqual(r["price"] * r["shares"], 300 * 7)

    def test_reverse_split(self):
        self.assertEqual(c.split_terms(10, 8, 0.25), {"price": 40, "shares": 2})


class OptionTests(unittest.TestCase):
    def test_call_fees_and_breakeven(self):
        self.assertEqual(c.long_option_pnl("call", 110, 105, 2, fees=1), 299)
        r = c.long_option_metrics("call", 105, 2, fees=1)
        self.assertEqual(r["max_loss"], 201)
        self.assertAlmostEqual(r["break_even"], 107.01)
        self.assertAlmostEqual(c.long_option_pnl("call", r["break_even"], 105, 2, fees=1), 0)

    def test_call_expires_worthless(self):
        for spot in (0, 90, 105):
            with self.subTest(spot=spot):
                self.assertEqual(c.long_option_pnl("call", spot, 105, 2), -200)

    def test_put_fees_and_breakeven(self):
        r = c.long_option_metrics("put", 100, 3, fees=2)
        self.assertAlmostEqual(r["break_even"], 96.98)
        self.assertEqual(c.long_option_pnl("put", 90, 100, 3, fees=2), 698)
        self.assertAlmostEqual(c.long_option_pnl("put", r["break_even"], 100, 3, fees=2), 0)

    def test_put_no_nonnegative_breakeven(self):
        self.assertIsNone(c.long_option_metrics("put", 1, 2)["break_even"])

    def test_nonstandard_units_are_explicit(self):
        self.assertEqual(c.long_option_pnl("call", 110, 100, 2, multiplier=10, contracts=3, fees=5), 235)

    def test_bull_spread_bounds(self):
        expected = [(80, -300), (100, -300), (103, 0), (105, 200), (110, 700), (200, 700)]
        for spot, pnl in expected:
            with self.subTest(spot=spot):
                self.assertEqual(c.debit_spread_pnl("call", spot, 100, 110, 3), pnl)

    def test_bear_spread_bounds(self):
        expected = [(80, 700), (100, 700), (105, 200), (107, 0), (110, -300), (200, -300)]
        for spot, pnl in expected:
            with self.subTest(spot=spot):
                self.assertEqual(c.debit_spread_pnl("put", spot, 100, 110, 3), pnl)

    def test_spread_metrics_and_fee_breakeven(self):
        for kind, be in (("call", 103.02), ("put", 106.98)):
            with self.subTest(kind=kind):
                r = c.debit_spread_metrics(kind, 100, 110, 3, fees=2)
                self.assertEqual(r["max_loss"], 302)
                self.assertEqual(r["max_profit"], 698)
                self.assertEqual(r["max_payoff"], 1000)
                self.assertAlmostEqual(r["break_even"], be)
                self.assertAlmostEqual(c.debit_spread_pnl(kind, be, 100, 110, 3, fees=2), 0)

    def test_spread_fee_exhaustion(self):
        self.assertIsNone(c.debit_spread_metrics("call", 100, 101, 0.9, fees=11)["break_even"])

    def test_spread_equals_sum_of_legs(self):
        for spot in range(0, 151):
            call = c.long_option_pnl("call", spot, 100, 5) - c.long_option_pnl("call", spot, 110, 2)
            put = c.long_option_pnl("put", spot, 110, 5) - c.long_option_pnl("put", spot, 100, 2)
            self.assertAlmostEqual(c.debit_spread_pnl("call", spot, 100, 110, 3), call)
            self.assertAlmostEqual(c.debit_spread_pnl("put", spot, 100, 110, 3), put)

    def test_collar_all_regions_and_tail_gap(self):
        for spot, value in ((0, 10), (60, 70), (80, 90), (85, 90), (90, 90), (100, 100), (110, 110), (130, 110)):
            with self.subTest(spot=spot):
                self.assertEqual(c.put_spread_collar_value(spot, 80, 90, 110), value)


class DataFormulaTests(unittest.TestCase):
    def test_weighted_vwap(self):
        self.assertEqual(c.vwap([100, 110, 999], [1, 3, 0]), 107.5)

    def test_hv_sample_ddof(self):
        # Log returns exactly +0.1, -0.1 up to floating point rounding.
        expected = math.sqrt(0.02) * math.sqrt(252)
        self.assertAlmostEqual(c.historical_volatility([100, 100 * math.exp(0.1), 100]), expected)

    def test_flat_hv_is_zero_not_missing(self):
        self.assertEqual(c.historical_volatility([100, 100, 100]), 0)

    def test_hv_annualization_convention(self):
        prices = [100, 102, 99, 101]
        self.assertAlmostEqual(c.historical_volatility(prices, 365) / c.historical_volatility(prices, 252), math.sqrt(365 / 252))

    def test_iv_rank_and_percentile_not_same(self):
        history = [0.1, 0.2, 0.2, 0.4]
        self.assertAlmostEqual(c.iv_rank(0.2, history), 100 / 3)
        self.assertEqual(c.iv_percentile(0.2, history), 25)

    def test_iv_rank_no_silent_clipping(self):
        self.assertAlmostEqual(c.iv_rank(0.5, [0.1, 0.3]), 200)

    def test_flat_iv_percentile_strict_ties(self):
        self.assertEqual(c.iv_percentile(0.2, [0.2, 0.2]), 0)

    def test_expected_move_units(self):
        self.assertEqual(c.expected_move(100, 0.2, 0.25), 10)
        self.assertEqual(c.expected_move(100, 0.2, 0), 0)

    def test_oi_change_from_zero_and_decline(self):
        self.assertEqual(c.delta_oi(100, 0), 100)
        self.assertEqual(c.delta_oi(50, 100), -50)

    def test_put_call_ratio(self):
        self.assertEqual(c.put_call_ratio(60, 40), 1.5)
        self.assertEqual(c.put_call_ratio(0, 40), 0)

    def test_spread_pct_mid(self):
        self.assertAlmostEqual(c.bid_ask_spread_pct(1.9, 2.1), 10)
        self.assertEqual(c.bid_ask_spread_pct(0, 1), 200)

    def test_unsigned_gross_sensitivity(self):
        r = c.gross_sensitivities(-0.5, 0.02, 0.1, 10, 100)
        self.assertEqual(r, {"delta_dollars": 50000, "gamma_dollars_per_1pct": 2000, "vega_dollars_per_vol_point": 100})
        self.assertEqual(c.gross_sensitivities(0.5, -0.02, -0.1, 10, 100), r)


class ValidationTests(unittest.TestCase):
    def test_nonfinite_missing_and_boolean_rejected(self):
        for value in (None, float("nan"), float("inf"), -float("inf"), True, "100"):
            with self.subTest(value=value):
                with self.assertRaises(ValueError):
                    c.percent_change(value, 100)

    def test_invalid_denominators(self):
        cases = [lambda: c.percent_change(10, 0), lambda: c.strike_distance_pct(0, 10),
                 lambda: c.relative_performance(0, -100), lambda: c.volume_ratio(1, 0),
                 lambda: c.rvol(1, [0, 0]), lambda: c.vwap([10], [0]),
                 lambda: c.iv_rank(0.2, [0.2, 0.2]), lambda: c.put_call_ratio(1, 0),
                 lambda: c.bid_ask_spread_pct(0, 0)]
        for fn in cases:
            with self.assertRaises(ValueError):
                fn()

    def test_invalid_inputs(self):
        cases = [lambda: c.long_option_pnl("CALL", 100, 100, 2),
                 lambda: c.long_option_pnl("call", -1, 100, 2),
                 lambda: c.long_option_pnl("call", 100, 100, -2),
                 lambda: c.long_option_metrics("call", 100, 2, contracts=1.5),
                 lambda: c.long_option_metrics("put", 100, 2, contracts=0),
                 lambda: c.long_option_metrics("put", 100, 2, multiplier=0),
                 lambda: c.debit_spread_metrics("call", 110, 100, 3),
                 lambda: c.debit_spread_metrics("put", 100, 110, 10),
                 lambda: c.debit_spread_metrics("put", 100, 110, 0),
                 lambda: c.put_spread_collar_value(100, 90, 80, 110),
                 lambda: c.split_terms(100, 1, 0),
                 lambda: c.vwap([10, 20], [1]), lambda: c.vwap([10], [-1]),
                 lambda: c.rvol(1, []), lambda: c.historical_volatility([1, 2]),
                 lambda: c.historical_volatility([1, 0, 2]),
                 lambda: c.iv_rank(0.2, []), lambda: c.iv_percentile(0.2, []),
                 lambda: c.expected_move(100, -0.2, 1), lambda: c.expected_move(100, 0.2, -1),
                 lambda: c.delta_oi(-1, 0), lambda: c.delta_oi(1.5, 0),
                 lambda: c.bid_ask_spread_pct(2, 1),
                 lambda: c.gross_sensitivities(0.5, 0.02, 0.1, -1, 100)]
        for index, fn in enumerate(cases):
            with self.subTest(index=index):
                with self.assertRaises(ValueError):
                    fn()


if __name__ == "__main__":
    unittest.main()
