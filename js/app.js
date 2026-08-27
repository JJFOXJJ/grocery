(function () {
  "use strict";

  const STORAGE_KEY_THEME = "grocery-watchlist.theme";
  const STORE_LABELS = { woolworths: "Woolworths", coles: "Coles", aldi: "Aldi" };
  const STORE_ORDER = ["woolworths", "coles", "aldi"];

  const STATUS_MESSAGES = {
    "not-tracked": "Not tracked",
    "manual-not-set": "No manual price set — add one in watchlist.json",
    blocked: "Blocked by store today — will retry next run",
    error: "Fetch error — will retry next run",
    timeout: "Timed out — will retry next run",
    "no-match": "No matching product found",
  };

  const currencyFmt = new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" });
  function money(n) {
    return typeof n === "number" ? currencyFmt.format(n) : "—";
  }

  /* ---------- Theme ---------- */

  function initTheme() {
    const saved = localStorage.getItem(STORAGE_KEY_THEME);
    if (saved) document.documentElement.setAttribute("data-theme", saved);
    const btn = document.getElementById("theme-toggle");
    const icon = btn.querySelector(".theme-icon");
    const syncIcon = () => {
      const isDark =
        document.documentElement.getAttribute("data-theme") === "dark" ||
        (!document.documentElement.getAttribute("data-theme") &&
          window.matchMedia("(prefers-color-scheme: dark)").matches);
      icon.textContent = isDark ? "☀️" : "🌙";
    };
    syncIcon();
    btn.addEventListener("click", () => {
      const current = document.documentElement.getAttribute("data-theme");
      const isDarkNow =
        current === "dark" || (!current && window.matchMedia("(prefers-color-scheme: dark)").matches);
      const next = isDarkNow ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", next);
      localStorage.setItem(STORAGE_KEY_THEME, next);
      syncIcon();
    });
  }

  /* ---------- Data loading ---------- */

  async function loadJSON(relPath) {
    const res = await fetch(relPath, { cache: "no-store" });
    if (!res.ok) throw new Error(`Failed to load ${relPath}: HTTP ${res.status}`);
    return res.json();
  }

  /* ---------- Rendering ---------- */

  function relativeTimeFrom(iso) {
    const then = new Date(iso).getTime();
    const diffMs = Date.now() - then;
    const hours = diffMs / 3_600_000;
    if (hours < 1) return "less than an hour ago";
    if (hours < 24) return `${Math.round(hours)} hour${Math.round(hours) === 1 ? "" : "s"} ago`;
    const days = Math.round(hours / 24);
    return `${days} day${days === 1 ? "" : "s"} ago`;
  }

  function renderStatusBanner(prices) {
    const el = document.getElementById("status-banner");
    if (!prices.lastUpdated) {
      el.innerHTML =
        '<div class="status-banner">No price data yet. The daily update workflow ' +
        '(<code>.github/workflows/update-grocery-prices.yml</code>) hasn\'t run. Trigger it manually from ' +
        "the repo's Actions tab, or wait for the next scheduled run.</div>";
      return;
    }
    const ageHours = (Date.now() - new Date(prices.lastUpdated).getTime()) / 3_600_000;
    if (ageHours > 36) {
      el.innerHTML = `<div class="status-banner">Prices are stale — last updated ${relativeTimeFrom(
        prices.lastUpdated
      )}. Check that the scheduled workflow is still running.</div>`;
    } else {
      el.innerHTML = "";
    }
  }

  function renderLastUpdated(prices) {
    const el = document.getElementById("last-updated");
    el.textContent = prices.lastUpdated
      ? `Last updated ${relativeTimeFrom(prices.lastUpdated)} (${new Date(prices.lastUpdated).toLocaleString("en-AU")})`
      : "";
  }

  function renderSummary(items) {
    const el = document.getElementById("summary-row");
    const onSale = items.filter((i) => i.onSaleAnywhere).length;
    const belowTarget = items.filter((i) => i.belowTarget).length;
    const tracked = items.filter((i) => i.cheapest).length;

    const cards = [
      { num: items.length, label: "Watchlist items" },
      { num: onSale, label: "On sale", isSale: onSale > 0 },
      { num: belowTarget, label: "Below target price", isSale: belowTarget > 0 },
      { num: `${tracked}/${items.length}`, label: "Priced today" },
    ];

    el.innerHTML = cards
      .map(
        (c) => `
      <div class="summary-card${c.isSale ? " is-sale" : ""}">
        <div class="num">${c.num}</div>
        <div class="label">${c.label}</div>
      </div>`
      )
      .join("");
  }

  function renderBasketComparison(items) {
    const row = document.getElementById("basket-row");
    const note = document.getElementById("best-mix-note");

    const totals = {};
    for (const store of STORE_ORDER) {
      let sum = 0;
      let count = 0;
      for (const item of items) {
        const p = item.prices?.[store];
        if (p && typeof p.price === "number") {
          sum += p.price;
          count += 1;
        }
      }
      totals[store] = { sum, count };
    }

    let bestMixSum = 0;
    let bestMixCount = 0;
    for (const item of items) {
      if (item.cheapest) {
        bestMixSum += item.cheapest.price;
        bestMixCount += 1;
      }
    }

    const storeCards = STORE_ORDER.map((store) => {
      const { sum, count } = totals[store];
      return { key: store, label: STORE_LABELS[store], sum, count };
    });

    const complete = storeCards.filter((c) => c.count === items.length && items.length > 0);
    const cheapestComplete = complete.length
      ? complete.reduce((a, b) => (b.sum < a.sum ? b : a))
      : null;

    row.innerHTML = storeCards
      .map((c) => {
        const isBest = cheapestComplete && c.key === cheapestComplete.key;
        const incomplete = c.count < items.length;
        return `
        <div class="basket-card${isBest ? " is-best" : ""}">
          <div class="store-name">${c.label}</div>
          <div class="store-total">${c.count ? money(c.sum) : "—"}</div>
          <div class="store-note">${
            incomplete ? `${c.count} of ${items.length} items priced` : "Full basket priced"
          }</div>
        </div>`;
      })
      .join("");

    note.textContent = bestMixCount
      ? `Cheapest possible basket, buying each item at whichever store has it lowest today: ${money(
          bestMixSum
        )} (${bestMixCount} of ${items.length} items priced).`
      : "";
  }

  function storeCell(store, result) {
    const label = STORE_LABELS[store];
    const hasPrice = result && typeof result.price === "number";
    const isCheapest = hasPrice && result.__isCheapest;

    if (!hasPrice) {
      const msg = STATUS_MESSAGES[result?.status] || "No price available";
      return `
        <div class="store-price-cell">
          <div class="store-label">${label}</div>
          <div class="cell-status">${msg}</div>
        </div>`;
    }

    return `
      <div class="store-price-cell${isCheapest ? " is-cheapest" : ""}">
        <div class="store-label">
          <span>${label}${result.status === "manual" ? " · manual" : ""}</span>
          ${result.onSale ? '<span class="sale-badge">Sale</span>' : ""}
        </div>
        <div class="price">${money(result.price)}${
      result.wasPrice ? `<span class="was-price">${money(result.wasPrice)}</span>` : ""
    }</div>
        ${result.unitPrice ? `<div class="unit-price">${result.unitPrice}</div>` : ""}
      </div>`;
  }

  function renderItemList(items, filter) {
    const el = document.getElementById("item-list");
    const filtered = items.filter((item) => {
      if (filter === "sale") return item.onSaleAnywhere;
      if (filter === "target") return item.belowTarget;
      return true;
    });

    if (!filtered.length) {
      el.innerHTML = '<div class="empty-state">No items match this filter.</div>';
      return;
    }

    el.innerHTML = filtered
      .map((item) => {
        const cells = STORE_ORDER.map((store) => {
          const result = item.prices?.[store];
          if (result && item.cheapest && store === item.cheapest.store) {
            result.__isCheapest = true;
          }
          return storeCell(store, result);
        }).join("");

        return `
        <div class="item-card">
          <div class="item-top-row">
            <div>
              <div class="item-name">${item.name}</div>
              <div class="item-meta">${[item.category, item.unit].filter(Boolean).join(" · ")}</div>
            </div>
            <div style="display:flex; gap:6px; align-items:center;">
              ${item.onSaleAnywhere ? '<span class="sale-badge">On sale</span>' : ""}
              ${
                item.targetPrice != null
                  ? `<span class="target-badge">Target ${money(item.targetPrice)}</span>`
                  : ""
              }
            </div>
          </div>
          <div class="store-prices">${cells}</div>
        </div>`;
      })
      .join("");
  }

  function renderFilters(items, onChange) {
    const el = document.getElementById("filters");
    const counts = {
      all: items.length,
      sale: items.filter((i) => i.onSaleAnywhere).length,
      target: items.filter((i) => i.belowTarget).length,
    };
    const chips = [
      { key: "all", label: `All (${counts.all})` },
      { key: "sale", label: `On sale (${counts.sale})` },
      { key: "target", label: `Below target (${counts.target})` },
    ];
    let active = "all";

    function draw() {
      el.innerHTML = chips
        .map((c) => `<button class="chip${c.key === active ? " is-active" : ""}" data-filter="${c.key}">${c.label}</button>`)
        .join("");
      el.querySelectorAll(".chip").forEach((btn) => {
        btn.addEventListener("click", () => {
          active = btn.dataset.filter;
          draw();
          onChange(active);
        });
      });
    }
    draw();
  }

  /* ---------- Bootstrap ---------- */

  async function main() {
    initTheme();

    let watchlist = [];
    let prices = { lastUpdated: null, items: [] };
    try {
      [watchlist, prices] = await Promise.all([
        loadJSON("data/watchlist.json"),
        loadJSON("data/prices.json"),
      ]);
    } catch (err) {
      document.getElementById("status-banner").innerHTML =
        `<div class="status-banner">Couldn't load watchlist data: ${err.message}</div>`;
    }

    // Fall back to the watchlist itself (no price data yet) so the page
    // still shows something useful before the first automated run.
    const items =
      prices.items && prices.items.length
        ? prices.items
        : watchlist.map((w) => ({
            id: w.id,
            name: w.name,
            category: w.category,
            unit: w.unit,
            targetPrice: w.targetPrice ?? null,
            prices: {},
            cheapest: null,
            onSaleAnywhere: false,
            belowTarget: false,
          }));

    renderStatusBanner(prices);
    renderLastUpdated(prices);
    renderSummary(items);
    renderBasketComparison(items);
    renderFilters(items, (filter) => renderItemList(items, filter));
    renderItemList(items, "all");
  }

  main();
})();
