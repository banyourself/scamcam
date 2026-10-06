import { DocumentPage } from "@/components/layout/DocumentPage";

export function CookiesPage() {
  return (
    <DocumentPage
      title="Cookies"
      reference="SC-POL-04"
      updated="2026-10-05"
      lead="ScamCam does not use advertising, analytics, or tracking cookies, so there is no cookie banner."
    >
      <table>
        <thead>
          <tr>
            <th scope="col">Name</th>
            <th scope="col">Set by</th>
            <th scope="col">Purpose</th>
            <th scope="col">Type</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>scamcam-theme (browser storage, not a cookie)</td>
            <td>ScamCam</td>
            <td>Remembers light or dark theme on your device only</td>
            <td>Preference</td>
          </tr>
          <tr>
            <td>cf_clearance, __cf_bm, cf_chl_* (only if Cloudflare&apos;s security features need them)</td>
            <td>Cloudflare</td>
            <td>Security: telling people from bots and blocking attacks</td>
            <td>Strictly necessary</td>
          </tr>
        </tbody>
      </table>
      <p>
        ScamCam&apos;s own pages and API set no cookies. An automated check of every page and a full scan in a real
        browser found no cookies and no browser storage other than the theme choice. That check used Cloudflare&apos;s
        test keys, so it will be repeated on the live site before launch. Cloudflare describes its security cookies in
        its <a href="https://developers.cloudflare.com/fundamentals/reference/policies-compliances/cloudflare-cookies/">cookie list</a>.
      </p>
      <p>
        Strictly necessary security storage does not need consent under EU and UK rules. If ScamCam ever adds anything
        else, it will ask first and this page will change.
      </p>
    </DocumentPage>
  );
}
