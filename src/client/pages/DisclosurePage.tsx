import { DocumentPage } from "@/components/layout/DocumentPage";

export function DisclosurePage() {
  return (
    <DocumentPage title="Vulnerability disclosure" reference="SC-SEC-02" updated="2026-10-05">
      <p>
        Security researchers help keep ScamCam safe. If you find a vulnerability, please report it so it can be fixed
        before anyone is harmed.
      </p>
      <h2>How to report</h2>
      <p>
        Email <a href="mailto:kevin@kevinle.tech?subject=ScamCam%20security">kevin@kevinle.tech</a> with &quot;ScamCam
        security&quot; in the subject. Describe the issue, the steps to reproduce it, and its impact. You will get a reply
        within 7 days and updates until it is resolved.
      </p>
      <h2>Rules for testing</h2>
      <ul>
        <li>Only test scamcam.kevinle.tech. Other parts of kevinle.tech are out of scope.</li>
        <li>Use only your own test data. Do not access, change, or delete anyone else&apos;s data.</li>
        <li>Keep request rates low and stop if the service slows down. No denial-of-service testing.</li>
        <li>No social engineering, phishing, or physical attacks.</li>
        <li>Do not test the third-party services ScamCam uses, such as Cloudflare, Google, abuse.ch, or registries.</li>
        <li>Give a reasonable amount of time for a fix before sharing details publicly.</li>
      </ul>
      <h2>Safe harbor</h2>
      <p>
        If you make a good-faith effort to follow this policy, ScamCam considers your research authorized under the
        Computer Fraud and Abuse Act and similar state laws, including California Penal Code section 502. ScamCam waives
        any claim under DMCA section 1201 for working around its own protections, and waives any part of its terms that
        would prevent that research. ScamCam will not take legal action against you or report you to law enforcement for
        it. ScamCam can only give permission for its own service, not for Cloudflare, Google, abuse.ch, domain registries,
        or the rest of kevinle.tech. If someone else takes legal action against you for research that followed this
        policy, ScamCam will make it known that your research was authorized.
      </p>
      <h2>Out of scope</h2>
      <ul>
        <li>Missing headers or best practices without a demonstrated security impact.</li>
        <li>Reports from automated scanners without a working proof of concept.</li>
        <li>Rate limits doing what they are meant to do.</li>
        <li>Verdict disagreements. Use the contact page for those.</li>
      </ul>
      <p>
        This policy is adapted from the disclose.io templates, which are dedicated to the public domain (CC0 1.0).
      </p>
    </DocumentPage>
  );
}
