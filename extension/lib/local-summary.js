// No-API-key fallback: extractive note from titles, meta descriptions and first sentences.
// Keeps the close-with-artifact loop working offline; quality upgrade comes from llm.js.

function firstSentences(text, n = 2) {
  if (!text) return "";
  const cleaned = text.replace(/\s+/g, " ").trim();
  const sentences = cleaned.match(/[^.!?]+[.!?]+/g) || [cleaned];
  return sentences.slice(0, n).join(" ").trim().slice(0, 300);
}

export function localSummary({ label, pages }) {
  const lines = [`# ${label}`, "", "_Extractive summary (no API key configured)._", ""];
  for (const p of pages) {
    const gist = p.description || firstSentences(p.text);
    lines.push(`- **${p.title || p.url}**${gist ? ` — ${gist}` : ""}`);
  }
  lines.push("", "## Sources", "");
  for (const p of pages) lines.push(`- [${p.title || p.url}](${p.url})`);
  return lines.join("\n");
}

export function localTldr({ pages }) {
  return {
    items: pages.map((p) => ({
      url: p.url,
      tldr: p.description || firstSentences(p.text) || p.title || p.url,
      recommend_close: true,
    })),
  };
}
