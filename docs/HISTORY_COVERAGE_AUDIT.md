# Historical Data Coverage Audit

Generated: 2026-11-09T16:46:02Z

Fresh data is not proof of complete lifetime history. No series is certified as fully verified.
Network genesis is not a market-price start. Provider firstTradeDate is not independent IPO evidence.
Only dated primary-source references in lifecycle.json have been checked; all others remain unverified.
Cash-market gaps are a 1970+ XNYS session screen, not proof of missing trades (halts and calendar differences need review).
Earlier cash sessions and futures exchange calendars are not audited. No missing prices are interpolated.
Coin Metrics PriceUSD is an independent USD close-only series, not exchange OHLCV or a Binance splice.
US ADRs, SPAC predecessors, when-issued trades and corporate reorganizations may have distinct start dates.

| Symbol | Series | Actual first | Actual last | Bars | Verified lifecycle reference | Start status | Suspected gaps | OHLC-invalid bars |
|---|---|---|---|---:|---|---|---:|---:|
| BTC | base: Binance 4h | 2017-08-17 | 2026-11-09 | 20213 | [2009-01-03 (network)](https://github.com/bitcoin/bips/blob/master/bip-0085.mediawiki) | network-not-price | 16 | 0 |
| BTC | primary: Binance 1d | 2017-08-17 | 2026-11-08 | 3371 | [2009-01-03 (network)](https://github.com/bitcoin/bips/blob/master/bip-0085.mediawiki) | network-not-price | 0 | 0 |
| BTC | usd: Coin Metrics 1d | 2010-07-18 | 2026-11-08 | 5958 | [2009-01-03 (network)](https://github.com/bitcoin/bips/blob/master/bip-0085.mediawiki) | network-not-price | 0 | n/a (close-only) |
| ETH | base: Binance 4h | 2017-08-17 | 2026-11-09 | 20213 | [2015-07-30 (network)](https://blog.ethereum.org/2015/07/30/ethereum-launches) | network-not-price | 16 | 0 |
| ETH | primary: Binance 1d | 2017-08-17 | 2026-11-08 | 3371 | [2015-07-30 (network)](https://blog.ethereum.org/2015/07/30/ethereum-launches) | network-not-price | 0 | 0 |
| ETH | usd: Coin Metrics 1d | 2015-08-08 | 2026-11-08 | 4111 | [2015-07-30 (network)](https://blog.ethereum.org/2015/07/30/ethereum-launches) | network-not-price | 0 | n/a (close-only) |
| SOL | base: Binance 4h | 2020-08-11 | 2026-11-09 | 13689 | unverified | unverified | 0 | 0 |
| SOL | primary: Binance 1d | 2020-08-11 | 2026-11-08 | 2281 | unverified | unverified | 0 | 0 |
| BNB | base: Binance 4h | 2017-11-06 | 2026-11-09 | 19728 | unverified | unverified | 16 | 0 |
| BNB | primary: Binance 1d | 2017-11-06 | 2026-11-08 | 3290 | unverified | unverified | 0 | 0 |
| XRP | base: Binance 4h | 2018-05-04 | 2026-11-09 | 18659 | unverified | unverified | 9 | 0 |
| XRP | primary: Binance 1d | 2018-05-04 | 2026-11-08 | 3111 | unverified | unverified | 0 | 0 |
| DOGE | base: Binance 4h | 2019-07-05 | 2026-11-09 | 16103 | unverified | unverified | 2 | 0 |
| DOGE | primary: Binance 1d | 2019-07-05 | 2026-11-08 | 2684 | unverified | unverified | 0 | 0 |
| ADA | base: Binance 4h | 2018-04-17 | 2026-11-09 | 18762 | unverified | unverified | 9 | 0 |
| ADA | primary: Binance 1d | 2018-04-17 | 2026-11-08 | 3128 | unverified | unverified | 0 | 0 |
| AVAX | base: Binance 4h | 2020-09-22 | 2026-11-09 | 13437 | unverified | unverified | 0 | 0 |
| AVAX | primary: Binance 1d | 2020-09-22 | 2026-11-08 | 2239 | unverified | unverified | 0 | 0 |
| LINK | base: Binance 4h | 2019-01-16 | 2026-11-09 | 17121 | unverified | unverified | 5 | 0 |
| LINK | primary: Binance 1d | 2019-01-16 | 2026-11-08 | 2854 | unverified | unverified | 0 | 0 |
| LTC | base: Binance 4h | 2017-12-13 | 2026-11-09 | 19506 | unverified | unverified | 16 | 0 |
| LTC | primary: Binance 1d | 2017-12-13 | 2026-11-08 | 3253 | unverified | unverified | 0 | 0 |
| AAPL | base: Yahoo Finance 1d | 1980-12-12 | 2026-11-06 | 11569 | [1980-12-12 (ipo)](https://investor.apple.com/faq./default.aspx) | start-reached | 0 | 0 |
| AAPL | primary: Yahoo Finance 1d | 1980-12-12 | 2026-11-06 | 11569 | [1980-12-12 (ipo)](https://investor.apple.com/faq./default.aspx) | start-reached | 0 | 0 |
| NVDA | base: Yahoo Finance 1d | 1999-01-22 | 2026-11-06 | 6992 | [1999-01-22 (ipo)](https://investor.nvidia.com/investor-resources/faqs/default.aspx?sh_print=yes) | start-reached | 0 | 0 |
| NVDA | primary: Yahoo Finance 1d | 1999-01-22 | 2026-11-06 | 6992 | [1999-01-22 (ipo)](https://investor.nvidia.com/investor-resources/faqs/default.aspx?sh_print=yes) | start-reached | 0 | 0 |
| MSFT | base: Yahoo Finance 1d | 1986-03-13 | 2026-11-06 | 10243 | [1986-03-13 (ipo)](https://www.microsoft.com/en-us/investor/faq) | start-reached | 0 | 0 |
| MSFT | primary: Yahoo Finance 1d | 1986-03-13 | 2026-11-06 | 10243 | [1986-03-13 (ipo)](https://www.microsoft.com/en-us/investor/faq) | start-reached | 0 | 0 |
| AMZN | base: Yahoo Finance 1d | 1997-05-15 | 2026-11-06 | 7417 | [1997-05-15 (ipo)](https://ir.aboutamazon.com/faqs/default.aspx) | start-reached | 0 | 0 |
| AMZN | primary: Yahoo Finance 1d | 1997-05-15 | 2026-11-06 | 7417 | [1997-05-15 (ipo)](https://ir.aboutamazon.com/faqs/default.aspx) | start-reached | 0 | 0 |
| GOOGL | base: Yahoo Finance 1d | 2004-08-19 | 2026-11-06 | 5591 | unverified | unverified | 0 | 0 |
| GOOGL | primary: Yahoo Finance 1d | 2004-08-19 | 2026-11-06 | 5591 | unverified | unverified | 0 | 0 |
| META | base: Yahoo Finance 1d | 2012-05-18 | 2026-11-06 | 3639 | unverified | unverified | 0 | 0 |
| META | primary: Yahoo Finance 1d | 2012-05-18 | 2026-11-06 | 3639 | unverified | unverified | 0 | 0 |
| TSLA | base: Yahoo Finance 1d | 2010-06-29 | 2026-11-06 | 4116 | unverified | unverified | 0 | 0 |
| TSLA | primary: Yahoo Finance 1d | 2010-06-29 | 2026-11-06 | 4116 | unverified | unverified | 0 | 0 |
| AMD | base: Yahoo Finance 1d | 1980-03-17 | 2026-11-06 | 11757 | [1972-09-27 (ipo)](https://ir.amd.com/contacts-faq/faq) | missing-early | 0 | 0 |
| AMD | primary: Yahoo Finance 1d | 1980-03-17 | 2026-11-06 | 11757 | [1972-09-27 (ipo)](https://ir.amd.com/contacts-faq/faq) | missing-early | 0 | 0 |
| AVGO | base: Yahoo Finance 1d | 2009-08-06 | 2026-11-06 | 4341 | unverified | unverified | 0 | 0 |
| AVGO | primary: Yahoo Finance 1d | 2009-08-06 | 2026-11-06 | 4341 | unverified | unverified | 0 | 0 |
| MU | base: Yahoo Finance 1d | 1984-06-01 | 2026-11-06 | 10692 | unverified | unverified | 0 | 0 |
| MU | primary: Yahoo Finance 1d | 1984-06-01 | 2026-11-06 | 10692 | unverified | unverified | 0 | 0 |
| PLTR | base: Yahoo Finance 1d | 2020-09-30 | 2026-11-06 | 1534 | unverified | unverified | 0 | 0 |
| PLTR | primary: Yahoo Finance 1d | 2020-09-30 | 2026-11-06 | 1534 | unverified | unverified | 0 | 0 |
| NFLX | base: Yahoo Finance 1d | 2002-05-23 | 2026-11-06 | 6155 | unverified | unverified | 0 | 0 |
| NFLX | primary: Yahoo Finance 1d | 2002-05-23 | 2026-11-06 | 6155 | unverified | unverified | 0 | 0 |
| JPM | base: Yahoo Finance 1d | 1980-03-17 | 2026-11-06 | 11757 | unverified | unverified | 0 | 0 |
| JPM | primary: Yahoo Finance 1d | 1980-03-17 | 2026-11-06 | 11757 | unverified | unverified | 0 | 0 |
| GS | base: Yahoo Finance 1d | 1999-05-04 | 2026-11-06 | 6922 | unverified | unverified | 0 | 0 |
| GS | primary: Yahoo Finance 1d | 1999-05-04 | 2026-11-06 | 6922 | unverified | unverified | 0 | 0 |
| BAC | base: Yahoo Finance 1d | 1973-02-21 | 2026-11-06 | 13543 | unverified | unverified | 0 | 0 |
| BAC | primary: Yahoo Finance 1d | 1973-02-21 | 2026-11-06 | 13543 | unverified | unverified | 0 | 0 |
| COIN | base: Yahoo Finance 1d | 2021-04-14 | 2026-11-06 | 1400 | unverified | unverified | 0 | 0 |
| COIN | primary: Yahoo Finance 1d | 2021-04-14 | 2026-11-06 | 1400 | unverified | unverified | 0 | 0 |
| MSTR | base: Yahoo Finance 1d | 1998-06-11 | 2026-11-06 | 7147 | unverified | unverified | 0 | 0 |
| MSTR | primary: Yahoo Finance 1d | 1998-06-11 | 2026-11-06 | 7147 | unverified | unverified | 0 | 0 |
| TSM | base: Yahoo Finance 1d | 1997-10-09 | 2026-11-06 | 7315 | [1997-10-08 (adr)](https://investor.tsmc.com/english/faq) | missing-early | 0 | 0 |
| TSM | primary: Yahoo Finance 1d | 1997-10-09 | 2026-11-06 | 7315 | [1997-10-08 (adr)](https://investor.tsmc.com/english/faq) | missing-early | 0 | 0 |
| ARM | base: Yahoo Finance 1d | 2023-09-14 | 2026-11-06 | 791 | unverified | unverified | 0 | 0 |
| ARM | primary: Yahoo Finance 1d | 2023-09-14 | 2026-11-06 | 791 | unverified | unverified | 0 | 0 |
| ASML | base: Yahoo Finance 1d | 1995-03-15 | 2026-11-06 | 7966 | unverified | unverified | 0 | 0 |
| ASML | primary: Yahoo Finance 1d | 1995-03-15 | 2026-11-06 | 7966 | unverified | unverified | 0 | 0 |
| QCOM | base: Yahoo Finance 1d | 1991-12-13 | 2026-11-06 | 8787 | unverified | unverified | 0 | 0 |
| QCOM | primary: Yahoo Finance 1d | 1991-12-13 | 2026-11-06 | 8787 | unverified | unverified | 0 | 0 |
| INTC | base: Yahoo Finance 1d | 1980-03-17 | 2026-11-06 | 11757 | [1971-10-13 (ipo)](https://www.intc.com/stock-info/faq) | missing-early | 0 | 0 |
| INTC | primary: Yahoo Finance 1d | 1980-03-17 | 2026-11-06 | 11757 | [1971-10-13 (ipo)](https://www.intc.com/stock-info/faq) | missing-early | 0 | 0 |
| AMAT | base: Yahoo Finance 1d | 1980-03-17 | 2026-11-06 | 11757 | [1972-10-05 (ipo)](https://ir.appliedmaterials.com/shareholder-services/investor-faqs/) | missing-early | 0 | 0 |
| AMAT | primary: Yahoo Finance 1d | 1980-03-17 | 2026-11-06 | 11757 | [1972-10-05 (ipo)](https://ir.appliedmaterials.com/shareholder-services/investor-faqs/) | missing-early | 0 | 0 |
| SMCI | base: Yahoo Finance 1d | 2007-03-29 | 2026-11-06 | 4935 | unverified | unverified | 0 | 0 |
| SMCI | primary: Yahoo Finance 1d | 2007-03-29 | 2026-11-06 | 4935 | unverified | unverified | 0 | 0 |
| ORCL | base: Yahoo Finance 1d | 1986-03-12 | 2026-11-06 | 10244 | [1986-03-12 (ipo)](https://investor.oracle.com/faq/default.aspx) | start-reached | 0 | 0 |
| ORCL | primary: Yahoo Finance 1d | 1986-03-12 | 2026-11-06 | 10244 | [1986-03-12 (ipo)](https://investor.oracle.com/faq/default.aspx) | start-reached | 0 | 0 |
| CRM | base: Yahoo Finance 1d | 2004-06-23 | 2026-11-06 | 5631 | unverified | unverified | 0 | 0 |
| CRM | primary: Yahoo Finance 1d | 2004-06-23 | 2026-11-06 | 5631 | unverified | unverified | 0 | 0 |
| ADBE | base: Yahoo Finance 1d | 1986-08-13 | 2026-11-06 | 10137 | [1986-08-20 (ipo)](https://www.adobe.com/investor-relations/faq.html) | before-reference | 0 | 0 |
| ADBE | primary: Yahoo Finance 1d | 1986-08-13 | 2026-11-06 | 10137 | [1986-08-20 (ipo)](https://www.adobe.com/investor-relations/faq.html) | before-reference | 0 | 0 |
| NOW | base: Yahoo Finance 1d | 2012-06-29 | 2026-11-06 | 3610 | unverified | unverified | 0 | 0 |
| NOW | primary: Yahoo Finance 1d | 2012-06-29 | 2026-11-06 | 3610 | unverified | unverified | 0 | 0 |
| CRWD | base: Yahoo Finance 1d | 2019-06-12 | 2026-11-06 | 1863 | unverified | unverified | 0 | 0 |
| CRWD | primary: Yahoo Finance 1d | 2019-06-12 | 2026-11-06 | 1863 | unverified | unverified | 0 | 0 |
| PANW | base: Yahoo Finance 1d | 2012-07-20 | 2026-11-06 | 3596 | unverified | unverified | 0 | 0 |
| PANW | primary: Yahoo Finance 1d | 2012-07-20 | 2026-11-06 | 3596 | unverified | unverified | 0 | 0 |
| NET | base: Yahoo Finance 1d | 2019-09-13 | 2026-11-06 | 1798 | unverified | unverified | 0 | 0 |
| NET | primary: Yahoo Finance 1d | 2019-09-13 | 2026-11-06 | 1798 | unverified | unverified | 0 | 0 |
| SNOW | base: Yahoo Finance 1d | 2020-09-16 | 2026-11-06 | 1544 | unverified | unverified | 0 | 0 |
| SNOW | primary: Yahoo Finance 1d | 2020-09-16 | 2026-11-06 | 1544 | unverified | unverified | 0 | 0 |
| DDOG | base: Yahoo Finance 1d | 2019-09-19 | 2026-11-06 | 1794 | unverified | unverified | 0 | 0 |
| DDOG | primary: Yahoo Finance 1d | 2019-09-19 | 2026-11-06 | 1794 | unverified | unverified | 0 | 0 |
| UBER | base: Yahoo Finance 1d | 2019-05-10 | 2026-11-06 | 1885 | unverified | unverified | 0 | 0 |
| UBER | primary: Yahoo Finance 1d | 2019-05-10 | 2026-11-06 | 1885 | unverified | unverified | 0 | 0 |
| ABNB | base: Yahoo Finance 1d | 2020-12-10 | 2026-11-06 | 1484 | unverified | unverified | 0 | 0 |
| ABNB | primary: Yahoo Finance 1d | 2020-12-10 | 2026-11-06 | 1484 | unverified | unverified | 0 | 0 |
| SHOP | base: Yahoo Finance 1d | 2015-05-20 | 2026-11-06 | 2885 | unverified | unverified | 0 | 0 |
| SHOP | primary: Yahoo Finance 1d | 2015-05-20 | 2026-11-06 | 2885 | unverified | unverified | 0 | 0 |
| SPOT | base: Yahoo Finance 1d | 2018-04-03 | 2026-11-06 | 2163 | unverified | unverified | 0 | 0 |
| SPOT | primary: Yahoo Finance 1d | 2018-04-03 | 2026-11-06 | 2163 | unverified | unverified | 0 | 0 |
| PYPL | base: Yahoo Finance 1d | 2015-07-06 | 2026-11-06 | 2854 | unverified | unverified | 0 | 0 |
| PYPL | primary: Yahoo Finance 1d | 2015-07-06 | 2026-11-06 | 2854 | unverified | unverified | 0 | 0 |
| HOOD | base: Yahoo Finance 1d | 2021-07-29 | 2026-11-06 | 1326 | unverified | unverified | 0 | 0 |
| HOOD | primary: Yahoo Finance 1d | 2021-07-29 | 2026-11-06 | 1326 | unverified | unverified | 0 | 0 |
| SOFI | base: Yahoo Finance 1d | 2021-01-04 | 2026-11-06 | 1469 | [2021-06-01 (operating-ticker)](https://www.nasdaqtrader.com/TraderNews.aspx?id=dtn2021-21) | before-reference | 0 | 0 |
| SOFI | primary: Yahoo Finance 1d | 2021-01-04 | 2026-11-06 | 1469 | [2021-06-01 (operating-ticker)](https://www.nasdaqtrader.com/TraderNews.aspx?id=dtn2021-21) | before-reference | 0 | 0 |
| RDDT | base: Yahoo Finance 1d | 2024-03-21 | 2026-11-06 | 661 | unverified | unverified | 0 | 0 |
| RDDT | primary: Yahoo Finance 1d | 2024-03-21 | 2026-11-06 | 661 | unverified | unverified | 0 | 0 |
| RKLB | base: Yahoo Finance 1d | 2020-11-24 | 2026-11-06 | 1495 | [2021-08-25 (operating-ticker)](https://investors.rocketlabcorp.com/static-files/8dfd352c-0070-4ffd-9c5e-966bf4cdcc21) | before-reference | 0 | 0 |
| RKLB | primary: Yahoo Finance 1d | 2020-11-24 | 2026-11-06 | 1495 | [2021-08-25 (operating-ticker)](https://investors.rocketlabcorp.com/static-files/8dfd352c-0070-4ffd-9c5e-966bf4cdcc21) | before-reference | 0 | 0 |
| ASTS | base: Yahoo Finance 1d | 2019-11-01 | 2026-11-06 | 1763 | [2021-04-07 (operating-ticker)](https://www.nasdaqtrader.com/TraderNews.aspx?id=ECA2021-59) | before-reference | 0 | 0 |
| ASTS | primary: Yahoo Finance 1d | 2019-11-01 | 2026-11-06 | 1763 | [2021-04-07 (operating-ticker)](https://www.nasdaqtrader.com/TraderNews.aspx?id=ECA2021-59) | before-reference | 0 | 0 |
| IONQ | base: Yahoo Finance 1d | 2021-01-04 | 2026-11-06 | 1469 | [2021-10-01 (operating-ticker)](https://www.ionq.com/news/october-01-2021-ionq-listed-on-nyse) | before-reference | 0 | 0 |
| IONQ | primary: Yahoo Finance 1d | 2021-01-04 | 2026-11-06 | 1469 | [2021-10-01 (operating-ticker)](https://www.ionq.com/news/october-01-2021-ionq-listed-on-nyse) | before-reference | 0 | 0 |
| APP | base: Yahoo Finance 1d | 2021-04-15 | 2026-11-06 | 1399 | unverified | unverified | 0 | 0 |
| APP | primary: Yahoo Finance 1d | 2021-04-15 | 2026-11-06 | 1399 | unverified | unverified | 0 | 0 |
| DUOL | base: Yahoo Finance 1d | 2021-07-28 | 2026-11-06 | 1327 | unverified | unverified | 0 | 0 |
| DUOL | primary: Yahoo Finance 1d | 2021-07-28 | 2026-11-06 | 1327 | unverified | unverified | 0 | 0 |
| BABA | base: Yahoo Finance 1d | 2014-09-19 | 2026-11-06 | 3052 | unverified | unverified | 0 | 0 |
| BABA | primary: Yahoo Finance 1d | 2014-09-19 | 2026-11-06 | 3052 | unverified | unverified | 0 | 0 |
| PDD | base: Yahoo Finance 1d | 2018-07-26 | 2026-11-06 | 2083 | unverified | unverified | 0 | 0 |
| PDD | primary: Yahoo Finance 1d | 2018-07-26 | 2026-11-06 | 2083 | unverified | unverified | 0 | 0 |
| NDX | base: Yahoo Finance 1d | 1985-10-01 | 2026-11-06 | 10356 | unverified | unverified | 0 | 0 |
| NDX | primary: Yahoo Finance 1d | 1985-10-01 | 2026-11-06 | 10356 | unverified | unverified | 0 | 0 |
| SPX | base: Yahoo Finance 1d | 1927-12-30 | 2026-11-06 | 24831 | unverified | unverified | 0 | 0 |
| SPX | primary: Yahoo Finance 1d | 1927-12-30 | 2026-11-06 | 24831 | unverified | unverified | 0 | 0 |
| DJI | base: Yahoo Finance 1d | 1992-01-02 | 2026-11-06 | 8775 | unverified | unverified | 0 | 0 |
| DJI | primary: Yahoo Finance 1d | 1992-01-02 | 2026-11-06 | 8775 | unverified | unverified | 0 | 0 |
| RUT | base: Yahoo Finance 1d | 1987-09-10 | 2026-11-06 | 9865 | unverified | unverified | 0 | 0 |
| RUT | primary: Yahoo Finance 1d | 1987-09-10 | 2026-11-06 | 9865 | unverified | unverified | 0 | 0 |
| QQQ | base: Yahoo Finance 1d | 1999-03-10 | 2026-11-06 | 6960 | unverified | unverified | 0 | 0 |
| QQQ | primary: Yahoo Finance 1d | 1999-03-10 | 2026-11-06 | 6960 | unverified | unverified | 0 | 0 |
| SPY | base: Yahoo Finance 1d | 1993-01-29 | 2026-11-06 | 8502 | unverified | unverified | 0 | 0 |
| SPY | primary: Yahoo Finance 1d | 1993-01-29 | 2026-11-06 | 8502 | unverified | unverified | 0 | 0 |
| IWM | base: Yahoo Finance 1d | 2000-05-26 | 2026-11-06 | 6652 | unverified | unverified | 0 | 0 |
| IWM | primary: Yahoo Finance 1d | 2000-05-26 | 2026-11-06 | 6652 | unverified | unverified | 0 | 0 |
| DIA | base: Yahoo Finance 1d | 1998-01-20 | 2026-11-06 | 7246 | unverified | unverified | 0 | 0 |
| DIA | primary: Yahoo Finance 1d | 1998-01-20 | 2026-11-06 | 7246 | unverified | unverified | 0 | 0 |
| NQ | base: Yahoo Finance 1d | 2000-09-18 | 2026-11-06 | 6600 | [1999-06-21 (product)](https://www.cmegroup.com/media-room/historical-first-trade-dates.html) | missing-early | not audited | 24 |
| NQ | primary: Yahoo Finance 1d | 2000-09-18 | 2026-11-06 | 6600 | [1999-06-21 (product)](https://www.cmegroup.com/media-room/historical-first-trade-dates.html) | missing-early | not audited | 24 |
| ES | base: Yahoo Finance 1d | 2000-09-18 | 2026-11-06 | 6600 | [1997-09-09 (product)](https://www.cmegroup.com/media-room/historical-first-trade-dates.html) | missing-early | not audited | 10 |
| ES | primary: Yahoo Finance 1d | 2000-09-18 | 2026-11-06 | 6600 | [1997-09-09 (product)](https://www.cmegroup.com/media-room/historical-first-trade-dates.html) | missing-early | not audited | 10 |
| YM | base: Yahoo Finance 1d | 2002-04-05 | 2026-11-06 | 6191 | unverified | unverified | not audited | 29 |
| YM | primary: Yahoo Finance 1d | 2002-04-05 | 2026-11-06 | 6191 | unverified | unverified | not audited | 29 |
| RTY | base: Yahoo Finance 1d | 2017-07-10 | 2026-11-06 | 2350 | unverified | unverified | not audited | 0 |
| RTY | primary: Yahoo Finance 1d | 2017-07-10 | 2026-11-06 | 2350 | unverified | unverified | not audited | 0 |
| GC | base: Yahoo Finance 1d | 2000-08-30 | 2026-11-06 | 6573 | unverified | unverified | not audited | 441 |
| GC | primary: Yahoo Finance 1d | 2000-08-30 | 2026-11-06 | 6573 | unverified | unverified | not audited | 441 |
| SI | base: Yahoo Finance 1d | 2000-08-30 | 2026-11-06 | 6574 | unverified | unverified | not audited | 243 |
| SI | primary: Yahoo Finance 1d | 2000-08-30 | 2026-11-06 | 6574 | unverified | unverified | not audited | 243 |
| GLD | base: Yahoo Finance 1d | 2004-11-18 | 2026-11-06 | 5527 | unverified | unverified | 0 | 0 |
| GLD | primary: Yahoo Finance 1d | 2004-11-18 | 2026-11-06 | 5527 | unverified | unverified | 0 | 0 |
| SLV | base: Yahoo Finance 1d | 2006-04-28 | 2026-11-06 | 5165 | unverified | unverified | 0 | 0 |
| SLV | primary: Yahoo Finance 1d | 2006-04-28 | 2026-11-06 | 5165 | unverified | unverified | 0 | 0 |
| USO | base: Yahoo Finance 1d | 2006-04-10 | 2026-11-06 | 5178 | unverified | unverified | 0 | 0 |
| USO | primary: Yahoo Finance 1d | 2006-04-10 | 2026-11-06 | 5178 | unverified | unverified | 0 | 0 |
| UNG | base: Yahoo Finance 1d | 2007-04-18 | 2026-11-06 | 4922 | unverified | unverified | 0 | 0 |
| UNG | primary: Yahoo Finance 1d | 2007-04-18 | 2026-11-06 | 4922 | unverified | unverified | 0 | 0 |
| DBC | base: Yahoo Finance 1d | 2006-02-06 | 2026-11-06 | 5222 | unverified | unverified | 0 | 0 |
| DBC | primary: Yahoo Finance 1d | 2006-02-06 | 2026-11-06 | 5222 | unverified | unverified | 0 | 0 |
| CPER | base: Yahoo Finance 1d | 2011-11-15 | 2026-11-06 | 3766 | unverified | unverified | 0 | 0 |
| CPER | primary: Yahoo Finance 1d | 2011-11-15 | 2026-11-06 | 3766 | unverified | unverified | 0 | 0 |

## Gap Samples

- BTC/base: 2018-02-08T04:00:00+00:00, 2018-02-08T08:00:00+00:00, 2018-02-08T12:00:00+00:00, 2018-02-08T16:00:00+00:00, 2018-02-08T20:00:00+00:00, 2018-02-09T00:00:00+00:00, 2018-02-09T04:00:00+00:00, 2018-06-26T04:00:00+00:00, 2018-06-26T08:00:00+00:00, 2018-07-04T04:00:00+00:00, 2018-11-14T04:00:00+00:00, 2019-03-12T04:00:00+00:00 (up to 12 examples)
- ETH/base: 2018-02-08T04:00:00+00:00, 2018-02-08T08:00:00+00:00, 2018-02-08T12:00:00+00:00, 2018-02-08T16:00:00+00:00, 2018-02-08T20:00:00+00:00, 2018-02-09T00:00:00+00:00, 2018-02-09T04:00:00+00:00, 2018-06-26T04:00:00+00:00, 2018-06-26T08:00:00+00:00, 2018-07-04T04:00:00+00:00, 2018-11-14T04:00:00+00:00, 2019-03-12T04:00:00+00:00 (up to 12 examples)
- BNB/base: 2018-02-08T04:00:00+00:00, 2018-02-08T08:00:00+00:00, 2018-02-08T12:00:00+00:00, 2018-02-08T16:00:00+00:00, 2018-02-08T20:00:00+00:00, 2018-02-09T00:00:00+00:00, 2018-02-09T04:00:00+00:00, 2018-06-26T04:00:00+00:00, 2018-06-26T08:00:00+00:00, 2018-07-04T04:00:00+00:00, 2018-11-14T04:00:00+00:00, 2019-03-12T04:00:00+00:00 (up to 12 examples)
- XRP/base: 2018-06-26T04:00:00+00:00, 2018-06-26T08:00:00+00:00, 2018-07-04T04:00:00+00:00, 2018-11-14T04:00:00+00:00, 2019-03-12T04:00:00+00:00, 2019-05-15T04:00:00+00:00, 2019-05-15T08:00:00+00:00, 2019-08-15T04:00:00+00:00, 2020-02-19T12:00:00+00:00 (up to 12 examples)
- DOGE/base: 2019-08-15T04:00:00+00:00, 2020-02-19T12:00:00+00:00 (up to 12 examples)
- ADA/base: 2018-06-26T04:00:00+00:00, 2018-06-26T08:00:00+00:00, 2018-07-04T04:00:00+00:00, 2018-11-14T04:00:00+00:00, 2019-03-12T04:00:00+00:00, 2019-05-15T04:00:00+00:00, 2019-05-15T08:00:00+00:00, 2019-08-15T04:00:00+00:00, 2020-02-19T12:00:00+00:00 (up to 12 examples)
- LINK/base: 2019-03-12T04:00:00+00:00, 2019-05-15T04:00:00+00:00, 2019-05-15T08:00:00+00:00, 2019-08-15T04:00:00+00:00, 2020-02-19T12:00:00+00:00 (up to 12 examples)
- LTC/base: 2018-02-08T04:00:00+00:00, 2018-02-08T08:00:00+00:00, 2018-02-08T12:00:00+00:00, 2018-02-08T16:00:00+00:00, 2018-02-08T20:00:00+00:00, 2018-02-09T00:00:00+00:00, 2018-02-09T04:00:00+00:00, 2018-06-26T04:00:00+00:00, 2018-06-26T08:00:00+00:00, 2018-07-04T04:00:00+00:00, 2018-11-14T04:00:00+00:00, 2019-03-12T04:00:00+00:00 (up to 12 examples)

## Sources

- [Coin Metrics Community Data](https://docs.coinmetrics.io/packages/coin-metrics-community-data), [CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/).
- [Binance market-data API](https://developers.binance.com/docs/binance-spot-api-docs/rest-api/market-data-endpoints).
- [Yahoo Finance](https://finance.yahoo.com/): explicit daily requests starting 1900-01-01; this is a request boundary, not a claim of 1900 coverage.
- [exchange_calendars](https://github.com/gerrymanoim/exchange_calendars), pinned 4.13.2; session screen only.
