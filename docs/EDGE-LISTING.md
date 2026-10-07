# Microsoft Edge Add-ons listing

What I enter in Partner Center (partner.microsoft.com, Microsoft Edge program, free) for the ScamCam extension. The
package is `scamcam-extension-<version>.zip`, built by `npm run build` into `dist/client/downloads/` and offered at
https://scamcam.kevinle.tech/extension.

## Properties

- Category: Productivity
- Privacy policy: https://scamcam.kevinle.tech/privacy
- Website: https://scamcam.kevinle.tech/extension
- Support: https://scamcam.kevinle.tech/contact
- Mature content: No

## Store listing

**Short description**

Right-click a link, a message, or a page to check it for scams on ScamCam. No access to the sites you visit.

**Description**

ScamCam (https://scamcam.kevinle.tech) is a free, noncommercial scam checker. It tells you whether a link or a message
is a scam and shows the evidence behind the answer, from fake Steam trades and "free Nitro" gifts to fake banks, job
scams, and fake invoices.

This extension makes checking one click:

- Right-click a link and choose Check this link with ScamCam.
- Select a suspicious message, right-click, and choose Check with ScamCam.
- Right-click a page to check the page you are on.
- Or click the toolbar button, or press Alt+Shift+S, and paste anything.

ScamCam opens in a new tab with your text filled in and checks it there.

Privacy: the extension has no access to any website and cannot read the pages you visit. It only passes along the
link, selection, or page address you choose, in the part of the address after #, which browsers never send to a
server. It stores nothing, uses no cookies, and has no tracking or ads.

**Search terms:** scam checker, phishing, link checker, Discord scam, Steam scam

## Permission justifications (for reviewers)

- `contextMenus`: adds Check with ScamCam to the right-click menu for links, selected text, and pages.
- `activeTab`: reads the address of the current tab only when the user clicks the toolbar button and chooses Check
  this page.
- No host permissions, no content scripts, no remote code, and no network requests from the extension itself.

## Notes for certification

No account is needed. Right-click any link and choose Check this link with ScamCam; a ScamCam tab opens and the check
runs after Cloudflare's Turnstile check.

## Screenshots

1280 by 800: the right-click menu on a link, the toolbar popup, and a ScamCam report opened from the extension.
