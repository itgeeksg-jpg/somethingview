# SomethingView: notes for Claude

A TradingView-style charting app built from plain static files: ES modules in `js/`, with no build step and no npm deps. `README.md` covers the
features, data sources and hosting.

## Shipping a change

1. Bump `version.json` in every commit that changes the app (`{"version": "YYYYMMDDHHMMSS"}`). Open tabs poll it
   and reload when it changes.
2. Commit and push to `main`. **Pushing does not update the live site.**
3. Deploy the Worker: `cd worker && npx wrangler deploy`. Claude isn't allowed to run production deploys, so ask
   the user to run `! cd worker && npx wrangler deploy` after every push. If the output says "No updated asset
   files to upload", that's fine: the files were already live from an earlier deploy.

Live site: https://somethingview.itgeeksg.workers.dev (behind a login).

## Code

- Build DOM with `h()` from `js/util.js`. App state lives in `store.s` (`store.save()` persists and syncs).
- `resolve(key)` in `js/symbols.js` maps a symbol to `{src: 'binance' | 'yahoo' | 'synthetic', ...}`. Binance is
  real-time over websocket. Yahoo is polled every `settings.refreshSec` (default 30s) through the Worker proxy.
- Background tabs: `requestAnimationFrame` doesn't run when the tab is hidden, and timers are throttled there. Don't
  let anything the tab title depends on wait on rAF or skip work when `document.hidden`.
- Testing: there are no automated tests. Run `node --check` on edited files. Locally, `python3 -m http.server 8000`
  serves the UI, but Yahoo data needs the Worker.
- Commit message style: `Area: what changed` (e.g. `Converter: USDT ⇄ fiat`).
