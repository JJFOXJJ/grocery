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

  /* ---------- GitHub-backed controls (update button, settings, add item) ---------- */

  function setStatus(el, text, kind) {
    el.textContent = text;
    el.className = "action-status" + (kind ? ` is-${kind}` : "");
  }

  function initSettingsModal() {
    const gh = window.GroceryGitHub;
    const modal = document.getElementById("settings-modal");
    const tokenInput = document.getElementById("gh-token-input");
    const branchInput = document.getElementById("gh-branch-input");
    const status = document.getElementById("settings-status");

    function open() {
      tokenInput.value = gh.getToken();
      branchInput.value = gh.getBranch();
      setStatus(status, gh.hasToken() ? "Currently connected." : "No token saved yet.");
      modal.hidden = false;
    }
    function close() {
      modal.hidden = true;
    }

    document.getElementById("settings-btn").addEventListener("click", open);
    document.getElementById("settings-close").addEventListener("click", close);
    modal.addEventListener("click", (e) => {
      if (e.target === modal) close();
    });

    document.getElementById("settings-save").addEventListener("click", () => {
      gh.setToken(tokenInput.value.trim());
      gh.setBranch(branchInput.value.trim() || "main");
      setStatus(status, "Saved.", "ok");
      syncRunUpdateAvailability();
    });

    document.getElementById("settings-clear").addEventListener("click", () => {
      gh.setToken("");
      tokenInput.value = "";
      setStatus(status, "Token cleared.", "ok");
      syncRunUpdateAvailability();
    });
  }

  function syncRunUpdateAvailability() {
    const btn = document.getElementById("run-update-btn");
    const status = document.getElementById("run-update-status");
    if (!window.GroceryGitHub.hasToken()) {
      btn.disabled = true;
      setStatus(status, "Add a GitHub token in Settings (🔑) to enable this.");
    } else {
      btn.disabled = false;
      setStatus(status, "");
    }
  }

  function initRunUpdateButton() {
    const gh = window.GroceryGitHub;
    const btn = document.getElementById("run-update-btn");
    const status = document.getElementById("run-update-status");

    syncRunUpdateAvailability();

    btn.addEventListener("click", async () => {
      btn.disabled = true;
      setStatus(status, "Triggering workflow run...");
      try {
        await gh.triggerPriceUpdate();
        setStatus(
          status,
          "Triggered — check the Actions tab for progress. Reload this page in a minute or two once it finishes.",
          "ok"
        );
      } catch (err) {
        setStatus(status, err.message, "error");
      } finally {
        btn.disabled = !gh.hasToken();
      }
    });
  }

  function readNewItemForm() {
    const num = (id) => {
      const v = document.getElementById(id).value.trim();
      return v === "" ? null : Number(v);
    };
    const str = (id) => document.getElementById(id).value.trim();
    return {
      name: str("new-item-name"),
      category: str("new-item-category"),
      unit: str("new-item-unit"),
      targetPrice: num("new-item-target"),
      woolworthsSearchTerm: str("new-item-woolworths"),
      colesSearchTerm: str("new-item-coles"),
      aldiManualPrice: num("new-item-aldi"),
    };
  }

  function initAddItemForm(onAdded) {
    const gh = window.GroceryGitHub;
    const toggle = document.getElementById("add-item-toggle");
    const form = document.getElementById("add-item-form");
    const status = document.getElementById("add-item-status");
    const submitBtn = document.getElementById("add-item-submit");

    toggle.addEventListener("click", () => {
      form.hidden = !form.hidden;
      toggle.textContent = form.hidden ? "+ Add item" : "Cancel";
    });

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const draft = readNewItemForm();
      if (!draft.name) {
        setStatus(status, "Name is required.", "error");
        return;
      }
      if (!gh.hasToken()) {
        setStatus(status, "Add a GitHub token in Settings (🔑) first.", "error");
        return;
      }
      submitBtn.disabled = true;
      setStatus(status, "Committing to watchlist.json...");
      try {
        const entry = await gh.addWatchlistItem(draft);
        setStatus(
          status,
          `Added "${draft.name}". It'll show real prices after the next update.`,
          "ok"
        );
        form.reset();
        form.hidden = true;
        toggle.textContent = "+ Add item";
        onAdded(entry);
      } catch (err) {
        setStatus(status, err.message, "error");
      } finally {
        submitBtn.disabled = false;
      }
    });
  }

  /* ---------- Bootstrap ---------- */

  async function main() {
    initTheme();
    initSettingsModal();
    initRunUpdateButton();

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

    let currentFilter = "all";
    function refreshAll() {
      renderSummary(items);
      renderBasketComparison(items);
      renderFilters(items, (filter) => {
        currentFilter = filter;
        renderItemList(items, currentFilter);
      });
      renderItemList(items, currentFilter);
    }

    renderStatusBanner(prices);
    renderLastUpdated(prices);
    refreshAll();

    initAddItemForm((entry) => {
      items.push({
        id: entry.id,
        name: entry.name,
        category: entry.category,
        unit: entry.unit,
        targetPrice: entry.targetPrice,
        prices: {},
        cheapest: null,
        onSaleAnywhere: false,
        belowTarget: false,
      });
      refreshAll();
    });
  }

  main();
})();
