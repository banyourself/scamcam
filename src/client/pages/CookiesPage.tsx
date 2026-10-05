import { DocumentPage } from "@/components/layout/DocumentPage";

export function CookiesPage() {
  return (
    <DocumentPage
      title="Cookies"
      reference="SC-POL-04"
      updated="2026-10-05"
      draft
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
            <td>cf_clearance, __cf_bm, cf_chl_* (only when a check is needed)</td>
            <td>Cloudflare</td>
            <td>Security: telling people from bots and blocking attacks</td>
            <td>Strictly necessary</td>
          </tr>
        </tbody>
      </table>
      <p>
        Strictly necessary security storage does not need consent under EU and UK rules. If ScamCam ever adds anything
        else, it will ask first and this page will change.
      </p>
    </DocumentPage>
  );
}
