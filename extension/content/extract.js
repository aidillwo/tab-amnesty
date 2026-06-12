// Injected on demand via chrome.scripting.executeScript — never a persistent content script.
// Returns the page's readable text for the one cluster the user chose to resolve.
// Exposed as a plain function so app.js can pass it as `func` to executeScript.

export function extractPageContent() {
  const MAX_CHARS = 8000;

  const meta =
    document.querySelector('meta[name="description"]')?.content ||
    document.querySelector('meta[property="og:description"]')?.content ||
    "";

  let root =
    document.querySelector("article") ||
    document.querySelector("main") ||
    document.querySelector('[role="main"]') ||
    document.body;

  let text = (root?.innerText || "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (text.length > MAX_CHARS) text = text.slice(0, MAX_CHARS) + "\n[truncated]";

  return {
    title: document.title,
    url: location.href,
    description: meta.slice(0, 500),
    text,
  };
}
