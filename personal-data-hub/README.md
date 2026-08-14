# TraderHome Personal Data Hub

`personal-data-hub` is the private, read-only bridge between the public
TraderHome pages and data that must stay on the owner's Mac.

## Sources

- Crypto candles, quote context, funding and open interest: Binance, with the
  browser's existing OKX/Kraken fallback left intact. Optional read-only API
  credentials also expose spot/futures balances, positions and USD-M futures
  executions. Trade history is split into Binance's required seven-day query
  windows and active futures symbols can be discovered from income history.
- US equities and indices: a persistent Longbridge OpenAPI SDK connection,
  reusing the authenticated `longbridge` CLI OAuth session locally.
- NQ/ES/GC/CL futures, account state and recent executions: IBKR's Client
  Portal Web API through its lightweight local Gateway. TWS does not need to
  be installed or kept open. The old socket adapter remains opt-in as an
  emergency fallback only.

The service binds to `127.0.0.1` only. Market endpoints are read-only and the
account/review endpoints additionally require a random bearer token stored at
`~/.traderhome/data-hub-token`. No broker credential is copied into this repo
or published by GitHub Pages.

## Install on this Mac

```bash
./personal-data-hub/scripts/install-macos.sh
```

The installer copies a durable runtime to `~/.traderhome/data-hub-app`, creates
an isolated virtual environment, installs LaunchAgents for the hub and the
official IBKR Client Portal Gateway, and starts them automatically. The local
hub listens at `http://127.0.0.1:8765`; IBKR's Gateway listens at
`http://127.0.0.1:5001` because macOS commonly occupies port 5000. The
installer removes the Gateway's default LAN allow-list, so this browser hop
is restricted to the same Mac; its upstream connection to IBKR remains HTTPS.

For an individual IBKR Pro account, open `http://127.0.0.1:5001` once each
day and complete the normal password plus two-factor login. This is an IBKR
requirement and cannot be automated safely. The page's IBKR status provides
the same login link whenever authentication is due. Longbridge reuses the
existing `longbridge auth login` session. An individual account does not need
to register a separate OAuth application for this local Gateway path. Live
exchange permissions still follow the market-data subscriptions enabled on
that IBKR account; TraderHome keeps its delayed/public fallback when a live
entitlement is unavailable.

Useful checks:

```bash
curl http://127.0.0.1:8765/health
curl 'http://127.0.0.1:8765/api/v1/market/bundle?symbol=AAPL&timeframes=1m,5m,1h,1d'
```

IBKR's direct Client Portal execution endpoint exposes at most seven days.
TraderHome labels that window in review output instead of presenting it as a
90-day history. Use an IBKR Flex Query or an imported trade file for longer
history. Set `TRADERHOME_IBKR_SOCKET_FALLBACK=1` only if the legacy TWS/IB
Gateway socket route is deliberately needed; it is disabled by default.

Optional Binance account access uses an API key with read permission only. Do
not enable spot/futures trading or withdrawals. On macOS the setup script saves
both values in Keychain and restarts the hub:

```bash
./personal-data-hub/scripts/configure-binance-macos.sh
```
