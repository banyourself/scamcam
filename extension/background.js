import { isWebPage, openCheck } from "./handoff.js";

const web = ["http://*/*", "https://*/*"];

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: "link", title: "Check this link with ScamCam", contexts: ["link"] });
    chrome.contextMenus.create({ id: "selection", title: "Check \"%s\" with ScamCam", contexts: ["selection"] });
    chrome.contextMenus.create({ id: "page", title: "Check this page with ScamCam", contexts: ["page"], documentUrlPatterns: web });
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "link") {
    void openCheck(info.linkUrl, tab);
  } else if (info.menuItemId === "selection") {
    void openCheck(info.selectionText, tab);
  } else if (info.menuItemId === "page" && isWebPage(info.pageUrl)) {
    void openCheck(info.pageUrl, tab);
  }
});
