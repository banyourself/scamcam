import { DocumentPage } from "@/components/layout/DocumentPage";
import { Link } from "@/router";

export function TermsPage() {
  return (
    <DocumentPage title="Terms of service" reference="SC-POL-02" updated="2026-10-08">
      <h2>What ScamCam is</h2>
      <p>
        ScamCam is a free, noncommercial tool that gives automated, informational assessments of links and messages.
        Results are opinions based on the evidence available at the time. They are not guarantees, legal findings, or
        statements about anyone&apos;s intent. Some checks use an AI model, which can be wrong.
      </p>

      <p>
        These terms also cover the ScamCam browser extension, which only opens ScamCam with what you choose to check.
      </p>

      <h2>No warranty</h2>
      <p>
        ScamCam is provided as is, without warranties of any kind. A link or message that ScamCam does not flag can still
        be harmful, and something it flags can turn out to be harmless. Use your own judgment and the official reporting
        tools of the platform involved.
      </p>

      <h2>Your use</h2>
      <p>If you are under 18, please read these terms with a parent or guardian.</p>
      <p>
        Use ScamCam lawfully and follow the <Link to="/acceptable-use">acceptable use policy</Link>. Do not submit
        content you are not allowed to share, and do not paste passwords or other secrets.
      </p>

      <h2>Information from other sources</h2>
      <p>
        Results include information from Google Safe Browsing, abuse.ch, Spamhaus, PhishStats, Cloudflare, public scam
        lists, the FTC and FCC, Discord, Steam, domain registries, and DNS. ScamCam does not control these sources, and they
        can be incomplete, out of date, or wrong. Their information is provided as is, without any warranty, and ScamCam is
        not endorsed by or affiliated with any of them, including Valve and Steam.
      </p>

      <h2>Corrections</h2>
      <p>
        If you think a result about your website is wrong, <Link to="/contact">ask for a review</Link>. Confirmed mistakes
        are corrected and logged.
      </p>

      <h2>Copyright</h2>
      <p>
        ScamCam has no profile pictures, uploads that others can see, or public comments. Screenshots and files are read on
        your device, and a shared report is encrypted, visible only to people with its link, and deleted within 20 minutes.
        If you believe something reachable through ScamCam infringes your copyright, email{" "}
        <a href="mailto:kevin@kevinle.tech">kevin@kevinle.tech</a> with: your name and contact details; the work you
        believe is infringed; where it appears, such as a link; a statement that you believe in good faith the use is not
        authorized by the owner, its agent, or the law; a statement that the notice is accurate and, under penalty of
        perjury, that you are the owner or allowed to act for the owner; and your physical or electronic signature. The
        material will be removed or disabled, and people who repeatedly infringe will be blocked.
      </p>

      <h2>Limitation of liability</h2>
      <p>
        To the extent the law allows, the operator of ScamCam is not liable for losses that result from using or relying
        on ScamCam, including missed or mistaken results.
      </p>

      <h2>Changes and availability</h2>
      <p>
        ScamCam may change, pause features when free limits are reached, or stop at any time. These terms may be updated;
        the date above shows the latest version.
      </p>

      <h2>Governing law</h2>
      <p>These terms are governed by the laws of the State of California, United States.</p>

      <h2>Contact</h2>
      <p>
        Questions about these terms go to <a href="mailto:kevin@kevinle.tech">kevin@kevinle.tech</a>.
      </p>
    </DocumentPage>
  );
}
