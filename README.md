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

## Using the dashboard's GitHub-connected controls

Two things on the page — the **🔄 Update prices now** button and the
**+ Add item** form — write back to this repo directly from your browser,
using GitHub's REST API (which supports authenticated cross-origin requests,
so no backend is needed):

- **Update prices now** triggers the `update-grocery-prices` workflow
  (`workflow_dispatch`) immediately instead of waiting for the daily 06:00
  AEST run.
- **+ Add item** commits a new entry straight into `data/watchlist.json`
  (a normal git commit, via the Contents API) without editing JSON by hand.

Both need a GitHub token, set once via the **🔑** button in the header:

1. Create a token scoped to just this repo — either a
   [fine-grained PAT](https://github.com/settings/personal-access-tokens/new)
   with **Contents: Read and write** and **Actions: Read and write**
   permissions on `JJFOXJJ/grocery`, or a classic PAT with the `repo` and
   `workflow` scopes.
2. Paste it into the settings panel along with the branch to commit to /
   run the workflow on (usually `main`; use your feature branch's name if
   you're testing before merging).

The token is stored only in that browser's `localStorage` and sent only to
`api.github.com` — it's never committed or sent anywhere else. Anyone with
access to that browser profile can read it back out of localStorage, so
don't set this up on a shared/public computer, and revoke the token from
GitHub's settings if you ever want to cut off access. Everything else on the
dashboard (viewing prices, filtering, the basket comparison) works with no
token at all.

## Adding or editing a watchlist item

The **+ Add item** form on the dashboard covers the common case. To edit an
item's details, add fields it doesn't expose (like `manualWasPrice`), or
remove an item, edit `data/watchlist.json` directly:

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
