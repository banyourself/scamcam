import { DocumentPage } from "@/components/layout/DocumentPage";
import { Link } from "@/router";

export const extensionVersion = "1.0.0";
const zip = `/downloads/scamcam-extension-${extensionVersion}.zip`;

export function ExtensionPage() {
  return (
    <DocumentPage
      title="Browser extension"
      reference="SC-DOC-03"
      updated="2026-10-07"
      lead="Check a link, a message, or a whole page without copying and pasting. Right-click it and choose Check with ScamCam."
    >
      <h2>What it does</h2>
      <ul>
        <li>Right-click a link and choose Check this link with ScamCam.</li>
        <li>Select a suspicious message, right-click, and choose Check with ScamCam.</li>
        <li>Right-click an empty part of a page to check the page you are on.</li>
        <li>Or click the ScamCam button in the toolbar, or press Alt+Shift+S, and paste anything to check.</li>
      </ul>
      <p>
        Each one opens ScamCam in a new tab with your text filled in, and the check starts by itself after the usual security
        check. The result is the same report you get on this site.
      </p>

      <h2>Install it</h2>
      <p>The extension is on its way to the Microsoft Edge Add-ons store. Until then, install it by hand in Edge or Chrome:</p>
      <ol>
        <li>
          <a href={zip} download>
            Download scamcam-extension-{extensionVersion}.zip
          </a>{" "}
          and unzip it into a folder you will keep.
        </li>
        <li>Open edge://extensions or chrome://extensions and turn on Developer mode.</li>
        <li>Choose Load unpacked and pick the unzipped folder.</li>
      </ol>

      <h2>Privacy</h2>
      <ul>
        <li>It cannot read the pages you visit. It has no access to any website, only to the link, selection, or page address you right-click.</li>
        <li>Nothing leaves your computer until ScamCam opens. The text travels in the part of the address after #, which browsers never send to a server, and ScamCam clears it from the address right away.</li>
        <li>It stores nothing, uses no cookies, and has no tracking or ads.</li>
        <li>
          What happens to a check after that is in the <Link to="/privacy">privacy policy</Link>.
        </li>
      </ul>

      <h2>Permissions it asks for</h2>
      <ul>
        <li>Context menus, to add Check with ScamCam to the right-click menu.</li>
        <li>Active tab, to read the address of the tab you are on, only when you click its button.</li>
      </ul>
    </DocumentPage>
  );
}
