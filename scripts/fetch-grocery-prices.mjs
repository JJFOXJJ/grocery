#!/usr/bin/env node
// Fetches current prices for every item in data/watchlist.json and writes
// the result to data/prices.json.
//
// Woolworths and Coles expose product data through endpoints their own
// website's JavaScript consumes; this script talks to those endpoints
// directly with a normal browser User-Agent and Accept headers, the same
// way any HTTP client would. Both retailers run bot-detection (Akamai /
// PerimeterX) that can block automated requests unpredictably, so every
// store lookup is best-effort: a blocked or changed response degrades to a
// clear "status" on that item/store rather than crashing the run. Aldi
// Australia has no public per-item catalogue API at all, so its prices
// always come from the "manualPrice" field in watchlist.json.
//
// Run: node scripts/fetch-grocery-prices.mjs

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const WATCHLIST_PATH = path.join(ROOT, "data/watchlist.json");
const PRICES_PATH = path.join(ROOT, "data/prices.json");

const REQUEST_TIMEOUT_MS = 15000;
const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "application/json, text/html;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-AU,en;q=0.9",
};

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

/**
 * Woolworths' storefront search API. Community-documented, publicly
 * reachable JSON endpoint (no auth) as of last check, but Woolworths can
 * gate it behind bot-detection at any time, in which case this reports a
 * "blocked" status for the item instead of throwing.
 */
async function fetchWoolworths(searchTerm) {
  const url = `https://www.woolworths.com.au/apis/ui/Search/products?searchTerm=${encodeURIComponent(
    searchTerm
  )}&pageNumber=1&pageSize=5`;
  try {
    const res = await fetchWithTimeout(url, {
      headers: {
        ...BROWSER_HEADERS,
        Referer: "https://www.woolworths.com.au/shop/search/products",
      },
    });
    if (!res.ok) {
      return { status: res.status === 403 ? "blocked" : "error", error: `HTTP ${res.status}` };
    }
    const data = await res.json();
    const group = Array.isArray(data?.Products) ? data.Products.find((g) => g?.Products?.length) : null;
    const product = group?.Products?.[0];
    if (!product) return { status: "no-match" };

    return {
      status: "ok",
      productName: product.Name ?? null,
      price: typeof product.Price === "number" ? round2(product.Price) : null,
      wasPrice: typeof product.WasPrice === "number" && product.WasPrice > product.Price ? round2(product.WasPrice) : null,
      onSale: Boolean(product.IsOnSpecial),
      unitPrice: product.CupString ?? null,
    };
  } catch (err) {
    return { status: err.name === "AbortError" ? "timeout" : "error", error: String(err.message || err) };
  }
}

/**
 * Coles no longer exposes an open JSON search API — product data is
 * embedded in the server-rendered search page as a Next.js `__NEXT_DATA__`
 * JSON blob. This is inherently fragile (Coles can reshape that payload or
 * tighten bot-detection at any time), so any shape mismatch or block
 * degrades to a status instead of throwing.
 */
async function fetchColes(searchTerm) {
  const url = `https://www.coles.com.au/search?q=${encodeURIComponent(searchTerm)}`;
  try {
    const res = await fetchWithTimeout(url, {
      headers: { ...BROWSER_HEADERS, Accept: "text/html,application/xhtml+xml" },
    });
    if (!res.ok) {
      return { status: res.status === 403 ? "blocked" : "error", error: `HTTP ${res.status}` };
    }
    const html = await res.text();
    const match = html.match(
      /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/
    );
    if (!match) return { status: "blocked", error: "no __NEXT_DATA__ payload (likely bot-challenge page)" };

    const data = JSON.parse(match[1]);
    const results =
      data?.props?.pageProps?.searchResults?.results ??
      data?.props?.pageProps?.searchResults?.products ??
      [];
    const product = results.find((r) => r?.pricing || r?.price);
    if (!product) return { status: "no-match" };

    const pricing = product.pricing ?? {};
    const price = typeof pricing.now === "number" ? pricing.now : typeof product.price === "number" ? product.price : null;
    const wasPrice = typeof pricing.was === "number" ? pricing.was : null;

    return {
      status: price == null ? "no-match" : "ok",
      productName: product.name ?? product.description ?? null,
      price: price != null ? round2(price) : null,
      wasPrice: wasPrice && wasPrice > price ? round2(wasPrice) : null,
      onSale: Boolean(pricing.isOnSpecial ?? pricing.onSpecial ?? (wasPrice && wasPrice > price)),
      unitPrice: pricing.comparable ?? null,
    };
  } catch (err) {
    return { status: err.name === "AbortError" ? "timeout" : "error", error: String(err.message || err) };
  }
}

/** Aldi AU has no public per-item price API — always sourced from manual entry. */
function readAldi(config) {
  if (!config || typeof config.manualPrice !== "number") {
    return { status: "manual-not-set" };
  }
  return {
    status: "manual",
    price: round2(config.manualPrice),
    wasPrice: typeof config.manualWasPrice === "number" ? round2(config.manualWasPrice) : null,
    onSale: Boolean(config.manualOnSale),
    unitPrice: config.manualUnitPrice ?? null,
    asOf: config.manualUpdated ?? null,
  };
}

async function fetchItemPrices(item) {
  const stores = item.stores || {};
  const [woolworths, coles] = await Promise.all([
    stores.woolworths ? fetchWoolworths(stores.woolworths.searchTerm) : Promise.resolve({ status: "not-tracked" }),
    stores.coles ? fetchColes(stores.coles.searchTerm) : Promise.resolve({ status: "not-tracked" }),
  ]);
  const aldi = stores.aldi ? readAldi(stores.aldi) : { status: "not-tracked" };

  const prices = { woolworths, coles, aldi };

  let cheapest = null;
  for (const [store, result] of Object.entries(prices)) {
    if (typeof result.price === "number") {
      if (!cheapest || result.price < cheapest.price) cheapest = { store, price: result.price };
    }
  }

  return {
    id: item.id,
    name: item.name,
    category: item.category ?? null,
    unit: item.unit ?? null,
    targetPrice: typeof item.targetPrice === "number" ? item.targetPrice : null,
    prices,
    cheapest,
    onSaleAnywhere: Object.values(prices).some((r) => r.onSale),
    belowTarget:
      typeof item.targetPrice === "number" && cheapest ? cheapest.price <= item.targetPrice : false,
  };
}

async function main() {
  const watchlist = JSON.parse(await readFile(WATCHLIST_PATH, "utf8"));
  if (!Array.isArray(watchlist)) {
    throw new Error(`${WATCHLIST_PATH} must contain a JSON array`);
  }

  console.log(`Fetching prices for ${watchlist.length} watchlist item(s)...`);

  const items = [];
  for (const item of watchlist) {
    process.stdout.write(`  - ${item.name}... `);
    const result = await fetchItemPrices(item);
    const statuses = Object.entries(result.prices)
      .map(([store, r]) => `${store}=${r.status}`)
      .join(", ");
    console.log(statuses);
    items.push(result);
  }

  const output = {
    lastUpdated: new Date().toISOString(),
    generatedBy: "scripts/fetch-grocery-prices.mjs",
    items,
  };

  await writeFile(PRICES_PATH, JSON.stringify(output, null, 2) + "\n");
  console.log(`Wrote ${PRICES_PATH}`);
}

main().catch((err) => {
  console.error("Fatal error running price fetch:", err);
  process.exitCode = 1;
});
