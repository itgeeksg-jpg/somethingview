# SomethingView

A free, self-hosted TradingView-style charting app: candlestick charts, indicators, drawing tools and
watchlists you can create on the fly. It's a static app (no build step) served by a free Cloudflare Worker behind a login, at
**https://somethingview.itgeeksg.workers.dev**. The old GitHub Pages address forwards there.

## Features

- **Charts**: candles, hollow candles, bars, Heikin Ashi, line and area. Log scale, multiple panes you can resize,
  timeframes from 1m to 1M, range buttons (1D…All), and PNG snapshots. Built on TradingView's open-source
  [Lightweight Charts](https://github.com/tradingview/lightweight-charts).
- **Indicators**: Volume, SMA/EMA/WMA, EMA ribbon, Bollinger Bands, Fibonacci Bollinger Bands, Supertrend, MACD, RSI,
  Stochastic, Stoch RSI, Squeeze Momentum [LazyBear], ATR, OBV, CCI, ADX/DMI, Williams %R and MFI. You can add the
  same indicator more than once with different settings.
- **Drawings**: trend line, ray, extended line, horizontal line and ray, vertical line with label, rectangle, Fib
  retracement, price range and text. There's also a magnet mode. Drawings are saved per symbol.
- **Watchlists**: create, rename, copy and delete lists; add sections; drag to reorder; sort by column; right-click
  to add a symbol to another list. You can upload TradingView `.txt` exports, download lists, and share a list as a
  link. Prices update live.
- **Details panel**: price, day range, 52-week range and performance (1W to 1Y).
- **Automatic sync across devices**: link your phone once by scanning a QR code.
- Works on phones: add it to your home screen for an app-like view.

## Data sources

| Symbols | Source | Notes |
|---|---|---|
| `BTCUSDT`, `ETHUSDT`, `BINANCE:XXX` | Binance public API and websocket | Real-time, no key |
| Calculated: `BTCSGD`, `BTCMYR` (= BTCUSD × USDxxx) or any `A*B` / `A/B`, e.g. `BTCUSD/XAUUSD` | Combined from both legs | Like TradingView spreads |
| Stocks (`AAPL`, `D05.SI`, `0700.HK`), indices (`SPX`, `NDX`, `HSI`, `STI`, `SHCOMP`…), FX (`USDSGD`), futures (`ES1!`), commodities (`XAUUSD`), crypto USD pairs (`BTCUSD`) | Yahoo Finance via the Worker (`/api/yahoo`) | Yahoo has no CORS |

## Hosting, login and sync (`worker/`)

The Worker (`worker/index.js`) serves the app files and:

- **Login**: `/login` checks the username and password. On success it sets a signed, HttpOnly cookie that keeps the
  device signed in for a year. Everything else (app files and APIs) needs that cookie. The credentials are Worker
  secrets, not in this repo:
  `npx wrangler secret put AUTH_USER`, `AUTH_PASS`, and `SESSION_SECRET` (a random string). Changing any of them
  signs every device out.
- **`/api/yahoo`**: Yahoo Finance proxy (Yahoo hosts only).
- **`/api/sync/<key>`** and **`/api/pair`**: device sync, stored in Cloudflare D1 (`somethingview-sync`, see
  `worker/schema.sql`). To link a phone, click the dot in the top bar and type the 6-character pairing code on the
  phone. Lists, indicators and drawings sync; the chart, timeframe and layout stay separate on each device.

Deploy after changing anything: `cd worker && npx wrangler deploy`. GitHub Pages serves only the `gh-pages` branch,
which forwards visitors (and their sync key) to the Worker.

## Keyboard

Type anywhere to search a symbol · `↑`/`↓` go to the previous/next watchlist symbol · `Shift+W` opens lists ·
`Alt+T/H/V/F/R` pick a drawing tool · `Del` deletes the selected drawing · `Esc` cancels.

## Run locally

```sh
python3 -m http.server 8000   # then open http://localhost:8000
```

## License notes

Lightweight Charts™ is © TradingView, Inc., Apache-2.0 (`js/lib/LICENSE-lightweight-charts`). The TradingView logo
link on the chart is the library's required attribution.
