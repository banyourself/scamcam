import { DocumentPage } from "@/components/layout/DocumentPage";
import { Link } from "@/router";

export function PrivacyPage() {
  return (
    <DocumentPage
      title="Privacy policy"
      reference="SC-POL-01"
      updated="2026-10-06"
      lead="ScamCam is built to know as little about you as possible."
    >
      <h2>The short version</h2>
      <ul>
        <li>No accounts, ads, analytics, or tracking.</li>
        <li>What you paste is checked and then thrown away. It is not saved unless you choose to share a report or flag a result.</li>
        <li>Screenshots are read on your own device and are never uploaded.</li>
        <li>Files you check stay on your device. Only their fingerprints are sent, never the file or its name.</li>
        <li>ScamCam does not save your IP address.</li>
        <li>Nothing is sold or shared for marketing, ever.</li>
      </ul>

      <h2>For younger users</h2>
      <p>
        You do not need to give ScamCam your name, email, or age. Please do not paste passwords, login codes, or where
        you live. If a message has someone&apos;s email or phone number in it, ScamCam hides it before checking.
      </p>
      <p>
        Your device&apos;s IP address is used only to keep ScamCam working and safe: to limit how many checks one visitor
        can run and to run the bot check. It is never used to contact you, build a profile, or show ads, and ScamCam does
        not save it. Messages are checked and then thrown away.
      </p>

      <h2>Who runs ScamCam</h2>
      <p>
        ScamCam is a free, noncommercial project run by Kevin Le. Contact:{" "}
        <a href="mailto:kevin@kevinle.tech">kevin@kevinle.tech</a>.
      </p>

      <h2>What is processed</h2>
      <table>
        <thead>
          <tr>
            <th scope="col">Information</th>
            <th scope="col">Why</th>
            <th scope="col">Kept</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>The link or message you submit</td>
            <td>To check it</td>
            <td>
              Not stored. Emails, phone numbers, and long codes are hidden before any outside check. US phone numbers are
              compared only with ScamCam&apos;s own scrambled copy of the FTC&apos;s list of reported numbers, never sent anywhere
            </td>
          </tr>
          <tr>
            <td>A screenshot you add</td>
            <td>Your browser reads its text and any QR code, on your device</td>
            <td>Never uploaded or stored. The text it reads is shown to you first, then checked like a typed message. Hidden photo details, such as where a photo was taken, never leave your device</td>
          </tr>
          <tr>
            <td>A file you choose to check</td>
            <td>Your browser reads it on your device to find its real type and any warning signs, and works out its SHA-256 and SHA-1 fingerprints</td>
            <td>Never uploaded. Only the fingerprints, the size, the type, the file ending, and fixed codes for what was found are sent, never the file, its contents, or its name. Lookup answers are kept for up to a day under a scrambled key</td>
          </tr>
          <tr>
            <td>The message with emails, phone numbers, long codes, links, and invisible characters removed (names and usernames stay)</td>
            <td>Only when ScamCam&apos;s own rules cannot decide, a small AI model on Cloudflare (Workers AI) reads it to look for scam patterns</td>
            <td>Not stored. ScamCam remembers only the model&apos;s one-word answer, in memory, for up to an hour</td>
          </tr>
          <tr>
            <td>A scrambled fingerprint of a link (a hash)</td>
            <td>To ask Google Safe Browsing without sending the link. Only the first 4 bytes of the fingerprint are sent</td>
            <td>Google&apos;s answer is kept for as long as Google allows, usually a few minutes</td>
          </tr>
          <tr>
            <td>The name of the website in a link, such as example.com</td>
            <td>
              To look up how old the domain is (domain registries), whether it exists (Cloudflare DNS), whether Cloudflare&apos;s
              security filter blocks it (Cloudflare 1.1.1.2), whether it is known for malware (URLhaus and ThreatFox), whether
              Spamhaus lists it or first saw it in the last day, whether PhishStats has phishing reports for it, and how popular it
              is (Cloudflare Radar)
            </td>
            <td>The answers are kept for 1 minute to 1 day under a scrambled key, so the name itself is not stored</td>
          </tr>
          <tr>
            <td>Your IP address</td>
            <td>Cloudflare uses it to deliver the site, limit abuse, and run the bot check</td>
            <td>Not saved by ScamCam</td>
          </tr>
          <tr>
            <td>A report you choose to share (the message text only if you tick the box)</td>
            <td>To show it to whoever has the link</td>
            <td>Kept encrypted for the 5, 10, or 15 minutes you pick, then deleted within 5 minutes. The key is only in the link, so ScamCam cannot read it</td>
          </tr>
          <tr>
            <td>A result you flag as incorrect</td>
            <td>So a person can review the result by hand and improve ScamCam. A flag never changes any result</td>
            <td>
              30 days, or less once reviewed. Only the result, the names of its findings, the link&apos;s domain or the file&apos;s
              fingerprint, the reason you picked, and your note with emails, phone numbers, and codes hidden. Never the message,
              the full link, the file, or your IP address
            </td>
          </tr>
          <tr>
            <td>ScamCam&apos;s own records of each request (time, page, result code, how long it took) and of each AI check (its one-word answer and size)</td>
            <td>To fix problems and stay within free limits</td>
            <td>3 days in Cloudflare Workers Logs. They contain no IP address, message, or link, and Cloudflare&apos;s own per-request logs are turned off</td>
          </tr>
          <tr>
            <td>Error type and page</td>
            <td>To find bugs</td>
            <td>7 days</td>
          </tr>
          <tr>
            <td>Emails you send</td>
            <td>To answer you</td>
            <td>Until the conversation is resolved</td>
          </tr>
        </tbody>
      </table>

      <h2>Services ScamCam relies on</h2>
      <ul>
        <li>
          <strong>Cloudflare</strong> hosts the site and runs Turnstile, a privacy-focused check that tells people from
          bots without tracking you.
        </li>
        <li>
          <strong>Google Safe Browsing</strong> receives only short scrambled fingerprints, never the link itself.
        </li>
        <li>
          <strong>Domain registries, Cloudflare DNS (1.1.1.1 and its 1.1.1.2 security filter), URLhaus and ThreatFox (abuse.ch), Spamhaus, PhishStats, and Cloudflare Radar</strong>{" "}
          receive only the website name, for example <em>example.com</em> or <em>login.example.com</em>, never the rest of the
          link or your message. Spamhaus is asked through Cloudflare&apos;s DNS resolver.
        </li>
        <li>
          <strong>Workers AI</strong> (Cloudflare) receives a message only when ScamCam&apos;s rules cannot decide, with
          emails, phone numbers, long codes, links, and invisible characters removed. Names and usernames are not removed.
          Cloudflare says it does not use this content to train AI models, and keeps it only when a site also stores it in
          another Cloudflare service, which ScamCam does not.
        </li>
        <li>
          <strong>MalwareBazaar (abuse.ch), CIRCL hashlookup, and Team Cymru&apos;s Malware Hash Registry</strong> receive only
          the fingerprints of a file you choose to check, never the file, its name, or your IP address. Team Cymru is asked
          through Cloudflare DNS.
        </li>
        <li>
          <strong>Phishing.Database, MetaMask&apos;s phishing list, ScamSniffer, PhishDestroy, a public-domain Discord and Steam
          scam list, and CERT Polska&apos;s warning list</strong> are public lists of scam sites. ScamCam keeps a scrambled copy of
          each and checks links against them without sending the links anywhere.
        </li>
        <li>
          <strong>The FTC&apos;s Do Not Call reports</strong> are the phone numbers people reported to the Federal Trade Commission
          for unwanted calls. ScamCam keeps a scrambled copy of the last month and checks numbers against it without sending
          them anywhere.
        </li>
        <li>
          <strong>VirusTotal, Google, urlscan.io, Cisco Talos, ScamAdviser, URLVoid, and Hybrid Analysis</strong> are linked from
          each report so you can check there too. ScamCam sends them nothing. They see the domain or fingerprint in the address
          only if you click a link, under their own privacy policies.
        </li>
      </ul>

      <h2>Tracking by other companies</h2>
      <p>
        No other company can use ScamCam to follow what you do over time or across other websites. Cloudflare processes
        your IP address and some browser signals to deliver the site and run the bot check, under Cloudflare&apos;s own
        privacy policy.
      </p>

      <h2>Cookies and Do Not Track</h2>
      <p>
        ScamCam sets no cookies of its own. Cloudflare may set strictly necessary security cookies. Your theme choice is
        saved in your browser only. ScamCam does not track you across sites, so Do Not Track signals change nothing. See
        the <Link to="/cookies">cookie policy</Link>.
      </p>

      <h2>Legal basis in the EU and UK</h2>
      <p>
        ScamCam is a US service that does not target the EU or UK, so their data protection laws may not apply. Where
        they do, ScamCam relies on legitimate interests: checking the link or message you ask about, and keeping a free
        service safe with rate limits and a bot check. Messages can mention other people, such as a scammer&apos;s
        username; they are used only for the check and are not stored. Results are automated opinions about links and
        messages, not decisions about you.
      </p>

      <h2>Where information is processed</h2>
      <p>
        Cloudflare runs ScamCam in data centers around the world, usually one near you. The lookup services listed above
        are based in the United States, Switzerland (abuse.ch), and the countries where Spamhaus, PhishStats, and each domain
        registry operate.
      </p>

      <h2>Your rights</h2>
      <p>
        Because ScamCam does not keep information that identifies you, there is usually nothing to look up, correct, or
        delete. You can still ask by emailing <a href="mailto:kevin@kevinle.tech">kevin@kevinle.tech</a>. Depending on
        where you live (for example California or the EU), you may have rights to access, correct, or delete personal
        information, and to complain to a regulator.
      </p>

      <h2>Changes</h2>
      <p>
        This version takes effect on October 6, 2026. It adds result flags, the Spamhaus, PhishStats, and Cloudflare Radar
        lookups, five more scam lists, the FTC&apos;s list of reported phone numbers, and links to other checkers. Any change will be posted on this page with a new date.
      </p>
    </DocumentPage>
  );
}
