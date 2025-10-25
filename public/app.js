const els = {
  form: document.getElementById("searchForm"),
  query: document.getElementById("query"),
  results: document.getElementById("results"),
  status: document.getElementById("status"),
};

for (const [k, el] of Object.entries(els)) {
  if (!el) console.warn(`[init] Missing #${k} element`);
}

els.query?.focus();
setStatus("Type an artist name and press Enter.", "hint");

//  UI helpers
function setStatus(text, cls = "hint") {
  els.status.className = cls;
  els.status.textContent = text;
}

// I learned from [MDN’s “Cross-Site Scripting” guide] https://developer.mozilla.org/en-US/docs/Glossary/Cross-site_scripting that it’s a good idea to escape user or API text before injecting it into HTML.
function escapeHTML(s = "") {
  return s.replace(
    /[&<>"']/g,
    (m) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      }[m])
  );
}

// Normalization
function extractNameFromWiki(url = "") {
  try {
    const last = url.split("/").filter(Boolean).pop() || "";
    return decodeURIComponent(last.replace(/_/g, " "));
  } catch {
    return "";
  }
}

// TasteDive sometimes returns inconsistent key names.
// I standardized them here so I can display data more easily.
function normalizeItem(raw = {}) {
  const name =
    raw.Name ??
    raw.name ??
    raw.Title ??
    raw.title ??
    extractNameFromWiki(raw.wUrl ?? raw.wurl ?? "") ??
    "Unknown";

  const wiki = raw.wUrl ?? raw.wurl ?? "";
  const yt =
    raw.yUrl ?? raw.yurl ?? (raw.yID ? `https://youtu.be/${raw.yID}` : "");

  return { name, wiki, yt };
}

// Images via Wikipedia
// I used the Wikipedia REST Summary endpoint for artist thumbnails.
// (Docs: https://www.mediawiki.org/wiki/API:REST_API/Reference#Summary)
const imageCache = new Map();

async function fetchWikiThumb(title) {
  if (!title) return null;
  const endpoint = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(
    title
  )}`;
  const res = await fetch(endpoint, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) return null;
  const data = await res.json().catch(() => ({}));
  return data?.thumbnail?.source || data?.originalimage?.source || null;
}

function wikiTitleFrom(url = "", fallback = "") {
  return extractNameFromWiki(url) || fallback;
}

async function getArtistImage(name, wiki) {
  const key = wiki || name;
  if (imageCache.has(key)) return imageCache.get(key);
  let url = null;
  try {
    const title = wikiTitleFrom(wiki, name);
    url = await fetchWikiThumb(title);
  } catch {
    url = null;
  }
  imageCache.set(key, url);
  return url;
}

// I removed the description and “Music” tag to match my design more closely.
function toCardHTML(item) {
  const name = item.name || "Unknown";
  const wiki = item.wiki || "";
  const yt = item.yt || "";
  const img = item.img || null;

  const imgEl = img
    ? `<img src="${img}" alt="${escapeHTML(
        name
      )}" loading="lazy" style="width:100%;aspect-ratio:1/1;object-fit:cover;border-radius:12px;background:#dfe6ff;">`
    : `<div class="thumb-fallback" aria-label="No image" role="img"></div>`;

  return `
    <article class="card" role="article" aria-label="${escapeHTML(name)}">
      ${imgEl}
      <h3>${escapeHTML(name)}</h3>
      <div class="links">
        ${
          wiki
            ? `<a href="${wiki}" target="_blank" rel="noopener">Wiki</a>`
            : ""
        }
        ${
          yt ? `<a href="${yt}" target="_blank" rel="noopener">YouTube</a>` : ""
        }
        ${
          wiki
            ? `<a href="${wiki}" target="_blank" rel="noopener">Explore</a>`
            : ""
        }
      </div>
    </article>
  `;
}

// Fetch flow
// I used my Node.js backend as a proxy to TasteDive to avoid CORS issues.
async function fetchRecommendations(q) {
  try {
    setStatus(`Searching “${q}”…`, "loader");
    els.results.innerHTML = "";

    // I used URLSearchParams (from [MDN](https://developer.mozilla.org/en-US/docs/Web/API/URLSearchParams))to safely build the query string.
    const params = new URLSearchParams({
      q,
      limit: "18",
      ts: String(Date.now()),
    });
    const res = await fetch(`/api/recommend?${params.toString()}`, {
      headers: { Accept: "application/json" },
    });

    const ct = res.headers.get("content-type") || "";
    let data;
    if (ct.includes("application/json") || ct.includes("text/javascript")) {
      data = await res.json();
    } else {
      const text = await res.text();
      console.error("Unexpected content-type:", ct, text.slice(0, 200));
      setStatus("Unexpected response format from server.", "error");
      return;
    }

    const root = data.Similar || data.similar || data;
    const results = root.Results || root.results || [];
    const info = root.Info || root.info || [];
    const seed = info?.[0]?.Name || info?.[0]?.name || q;

    if (!Array.isArray(results) || results.length === 0) {
      setStatus(
        `No matches for “${seed}”. Try another artist or spelling.`,
        "empty"
      );
      els.results.innerHTML = "";
      return;
    }

    // I used Promise.all() here so I can fetch all the Wikipedia thumbnails in parallel.
    const normalized = results.map(normalizeItem);
    const enriched = await Promise.all(
      normalized.map(async (it) => ({
        ...it,
        img: await getArtistImage(it.name, it.wiki),
      }))
    );

    setStatus(`Similar to: ${seed}`, "hint");
    els.results.innerHTML = enriched.map(toCardHTML).join("");
  } catch (err) {
    console.error("Frontend error:", err);
    setStatus("Couldn’t fetch results. Please try again.", "error");
    els.results.innerHTML = "";
  }
}

// Events
// I added a simple debounce here (from [MDN’s event handling examples](https://developer.mozilla.org/en-US/docs/Web/Events/Creating_and_triggering_events#throttling_and_debouncing)) so the app waits a bit before searching while I type.
els.form.addEventListener("submit", (e) => {
  e.preventDefault();
  const q = (els.query.value || "").trim();
  if (!q) return setStatus("Type an artist name and press Enter.", "empty");
  fetchRecommendations(q);
});

let debounceTimer;
els.query.addEventListener("input", () => {
  clearTimeout(debounceTimer);
  const q = (els.query.value || "").trim();
  if (!q) {
    setStatus("Type an artist name and press Enter.", "hint");
    els.results.innerHTML = "";
    return;
  }
  debounceTimer = setTimeout(() => {
    if (q.length >= 3) fetchRecommendations(q);
  }, 450);
});
