import { DocumentPage } from "@/components/layout/DocumentPage";
import { RiskMeter } from "@/components/report/RiskMeter";
import { Link } from "@/router";
import { ocrBase } from "../../shared/ocr";
import { riskExplanations, riskLabels, riskLevels } from "../../shared/report";

export function HowItWorksPage() {
  return (
    <DocumentPage
      title="How it works"
      reference="SC-DOC-01"
      updated="2026-10-08"
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
          <strong>Look inside files on your device.</strong> If you check a file, your browser reads it without opening or
          running it. It finds what the file really is, whatever its name says, and looks for disguised endings such as{" "}
          <code>photo.jpg.exe</code>, Office macros, PDF actions, fake login pages, programs inside archives, browser
          extensions that can read your login cookies, programs packed from Python scripts (a common way to build Discord
          token grabbers), shortcuts and registry files that reach other computers or change startup settings, and Roblox
          models with backdoor scripts. Only the file&apos;s fingerprints are sent, and ScamCam looks them up in MalwareBazaar,
          CIRCL hashlookup, and Team Cymru&apos;s Malware Hash Registry. The file itself is never uploaded. Minecraft mods
          are read for what account stealers do, such as looking for Discord and browser logins, sending data to a
          Discord webhook, or taking your Minecraft login, and are compared with the files Modrinth publishes. Modpacks are
          checked for downloads from unsafe places and for the mods they carry.
        </li>
        <li>
          <strong>Read email files on your device.</strong> If you add a saved email (.eml), your browser reads its sender,
          subject, and text, and the results of the receiving mail server&apos;s sender checks (SPF, DKIM, and DMARC). ScamCam
          warns when the sender was faked, when the sender&apos;s name says Steam or Discord but the email came from somewhere
          else, when replies would go to a different domain, and when an attachment can run code. Email addresses and
          attachments never leave your device.
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
          <strong>Ask independent sources.</strong> Google Safe Browsing, Spamhaus&apos;s Domain Blocklist and its list of
          domains first seen in the last day, PhishStats, Cloudflare&apos;s 1.1.1.2 security filter, abuse.ch&apos;s URLhaus and
          ThreatFox, how old the domain is, and its DNS records. Six scam lists are checked against a scrambled copy kept by
          ScamCam: Phishing.Database, MetaMask&apos;s phishing list, ScamSniffer, PhishDestroy, a public-domain list of Discord
          and Steam scam links, and CERT Polska&apos;s warning list. For a Discord invite, ScamCam asks Discord when the
          server was made, whether Discord verified it, and whether its name pretends to be staff or support. For a Steam
          profile or trade link, it asks Steam whether the account is banned from trading, how new it is, and whether its
          name pretends to be staff. For a GitHub link, it asks GitHub how old the repository and its owner are and whether
          GitHub removed or blocked it; stars never count as proof that a download is safe. For Bitly, is.gd, and v.gd short links, it asks the shortening service where the link
          leads and checks that address too, without opening either one. Very popular sites in{" "}
          <a href="https://radar.cloudflare.com/domains">Cloudflare Radar</a>&apos;s ranking (
          <a href="https://creativecommons.org/licenses/by-nc/4.0/">CC BY-NC 4.0</a>) only soften small warnings, such as an
          often-abused ending, and never outweigh a real listing. When a link&apos;s site is on{" "}
          <a href="https://haveibeenpwned.com/PwnedWebsites">Have I Been Pwned</a>&apos;s list of breached sites (
          <a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a>), the report mentions it as background,
          because scammers send fake &quot;secure your account&quot; messages after big breaches. ScamCam never opens the link itself. Google works to provide the most
          accurate and up-to-date information about unsafe web resources, but it cannot guarantee that its information is
          complete and error-free: some risky sites may not be identified, and some safe sites may be identified in error.
        </li>
        <li>
          <strong>Read the message.</strong> Urgency, threats, requests for logins, QR codes, or payment, and stories
          that match known scam scripts, including fake &quot;verify you are human&quot; steps that ask you to paste a
          command, crypto wallet drainers, texts that ask you to reply so a link will work, and fake order or voicemail
          texts that tell you to call a number. It also knows the costliest scams that often come without a link: fake
          investments and &quot;wrong number&quot; crypto chats, fake bank fraud alerts and &quot;safe accounts&quot;,
          government and police threats, fake tech support, unpaid toll and delivery texts, job and task scams, changed
          bank details, sextortion, marketplace code and overpayment tricks, fake account appeals, and fund recovery
          offers. ScamCam also notices when a message names a service like Steam or Discord but links somewhere else. US phone numbers stay hidden and are compared only with ScamCam&apos;s own scrambled copies
          of the FTC&apos;s and FCC&apos;s lists of numbers people reported for unwanted calls, and crypto wallet addresses are
          compared with ScamSniffer&apos;s list of scam wallets.
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

      <h2>Breach check</h2>
      <p>
        The <Link to="/breaches">breach check</Link> tells you whether a password has appeared in a data breach. Your
        browser turns the password into a SHA-1 fingerprint and sends only its first 5 characters. ScamCam passes them to{" "}
        <a href="https://haveibeenpwned.com/Passwords">Pwned Passwords by Have I Been Pwned</a>, which answers with every
        leaked fingerprint that starts the same way, plus random filler, and your browser looks for yours among them. The
        same page searches Have I Been Pwned&apos;s list of breached websites and companies on your device. ScamCam does not
        check email addresses.
      </p>

      <h2>If a result looks wrong</h2>
      <p>
        Each report has a <strong>Flag result as incorrect</strong> button. A flag goes to a queue for a person to review by hand. It
        never changes the result, for that report or any other, so flagging a scam site again and again cannot make it look
        safe. Flags need the security check, are limited per visitor and per day, and only work on a report ScamCam made in
        the last day.
      </p>
      <p>
        Each report also links to other well-known checkers, such as VirusTotal and Google&apos;s Safe Browsing site status, so
        you can compare answers. ScamCam sends them nothing. They see the domain or fingerprint only if you click.
      </p>

      <h2>What ScamCam will not do</h2>
      <ul>
        <li>Visit the link, download files, or run anything you submit.</li>
        <li>Accuse a person. Reports describe warning signs, not who someone is.</li>
        <li>Call something safe just because no list has it yet. New scam sites appear every day.</li>
        <li>Keep your message. It is checked and then discarded.</li>
        <li>Let a flag change a result. Flags are only read by a person.</li>
      </ul>

      <h2>Status</h2>
      <p>
        ScamCam launched on October 5, 2026. Every report lists any source that was not connected, did not answer, or had
        reached its free limit for the day, so you can see exactly what was checked.
      </p>
    </DocumentPage>
  );
}
