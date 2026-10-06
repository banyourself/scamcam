import { DocumentPage } from "@/components/layout/DocumentPage";
import { Link } from "@/router";

export function PrivacyPage() {
  return (
    <DocumentPage
      title="Privacy policy"
      reference="SC-POL-01"
      updated="2026-10-05"
      draft
      lead="ScamCam is built to know as little about you as possible."
    >
      <h2>The short version</h2>
      <ul>
        <li>No accounts, ads, analytics, or tracking.</li>
        <li>What you paste is checked and then thrown away. It is not saved.</li>
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
            <td>Not stored. Emails, phone numbers, and long codes are hidden before any check.</td>
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
            <td>To look up how old the domain is (domain registries), whether it exists (Cloudflare DNS), and whether it is known for malware (URLhaus)</td>
            <td>The answers are kept for 1 minute to 1 day under a scrambled key, so the name itself is not stored</td>
          </tr>
          <tr>
            <td>Your IP address</td>
            <td>Cloudflare uses it to deliver the site, limit abuse, and run the bot check</td>
            <td>Not saved by ScamCam</td>
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
          <strong>Domain registries, Cloudflare DNS, and URLhaus (abuse.ch)</strong> receive only the website name, for
          example <em>login.example.com</em>, never the rest of the link or your message.
        </li>
        <li>
          <strong>Workers AI</strong> (Cloudflare) receives a message only when ScamCam&apos;s rules cannot decide, with
          emails, phone numbers, long codes, links, and invisible characters removed. Names and usernames are not removed.
          Cloudflare says it does not use this content to train AI models, and keeps it only when a site also stores it in
          another Cloudflare service, which ScamCam does not.
        </li>
        <li>
          <strong>Phishing.Database</strong> is a public list of phishing sites. ScamCam keeps a scrambled copy and checks
          links against it without sending them anywhere.
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
        are based in the United States, Switzerland (abuse.ch), and wherever each domain registry operates.
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
        Any change will be posted on this page with a new date. This policy is a draft for review, so it has no effective
        date yet. The effective date will be set when ScamCam launches.
      </p>
    </DocumentPage>
  );
}
