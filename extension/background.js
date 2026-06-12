// Tab Amnesty service worker: opens the app page and keeps the badge tab count fresh.

const APP_URL = chrome.runtime.getURL("app/app.html");

chrome.action.onClicked.addListener(async () => {
  const existing = await chrome.tabs.query({ url: APP_URL });
  if (existing.length > 0) {
    await chrome.tabs.update(existing[0].id, { active: true });
    await chrome.windows.update(existing[0].windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url: APP_URL });
  }
});

async function updateBadge() {
  const tabs = await chrome.tabs.query({});
  const count = tabs.filter((t) => !t.url?.startsWith("chrome")).length;
  await chrome.action.setBadgeText({ text: count > 0 ? String(count) : "" });
  await chrome.action.setBadgeBackgroundColor({ color: count > 25 ? "#c0392b" : "#5a6b7b" });
}

chrome.tabs.onCreated.addListener(updateBadge);
chrome.tabs.onRemoved.addListener(updateBadge);
chrome.runtime.onStartup.addListener(updateBadge);
chrome.runtime.onInstalled.addListener(updateBadge);
