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
            <td>A scrambled fingerprint of a link (a hash)</td>
            <td>To ask Google Safe Browsing without sending the link. Only the first 4 bytes of the fingerprint are sent</td>
            <td>Not stored</td>
          </tr>
          <tr>
            <td>The name of the website in a link, such as example.com</td>
            <td>To look up how old the domain is (domain registries), whether it exists (Cloudflare DNS), and whether it is known for malware (URLhaus)</td>
            <td>Not stored by ScamCam</td>
          </tr>
          <tr>
            <td>Your IP address</td>
            <td>Cloudflare uses it to deliver the site, limit abuse, and run the bot check</td>
            <td>Not saved by ScamCam</td>
          </tr>
          <tr>
            <td>Basic request records (time, page, result code)</td>
            <td>To fix problems</td>
            <td>3 days in Cloudflare logs, with no IP address or link</td>
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
          <strong>Workers AI</strong> (Cloudflare), if used, receives the message with personal details hidden and does
          not keep it or train on it.
        </li>
      </ul>

      <h2>Cookies and Do Not Track</h2>
      <p>
        ScamCam sets no cookies of its own. Cloudflare may set strictly necessary security cookies. Your theme choice is
        saved in your browser only. ScamCam does not track you across sites, so Do Not Track signals change nothing. See
        the <Link to="/cookies">cookie policy</Link>.
      </p>

      <h2>Your rights</h2>
      <p>
        Because ScamCam does not keep information that identifies you, there is usually nothing to look up, correct, or
        delete. You can still ask by emailing <a href="mailto:kevin@kevinle.tech">kevin@kevinle.tech</a>. Depending on
        where you live (for example California or the EU), you may have rights to access, correct, or delete personal
        information, and to complain to a regulator.
      </p>

      <h2>Changes</h2>
      <p>Any change will be posted here with a new date. This policy has no effective date yet because it is a draft.</p>
    </DocumentPage>
  );
}
