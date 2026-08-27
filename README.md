# Grocery Price Watchlist

A dashboard that tracks prices for a watchlist of products across **Woolworths**,
**Coles**, and **Aldi**, flags items that are on sale or under your target price,
and compares the total cost of your basket between stores. No build step —
static HTML/CSS/JS.

## Running locally

Serve the folder as static files, e.g.:

```bash
python3 -m http.server 8080
```

Then open `http://localhost:8080`.

## How it works

- `data/watchlist.json` — the products you're tracking. Edit this to add/remove items.
- `scripts/fetch-grocery-prices.mjs` — a Node script that looks up the current
  price of each watchlist item and writes the result to `data/prices.json`.
- `.github/workflows/update-grocery-prices.yml` — runs that script once a day
  (06:00 AEST) and commits the updated `data/prices.json`. Scheduled workflows
  only run on the repo's default branch, so this starts firing once this
  branch is merged; until then (or any time) you can run it on demand from the
  **Actions** tab → *Update grocery prices* → **Run workflow**.
- `index.html` — reads `data/watchlist.json` and `data/prices.json` and
  renders the dashboard. Nothing is notified/pushed to you — this is a
  dashboard you check, with sale/target badges to make scanning it fast.

## Deploying

`.github/workflows/deploy-pages.yml` publishes the repo to GitHub Pages on
every push to `main`. One-time setup: in the repo's **Settings → Pages**, set
**Source** to "GitHub Actions" (the workflow's own token can't turn Pages on
by itself).

## Adding or editing a watchlist item

Add an entry to `data/watchlist.json`:

```json
{
  "id": "unique-slug",
  "name": "Product name",
  "category": "Category",
  "unit": "e.g. 1kg, 500g, 12pk",
  "targetPrice": 5.00,
  "stores": {
    "woolworths": { "searchTerm": "words to search for on woolworths.com.au" },
    "coles": { "searchTerm": "words to search for on coles.com.au" },
    "aldi": { "manualPrice": null }
  }
}
```

- `targetPrice` is optional — set it to get a "below target" badge when any
  store's price drops to or under it.
- `woolworths.searchTerm` / `coles.searchTerm` should match what you'd type
  into that store's own search box — the script takes the first/best result,
  so keep it specific (brand + size beats a generic term).
- Aldi has no public per-item price API in Australia, so its price is always
  manual. Update `aldi.manualPrice` yourself (e.g. from the weekly catalogue
  or a store visit). Optional fields: `manualWasPrice`, `manualOnSale` (true
  while a special is running), `manualUnitPrice`, `manualUpdated` (a date
  string, just for your own reference).

## Running the price fetch locally

```bash
node scripts/fetch-grocery-prices.mjs
```

Requires Node 18+ (built-in `fetch`). Writes `data/prices.json`.

## Limitations — read before relying on this

- **Woolworths and Coles run bot-detection** (Akamai / PerimeterX) in front
  of the pages/endpoints this script reads. Most days it should work, but a
  request can come back blocked (`status: "blocked"`) or the site's response
  shape can change and break parsing (`status: "error"`) without warning.
  The dashboard surfaces these statuses per store/item rather than hiding
  them — if something looks stale, check the status text on that item.
- **Coles specifically** has no open JSON search API anymore; the script
  parses the `__NEXT_DATA__` payload embedded in their search page HTML,
  which is more fragile than a real API and the most likely thing to need
  fixing if Coles changes their site.
- **Aldi** is manual-only, as above — there's no automated fetch for it.
- This is a best-effort tool for personal use, not guaranteed to be accurate
  or complete. Always confirm the real price in-store or at checkout before
  relying on it for a purchase decision.
