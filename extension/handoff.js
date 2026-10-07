export const site = "https://scamcam.kevinle.tech/";
export const maxLength = 4000;

export function checkUrl(text) {
  const clean = String(text ?? "").trim().slice(0, maxLength);
  if (!clean) {
    return null;
  }
  const bytes = new TextEncoder().encode(clean);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  const encoded = btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
  return site + "#check=" + encoded;
}

export async function openCheck(text, tab) {
  const url = checkUrl(text);
  if (!url) {
    return false;
  }
  const where = tab && typeof tab.index === "number" ? { index: tab.index + 1, openerTabId: tab.id } : {};
  await chrome.tabs.create({ url, ...where });
  return true;
}

export function isWebPage(url) {
  return typeof url === "string" && /^https?:\/\//i.test(url) && !url.startsWith(site);
}
