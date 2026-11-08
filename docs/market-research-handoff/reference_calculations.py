"""Pure, offline research arithmetic. No market feed, files, accounts or orders.

Prices are per underlying unit; IV is a decimal, returns are percentages.
Expiry payoff functions are NOT pre-expiry valuations. Adjusted contracts must
be normalized from their actual terms before using these simple formulas.
All inputs must be finite; missing values raise ValueError instead of becoming 0.
"""

from __future__ import annotations

import math
import statistics
from collections.abc import Sequence


def _finite(value: float, name: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{name} must be a finite number")
    result = float(value)
    if not math.isfinite(result):
        raise ValueError(f"{name} must be finite")
    return result


def _positive(value: float, name: str) -> float:
    result = _finite(value, name)
    if result <= 0:
        raise ValueError(f"{name} must be positive")
    return result


def _nonnegative(value: float, name: str) -> float:
    result = _finite(value, name)
    if result < 0:
        raise ValueError(f"{name} must be nonnegative")
    return result


def _count(value: int, name: str, *, positive: bool = False) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise ValueError(f"{name} must be an integer")
    if value < (1 if positive else 0):
        raise ValueError(f"{name} has an invalid count")
    return value


def _units(multiplier: float, contracts: int) -> float:
    return _positive(multiplier, "multiplier") * _count(contracts, "contracts", positive=True)


def _kind(kind: str) -> str:
    if kind not in {"call", "put"}:
        raise ValueError("kind must be 'call' or 'put'")
    return kind


def percent_change(current: float, base: float) -> float:
    return (_nonnegative(current, "current") / _positive(base, "base") - 1) * 100


def strike_distance_pct(spot: float, strike: float) -> float:
    return (_positive(strike, "strike") / _positive(spot, "spot") - 1) * 100


def relative_performance(return_a_pct: float, return_b_pct: float) -> dict[str, float]:
    a = _finite(return_a_pct, "return_a_pct")
    b = _finite(return_b_pct, "return_b_pct")
    if a < -100 or b <= -100:
        raise ValueError("A must be >= -100%; B must be > -100%")
    return {"difference_pp": a - b, "ratio_change_pct": ((100 + a) / (100 + b) - 1) * 100}


def volume_ratio(volume: float, baseline_volume: float) -> float:
    return _nonnegative(volume, "volume") / _positive(baseline_volume, "baseline_volume")


def rvol(volume: float, prior_full_session_volumes: Sequence[float]) -> float:
    if not prior_full_session_volumes:
        raise ValueError("RVOL needs prior comparable sessions")
    history = [_nonnegative(v, "history volume") for v in prior_full_session_volumes]
    return volume_ratio(volume, statistics.mean(history))


def long_option_pnl(kind: str, terminal_spot: float, strike: float, premium: float,
                    *, multiplier: float = 100, contracts: int = 1, fees: float = 0) -> float:
    kind = _kind(kind)
    s = _nonnegative(terminal_spot, "terminal_spot")
    k = _positive(strike, "strike")
    p = _nonnegative(premium, "premium")
    intrinsic = max(s - k, 0) if kind == "call" else max(k - s, 0)
    return (intrinsic - p) * _units(multiplier, contracts) - _nonnegative(fees, "fees")


def long_option_metrics(kind: str, strike: float, premium: float,
                        *, multiplier: float = 100, contracts: int = 1,
                        fees: float = 0) -> dict[str, float | None]:
    kind = _kind(kind)
    k = _positive(strike, "strike")
    p = _nonnegative(premium, "premium")
    units = _units(multiplier, contracts)
    f = _nonnegative(fees, "fees")
    cost = p * units + f
    be = k + cost / units if kind == "call" else k - cost / units
    return {"max_loss": cost, "break_even": be if be >= 0 else None}


def _spread_terms(low_strike: float, high_strike: float, debit: float) -> tuple[float, float, float]:
    low = _positive(low_strike, "low_strike")
    high = _positive(high_strike, "high_strike")
    d = _positive(debit, "debit")
    if not 0 < d < high - low:
        raise ValueError("debit spread requires 0 < debit < high_strike - low_strike")
    return low, high, d


def debit_spread_pnl(kind: str, terminal_spot: float, low_strike: float,
                     high_strike: float, debit: float, *, multiplier: float = 100,
                     contracts: int = 1, fees: float = 0) -> float:
    """kind=call: bull call; kind=put: bear put; same expiry/units/deliverable."""
    kind = _kind(kind)
    s = _nonnegative(terminal_spot, "terminal_spot")
    low, high, d = _spread_terms(low_strike, high_strike, debit)
    raw = s - low if kind == "call" else high - s
    payoff = min(max(raw, 0), high - low)
    return (payoff - d) * _units(multiplier, contracts) - _nonnegative(fees, "fees")


def debit_spread_metrics(kind: str, low_strike: float, high_strike: float,
                         debit: float, *, multiplier: float = 100, contracts: int = 1,
                         fees: float = 0) -> dict[str, float | None]:
    kind = _kind(kind)
    low, high, d = _spread_terms(low_strike, high_strike, debit)
    units = _units(multiplier, contracts)
    f = _nonnegative(fees, "fees")
    cost = d * units + f
    max_profit = (high - low) * units - cost
    be = low + cost / units if kind == "call" else high - cost / units
    # If fees consume more than the payoff width, no terminal breakeven exists.
    return {"max_loss": cost, "max_profit": max_profit,
            "max_payoff": (high - low) * units,
            "break_even": be if max_profit >= 0 else None}


def put_spread_collar_value(terminal_spot: float, short_put: float,
                            long_put: float, short_call: float) -> float:
    """Value per share; excludes initial stock cost, net option cost and fees."""
    s = _nonnegative(terminal_spot, "terminal_spot")
    kl = _positive(short_put, "short_put")
    kp = _positive(long_put, "long_put")
    kc = _positive(short_call, "short_call")
    if not kl < kp < kc:
        raise ValueError("requires short_put < long_put < short_call")
    return s + max(kp - s, 0) - max(kl - s, 0) - max(s - kc, 0)


def split_terms(price: float, shares: float, ratio: float) -> dict[str, float]:
    """Stock economics only, NOT an OCC option adjustment model."""
    p = _nonnegative(price, "price")
    n = _nonnegative(shares, "shares")
    r = _positive(ratio, "ratio")
    return {"price": p / r, "shares": n * r}


def vwap(prices: Sequence[float], volumes: Sequence[float]) -> float:
    """Trade prices give trade VWAP; bar typical prices give an approximation."""
    if not prices or len(prices) != len(volumes):
        raise ValueError("VWAP needs equal nonempty price/volume sequences")
    pairs = [(_positive(p, "price"), _nonnegative(v, "volume")) for p, v in zip(prices, volumes)]
    denominator = _positive(sum(v for _, v in pairs), "total_volume")
    return sum(p * v for p, v in pairs) / denominator


def historical_volatility(closes: Sequence[float], annual_sessions: float = 252) -> float:
    """Sample stdev of log returns (ddof=1), annualized; returns a decimal."""
    if len(closes) < 3:
        raise ValueError("sample HV needs at least two returns / three closes")
    prices = [_positive(p, "close") for p in closes]
    returns = [math.log(b / a) for a, b in zip(prices, prices[1:])]
    return statistics.stdev(returns) * math.sqrt(_positive(annual_sessions, "annual_sessions"))


def iv_rank(current_iv: float, history_iv: Sequence[float]) -> float:
    """No clipping: an out-of-window new high can exceed 100. IV history only."""
    now = _nonnegative(current_iv, "current_iv")
    if not history_iv:
        raise ValueError("IV rank needs IV history")
    history = [_nonnegative(v, "history_iv") for v in history_iv]
    width = _positive(max(history) - min(history), "historical IV range")
    return (now - min(history)) / width * 100


def iv_percentile(current_iv: float, history_iv: Sequence[float]) -> float:
    """Strictly-less tie convention. A flat history is allowed here, unlike rank."""
    now = _nonnegative(current_iv, "current_iv")
    if not history_iv:
        raise ValueError("IV percentile needs IV history")
    history = [_nonnegative(v, "history_iv") for v in history_iv]
    return sum(v < now for v in history) / len(history) * 100


def expected_move(spot: float, iv_decimal: float, years: float) -> float:
    """Rough sigma scale, not a prediction interval or touch probability."""
    return (_positive(spot, "spot") * _nonnegative(iv_decimal, "iv_decimal")
            * math.sqrt(_nonnegative(years, "years")))


def delta_oi(current: int, previous: int) -> int:
    """Caller must verify the same adjusted contract and distinct OI data dates."""
    return _count(current, "current OI") - _count(previous, "previous OI")


def put_call_ratio(put_count: int, call_count: int) -> float:
    return _count(put_count, "put_count") / _count(call_count, "call_count", positive=True)


def bid_ask_spread_pct(bid: float, ask: float) -> float:
    b = _nonnegative(bid, "bid")
    a = _nonnegative(ask, "ask")
    if b > a:
        raise ValueError("crossed quotes require investigation")
    return (a - b) / _positive((a + b) / 2, "mid") * 100


def gross_sensitivities(delta: float, gamma: float, vega_per_vol_point: float,
                        oi: int, spot: float, multiplier: float = 100) -> dict[str, float]:
    """Unsigned concentration. NEVER dealer net GEX or a directional signal."""
    d = _finite(delta, "delta")
    g = _finite(gamma, "gamma")
    v = _finite(vega_per_vol_point, "vega_per_vol_point")
    units = _count(oi, "OI") * _positive(multiplier, "multiplier")
    s = _positive(spot, "spot")
    return {"delta_dollars": abs(d) * units * s,
            "gamma_dollars_per_1pct": abs(g) * units * s * s * 0.01,
            "vega_dollars_per_vol_point": abs(v) * units}
