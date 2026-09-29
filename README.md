# SomethingView

A free, self-hosted TradingView-style charting app: candlestick charts, indicators, drawing tools and
watchlists you can create on the fly. It's a static site (no build step, no backend), so it runs on GitHub Pages.

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
| Stocks (`AAPL`, `D05.SI`, `0700.HK`), indices (`SPX`, `NDX`, `HSI`, `STI`…), FX (`USDSGD`), futures (`ES1!`), commodities (`XAUUSD`), crypto USD pairs (`BTCUSD`) | Yahoo Finance | Needs a CORS proxy (see below) |

### Yahoo proxy

This deployment uses its own Cloudflare Worker (`worker/`, deployed at
`somethingview-proxy.itgeeksg.workers.dev`), which is built in as the default. To redeploy it:
`cd worker && npx wrangler deploy`.

#### Running your own copy

Browsers can't call Yahoo directly. By default the app uses a free public proxy, which is slow and sometimes down.
For reliable data:

1. Open the Cloudflare dashboard → **Workers & Pages** → **Create** → **Hello World** worker.
2. Replace its code with [`worker/cors-proxy.js`](worker/cors-proxy.js) and click **Deploy**.
3. In SomethingView, open **Settings → Proxy URL** and enter `https://<your-worker>.workers.dev/?url=`, then click **Test**.

The worker only forwards requests to Yahoo Finance, so it isn't an open proxy.

## Sync between devices

Watchlists, indicators and drawings sync automatically through the Worker (`/sync/<key>`, stored in Cloudflare D1).
Each browser gets a random sync key. To link your phone, click the dot in the top bar (or **Sync devices** in the
side strip) on the device that has your lists, then scan the QR code with the phone. From then on, changes on
either device show up on the other within about 20 seconds, or straight away when you switch back to the tab.
The current chart, timeframe and layout stay separate on each device.

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
