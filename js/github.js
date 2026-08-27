// Thin client for the two write operations the dashboard needs against
// GitHub's REST API directly from the browser: triggering the price-update
// workflow, and committing a new watchlist item. GitHub's REST API allows
// CORS requests from any origin when a token is supplied, so no backend is
// needed — the token lives only in this browser's localStorage and is sent
// only to api.github.com.
(function () {
  "use strict";

  const GH_API = "https://api.github.com";
  const OWNER = "JJFOXJJ";
  const REPO = "grocery";
  const WORKFLOW_FILE = "update-grocery-prices.yml";
  const WATCHLIST_PATH = "data/watchlist.json";

  const LS_TOKEN = "grocery-watchlist.ghToken";
  const LS_BRANCH = "grocery-watchlist.ghBranch";

  function getToken() {
    return localStorage.getItem(LS_TOKEN) || "";
  }
  function setToken(token) {
    if (token) localStorage.setItem(LS_TOKEN, token);
    else localStorage.removeItem(LS_TOKEN);
  }
  function getBranch() {
    return localStorage.getItem(LS_BRANCH) || "main";
  }
  function setBranch(branch) {
    localStorage.setItem(LS_BRANCH, (branch || "main").trim());
  }
  function hasToken() {
    return Boolean(getToken());
  }

  async function ghFetch(path, options = {}) {
    const token = getToken();
    if (!token) throw new Error("No GitHub token configured — open Settings (🔑) to add one.");
    const res = await fetch(`${GH_API}${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(options.headers || {}),
      },
    });
    if (!res.ok) {
      let detail = "";
      try {
        detail = (await res.json()).message || "";
      } catch {
        /* body wasn't JSON */
      }
      throw new Error(`GitHub API ${res.status}${detail ? `: ${detail}` : ""}`);
    }
    return res.status === 204 ? null : res.json();
  }

  async function triggerPriceUpdate() {
    const branch = getBranch();
    await ghFetch(`/repos/${OWNER}/${REPO}/actions/workflows/${WORKFLOW_FILE}/dispatches`, {
      method: "POST",
      body: JSON.stringify({ ref: branch }),
    });
  }

  function slugify(name) {
    return name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "");
  }

  function b64EncodeUnicode(str) {
    return btoa(unescape(encodeURIComponent(str)));
  }
  function b64DecodeUnicode(str) {
    return decodeURIComponent(escape(atob(str.replace(/\n/g, ""))));
  }

  /**
   * item: { name, category, unit, targetPrice, woolworthsSearchTerm,
   *         colesSearchTerm, aldiManualPrice }
   * Reads the current watchlist.json, appends the new item, and commits it
   * back via the Contents API (a normal git commit on the configured branch).
   */
  async function addWatchlistItem(item) {
    const branch = getBranch();
    const current = await ghFetch(
      `/repos/${OWNER}/${REPO}/contents/${WATCHLIST_PATH}?ref=${encodeURIComponent(branch)}`
    );
    const list = JSON.parse(b64DecodeUnicode(current.content));

    let id = slugify(item.name);
    if (!id) id = `item-${Date.now()}`;
    if (list.some((i) => i.id === id)) id = `${id}-${Date.now().toString(36)}`;

    const entry = {
      id,
      name: item.name,
      category: item.category || null,
      unit: item.unit || null,
      targetPrice: typeof item.targetPrice === "number" ? item.targetPrice : null,
      stores: {
        woolworths: { searchTerm: item.woolworthsSearchTerm || item.name },
        coles: { searchTerm: item.colesSearchTerm || item.name },
        aldi: { manualPrice: typeof item.aldiManualPrice === "number" ? item.aldiManualPrice : null },
      },
    };
    list.push(entry);

    await ghFetch(`/repos/${OWNER}/${REPO}/contents/${WATCHLIST_PATH}`, {
      method: "PUT",
      body: JSON.stringify({
        message: `Add "${item.name}" to grocery watchlist`,
        content: b64EncodeUnicode(JSON.stringify(list, null, 2) + "\n"),
        sha: current.sha,
        branch,
      }),
    });

    return entry;
  }

  window.GroceryGitHub = {
    OWNER,
    REPO,
    getToken,
    setToken,
    getBranch,
    setBranch,
    hasToken,
    triggerPriceUpdate,
    addWatchlistItem,
  };
})();
