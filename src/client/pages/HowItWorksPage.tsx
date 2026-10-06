import { DocumentPage } from "@/components/layout/DocumentPage";
import { RiskMeter } from "@/components/report/RiskMeter";
import { ocrBase } from "../../shared/ocr";
import { riskExplanations, riskLabels, riskLevels } from "../../shared/report";

export function HowItWorksPage() {
  return (
    <DocumentPage
      title="How it works"
      reference="SC-DOC-01"
      updated="2026-10-05"
      lead="ScamCam treats every check like a case: collect evidence from independent sources, compare it, and only then reach a verdict you can inspect."
    >
      <h2>Evidence before AI</h2>
      <ol>
        <li>
          <strong>Read screenshots on your device.</strong> If you add a screenshot, your browser reads its text and any QR code
          itself, using the open source tools Tesseract.js and jsQR (Apache 2.0,{" "}
          <a href={`${ocrBase}/licenses/tesseract.js.txt`}>license</a>). The image is never uploaded. You see the text first and
          can fix any misread words before anything is checked.
        </li>
        <li>
          <strong>Look at the link itself.</strong> ScamCam finds the real domain (the part someone actually registered),
          decodes look-alike characters, and compares it with the domains Steam, Discord, Roblox, and Minecraft really use.
          If the link only passes through a redirect, such as Steam&apos;s link filter, a Google redirect, or an email
          scanner&apos;s safe link, ScamCam works out where it really leads and checks that address too. It also catches
          link text that shows one address but opens another, such as Discord&apos;s{" "}
          <code>[rockstargames.com](https://another-site.example)</code> trick. A link read from a screenshot is never treated
          as official, because a picture only shows the text of a link, not where it goes.
        </li>
        <li>
          <strong>Ask independent sources.</strong> Lists of known phishing and malware sites, Google Safe Browsing,
          Cloudflare&apos;s 1.1.1.2 security filter, how old the domain is, and its DNS records. ScamCam never opens the
          link itself. Google works to provide the most
          accurate and up-to-date information about unsafe web resources, but it cannot guarantee that its information is
          complete and error-free: some risky sites may not be identified, and some safe sites may be identified in error.
        </li>
        <li>
          <strong>Read the message.</strong> Urgency, threats, requests for logins, QR codes, or payment, and stories
          that match known scam scripts, including fake &quot;verify you are human&quot; steps that ask you to paste a
          command, crypto wallet drainers, and texts that ask you to reply so a link will work. ScamCam also notices when a
          message names a service like Steam or Discord but links somewhere else.
        </li>
        <li>
          <strong>Only if it is still unclear,</strong> a small AI model reads the message, with emails, phone numbers,
          long codes, links, and invisible characters removed. Names and usernames are not removed, so do not paste
          anything you would not show a stranger. The AI can add a warning but never make something look safer, on its own
          it can raise a message to Suspicious at most, and it is skipped when the free daily limit is reached.
        </li>
      </ol>

      <h2>The five levels</h2>
      <div className="mt-4">
        <RiskMeter level="unknown" />
      </div>
      <table>
        <thead>
          <tr>
            <th scope="col">Level</th>
            <th scope="col">Meaning</th>
          </tr>
        </thead>
        <tbody>
          {riskLevels.map((level) => (
            <tr key={level}>
              <td>
                <strong>{riskLabels[level]}</strong>
              </td>
              <td>{riskExplanations[level]}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>What ScamCam will not do</h2>
      <ul>
        <li>Visit the link, download files, or run anything you submit.</li>
        <li>Accuse a person. Reports describe warning signs, not who someone is.</li>
        <li>Call something safe just because no list has it yet. New scam sites appear every day.</li>
        <li>Keep your message. It is checked and then discarded.</li>
      </ul>

      <h2>Status</h2>
      <p>
        ScamCam launched on October 5, 2026. The link and message checks, Google Safe Browsing, URLhaus, domain age, DNS,
        Cloudflare&apos;s security filter, the Phishing.Database list, and the AI step are all running. If a source is down or has reached its free limit
        for the day, the report says so.
      </p>
    </DocumentPage>
  );
}
