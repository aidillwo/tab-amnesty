// Claude Messages API client. Raw fetch (no SDK) to keep the extension build-free.
// The anthropic-dangerous-direct-browser-access header opts into browser-originated
// calls; the key is the user's own, stored locally.

const API_URL = "https://api.anthropic.com/v1/messages";
export const DEFAULT_MODEL = "claude-opus-4-8";
export const MODELS = [
  { id: "claude-opus-4-8", label: "Claude Opus 4.8 (best quality)" },
  { id: "claude-haiku-4-5", label: "Claude Haiku 4.5 (fast & cheap)" },
];

async function callClaude({ apiKey, model, system, prompt, schema, maxTokens = 16000 }) {
  const body = {
    model: model || DEFAULT_MODEL,
    max_tokens: maxTokens,
    system,
    messages: [{ role: "user", content: prompt }],
  };
  if (schema) {
    body.output_config = { format: { type: "json_schema", schema } };
  }

  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    let message = `Claude API error (${res.status})`;
    try {
      const err = await res.json();
      if (err?.error?.message) message = err.error.message;
    } catch { /* keep generic message */ }
    throw new Error(message);
  }

  const data = await res.json();
  if (data.stop_reason === "refusal") {
    throw new Error("Claude declined this request.");
  }
  const text = (data.content || []).find((b) => b.type === "text")?.text;
  if (!text) throw new Error("Claude returned an empty response.");
  return schema ? JSON.parse(text) : text;
}

function pagesBlock(pages) {
  return pages
    .map(
      (p, i) =>
        `<page index="${i + 1}" url="${p.url}">\n` +
        `Title: ${p.title}\n` +
        (p.description ? `Description: ${p.description}\n` : "") +
        (p.text ? `Content:\n${p.text}\n` : "(content unavailable — title and URL only)\n") +
        `</page>`
    )
    .join("\n\n");
}

/** One markdown note for a cluster of pages. */
export function summarizeCluster({ apiKey, model, label, pages }) {
  return callClaude({
    apiKey,
    model,
    system:
      "You distill a cluster of browser tabs into ONE short markdown note so the user can close them all without losing anything. Lead with the takeaways. Be selective: capture what the user would actually want later, drop boilerplate. End with a 'Sources' section listing each page as a markdown link.",
    prompt: `The cluster is about: "${label}". Here are the pages:\n\n${pagesBlock(pages)}\n\nWrite the note now. Markdown only, no preamble.`,
  });
}

/** Comparison table for a cluster (products, jobs, flights, ...). */
export function extractTable({ apiKey, model, label, pages }) {
  return callClaude({
    apiKey,
    model,
    schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Short title for the comparison" },
        columns: {
          type: "array",
          items: { type: "string" },
          description: "Column headers. First column identifies the item; include the differences that actually matter (price, specs, deadlines...).",
        },
        rows: {
          type: "array",
          items: { type: "array", items: { type: "string" } },
          description: "One row per compared item, cells aligned to columns. Use '—' for unknowns.",
        },
        note: { type: "string", description: "One-sentence verdict or caveat, or empty string" },
      },
      required: ["title", "columns", "rows", "note"],
      additionalProperties: false,
    },
    system:
      "You turn a cluster of browser tabs (typically competing products, job postings, travel options, or similar) into one structured comparison table, extracting concrete data: prices, deadlines, specs, links. Compare only what differs meaningfully.",
    prompt: `The cluster is about: "${label}". Here are the pages:\n\n${pagesBlock(pages)}\n\nExtract the comparison table.`,
  });
}

/** Per-tab TLDRs with a keep/close recommendation. */
export function tldrTabs({ apiKey, model, pages }) {
  return callClaude({
    apiKey,
    model,
    schema: {
      type: "object",
      properties: {
        items: {
          type: "array",
          items: {
            type: "object",
            properties: {
              url: { type: "string" },
              tldr: { type: "string", description: "One sentence: what this page says / offers. Honest, specific." },
              recommend_close: {
                type: "boolean",
                description: "true if the tldr captures everything worth keeping (most pages); false only if the page needs real engagement (a tool in use, a long must-read, a form in progress).",
              },
            },
            required: ["url", "tldr", "recommend_close"],
            additionalProperties: false,
          },
        },
      },
      required: ["items"],
      additionalProperties: false,
    },
    system:
      "You write a brutally honest one-line TLDR for each open browser tab so the user can decide keep-or-close in seconds. Include one item per page, same order, exact same URLs.",
    prompt: `Here are the pages:\n\n${pagesBlock(pages)}\n\nTLDR each one.`,
  });
}
