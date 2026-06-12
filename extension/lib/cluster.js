// Local semantic clustering of tabs from titles + URLs.
// TF-IDF cosine similarity with a shared-domain bonus, agglomerative average linkage.

const STOPWORDS = new Set([
  "the", "and", "for", "with", "that", "this", "you", "your", "from", "are",
  "was", "how", "what", "why", "when", "where", "can", "all", "not", "but",
  "has", "have", "had", "its", "into", "out", "get", "new", "use", "using",
  "best", "top", "guide", "www", "com", "org", "net", "html", "htm", "php",
  "index", "page", "pages", "amp", "via", "vs", "per", "more", "most", "one",
  "two", "about", "after", "before", "between", "does", "should", "will",
  "https", "http",
]);

const STALE_DAYS = 3;

function tokenize(tab) {
  const url = safeUrl(tab.url);
  const parts = [
    tab.title || "",
    url ? url.hostname.replace(/^www\./, "").split(".").slice(0, -1).join(" ") : "",
    url ? decodeURIComponent(url.pathname).replace(/[-_/]/g, " ") : "",
  ].join(" ");

  const tokens = [];
  for (let raw of parts.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length < 3 || raw.length > 30) continue;
    if (/^\d+$/.test(raw)) continue;
    if (raw.length > 4 && raw.endsWith("s")) raw = raw.slice(0, -1); // light stemming
    if (STOPWORDS.has(raw)) continue;
    tokens.push(raw);
  }
  return tokens;
}

function safeUrl(u) {
  try {
    return new URL(u);
  } catch {
    return null;
  }
}

// "registrable" domain, approximated: last two labels (good enough for clustering).
function domainOf(tab) {
  const url = safeUrl(tab.url);
  if (!url || !url.hostname.includes(".")) return null;
  return url.hostname.replace(/^www\./, "").split(".").slice(-2).join(".");
}

function buildVectors(tabs) {
  const docs = tabs.map(tokenize);
  const df = new Map();
  for (const tokens of docs) {
    for (const t of new Set(tokens)) df.set(t, (df.get(t) || 0) + 1);
  }
  const n = docs.length;
  return docs.map((tokens) => {
    const tf = new Map();
    for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1);
    const vec = new Map();
    let normSq = 0;
    for (const [t, count] of tf) {
      const w = count * Math.log(1 + n / (1 + df.get(t)));
      vec.set(t, w);
      normSq += w * w;
    }
    const norm = Math.sqrt(normSq) || 1;
    for (const [t, w] of vec) vec.set(t, w / norm);
    return vec;
  });
}

function cosine(a, b) {
  // iterate over the smaller vector
  const [small, big] = a.size <= b.size ? [a, b] : [b, a];
  let dot = 0;
  for (const [t, w] of small) {
    const w2 = big.get(t);
    if (w2) dot += w * w2;
  }
  return dot;
}

/**
 * Cluster tabs. Returns [{ id, label, tabs, lastAccessed, staleDays, isMisc }]
 * sorted: stale & large clusters first, misc bucket last.
 */
export function clusterTabs(tabs, { threshold = 0.12, domainBonus = 0.25 } = {}) {
  if (tabs.length === 0) return [];
  const vectors = buildVectors(tabs);
  const domains = tabs.map(domainOf);

  const sim = (i, j) => {
    let s = cosine(vectors[i], vectors[j]);
    if (domains[i] && domains[i] === domains[j]) s += domainBonus;
    return s;
  };

  // average-linkage agglomerative clustering over tab indexes
  let clusters = tabs.map((_, i) => [i]);
  for (;;) {
    let best = { score: threshold, a: -1, b: -1 };
    for (let a = 0; a < clusters.length; a++) {
      for (let b = a + 1; b < clusters.length; b++) {
        let total = 0;
        for (const i of clusters[a]) for (const j of clusters[b]) total += sim(i, j);
        const avg = total / (clusters[a].length * clusters[b].length);
        if (avg > best.score) best = { score: avg, a, b };
      }
    }
    if (best.a === -1) break;
    clusters[best.a] = clusters[best.a].concat(clusters[best.b]);
    clusters.splice(best.b, 1);
  }

  const real = [];
  const misc = [];
  for (const idxs of clusters) {
    (idxs.length > 1 ? real : misc).push(idxs);
  }

  const result = real.map((idxs, n) => makeCluster(`c${n}`, idxs, tabs, vectors, domains, false));
  if (misc.length > 0) {
    const idxs = misc.flat();
    result.push(makeCluster("misc", idxs, tabs, vectors, domains, true));
  }

  result.sort((a, b) => {
    if (a.isMisc !== b.isMisc) return a.isMisc ? 1 : -1;
    return b.staleDays - a.staleDays || b.tabs.length - a.tabs.length;
  });
  return result;
}

function makeCluster(id, idxs, tabs, vectors, domains, isMisc) {
  const clusterTabs = idxs.map((i) => tabs[i]);
  const lastAccessed = Math.max(...clusterTabs.map((t) => t.lastAccessed || 0));
  const staleDays = lastAccessed ? Math.floor((Date.now() - lastAccessed) / 86_400_000) : 0;
  return {
    id,
    label: isMisc ? "Everything else" : labelFor(idxs, vectors, domains),
    tabs: clusterTabs,
    lastAccessed,
    staleDays,
    isStale: staleDays >= STALE_DAYS,
    isMisc,
  };
}

function labelFor(idxs, vectors, domains) {
  // top tokens by summed weight, preferring tokens shared by 2+ tabs
  const sums = new Map();
  const seenIn = new Map();
  for (const i of idxs) {
    for (const [t, w] of vectors[i]) {
      sums.set(t, (sums.get(t) || 0) + w);
      seenIn.set(t, (seenIn.get(t) || 0) + 1);
    }
  }
  const shared = [...sums.entries()]
    .filter(([t]) => idxs.length === 1 || seenIn.get(t) >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([t]) => t);

  if (shared.length > 0) return shared.join(" · ");

  const domain = domains[idxs[0]];
  return domain || "Cluster";
}
