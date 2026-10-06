import { DocumentPage } from "@/components/layout/DocumentPage";
import { Link } from "@/router";

export function SecurityPage() {
  return (
    <DocumentPage
      title="Security"
      reference="SC-SEC-01"
      updated="2026-10-05"
      lead="ScamCam handles content that may be malicious, so it is built to never trust it."
    >
      <h2>How ScamCam protects itself and you</h2>
      <ul>
        <li>Submitted links are never opened, downloaded, or run. Every check is a passive lookup.</li>
        <li>Everything is served over HTTPS with strict security headers and a content security policy.</li>
        <li>All input is validated, size limited, and treated as data, never as instructions.</li>
        <li>Requests are rate limited, and a privacy-focused bot check protects the free limits.</li>
        <li>Errors never show internal details. Secrets are never stored in code.</li>
        <li>Dependencies are pinned, audited on every change, and updated weekly. Code and the built site are scanned for leaked secrets.</li>
        <li>No messages, full links, or IP addresses are stored, so there is little to leak.</li>
      </ul>
      <h2>Found a problem?</h2>
      <p>
        Please read the <Link to="/disclosure">vulnerability disclosure policy</Link> and email{" "}
        <a href="mailto:kevin@kevinle.tech">kevin@kevinle.tech</a>. The machine-readable contact is in{" "}
        <a href="/.well-known/security.txt">security.txt</a>.
      </p>
    </DocumentPage>
  );
}
