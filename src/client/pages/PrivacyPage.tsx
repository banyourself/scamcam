import { DocumentPage } from "@/components/layout/DocumentPage";
import { Link } from "@/router";

export function PrivacyPage() {
  return (
    <DocumentPage
      title="Privacy policy"
      reference="SC-POL-01"
      updated="2026-10-08"
      lead="ScamCam is built to know as little about you as possible."
    >
      <h2>The short version</h2>
      <ul>
        <li>No accounts, ads, analytics, or tracking.</li>
        <li>What you paste is checked and then thrown away. It is not saved unless you choose to share a report or flag a result.</li>
        <li>Screenshots are read on your own device and are never uploaded.</li>
        <li>Files you check stay on your device. Only their fingerprints are sent, never the file or its name.</li>
        <li>Email files are read on your device. Email addresses and attachments never leave it.</li>
        <li>Passwords you check for leaks never leave your device. Only the first 5 characters of a scrambled fingerprint are sent.</li>
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
              Not stored. Login tokens and cookies for Discord, Roblox, Steam, and GitHub are taken out in your browser before
              the text is sent, so they never leave your device. Emails, phone numbers, and long codes are hidden before any
              outside check. US phone numbers and
              crypto wallet addresses are compared only with ScamCam&apos;s own scrambled copies of the FTC&apos;s and FCC&apos;s
              lists of reported numbers and ScamSniffer&apos;s list of scam wallets, never sent anywhere
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
            <td>An email file (.eml) you add</td>
            <td>
              Your browser reads it on your device: the sender&apos;s name, the subject, the text, the sender&apos;s domain, the
              receiving mail server&apos;s sender checks (SPF, DKIM, and DMARC), whether replies would go to another domain, and
              what is inside any attachments
            </td>
            <td>
              Never uploaded. The text is shown to you first, then checked like a typed message. Only the sender&apos;s domain,
              the check results, and each attachment&apos;s type, file ending, and fixed codes for what was found are sent with
              it. Email addresses, recipients, attachment names, and the attachments themselves never leave your device. The
              sender&apos;s domain is compared only with ScamCam&apos;s own copies of the scam lists and of a public list of
              throwaway email services
            </td>
          </tr>
          <tr>
            <td>The invite code in a Discord invite link, or the profile name or account number in a Steam profile or trade link</td>
            <td>
              To ask Discord about the server the invite opens (when it was made, whether Discord verified it, and whether its
              name claims to be staff or support), and to ask Steam about the account (trade, community, and game bans, when it
              was made if the profile is public, and whether its name claims to be staff or support)
            </td>
            <td>
              The answers are kept in memory for up to an hour, in North America, under a scrambled key. Server and account
              names are never shown or stored
            </td>
          </tr>
          <tr>
            <td>The account and repository name in a GitHub link, such as someone/project</td>
            <td>
              To ask GitHub when the repository and the account that owns it were made, how many stars and forks it has, and
              whether GitHub removed or blocked it
            </td>
            <td>The answers are kept in memory for up to an hour, in North America, under a scrambled key. Descriptions and profile names are never shown or stored</td>
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
            <td>A password you check on the breach check page</td>
            <td>
              Your browser works out its SHA-1 fingerprint and sends only the first 5 of its 40 characters, so ScamCam can ask
              Pwned Passwords for every leaked fingerprint that starts the same way. Your browser then looks for yours itself
            </td>
            <td>
              The password and its full fingerprint never leave your device and are never stored. The answer for those 5
              characters, which about 2,000 leaked passwords share, is kept for a day under a scrambled key
            </td>
          </tr>
          <tr>
            <td>A password you type on the breach check page, for its strength estimate, and passphrases the page makes</td>
            <td>To estimate how hard the password is to guess, and to make a random passphrase from a word list</td>
            <td>Never sent or stored. Both happen only on your device</td>
          </tr>
          <tr>
            <td>What you type in the site lookup</td>
            <td>
              To show a site&apos;s two-step verification and passkey options, where to change its password, its known
              breaches, and breach notices filed with the Washington and California attorneys general
            </td>
            <td>Never sent. Your browser downloads the lists once and searches them on your device</td>
          </tr>
          <tr>
            <td>The name of the website in a link, such as example.com</td>
            <td>
              To look up how old the domain is (domain registries), whether it exists (Cloudflare DNS), whether Cloudflare&apos;s
              security filter blocks it (Cloudflare 1.1.1.2), whether it is known for malware (URLhaus and ThreatFox), whether
              Spamhaus lists it or first saw it in the last day, whether PhishStats has phishing reports for it, and how popular it
              is (Cloudflare Radar). ScamCam also compares it with its own copy of Have I Been Pwned&apos;s list of breached
              sites, without sending it anywhere
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
            <td>Anonymous daily totals: the date, whether a link, message, or file was checked, and the result level</td>
            <td>To show weekly totals on the public totals page</td>
            <td>90 days. Never the link, message, file, or anything about who checked it</td>
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

      <h2>The browser extension</h2>
      <p>
        The optional ScamCam extension for Edge and Chrome adds Check with ScamCam to the right-click menu and the toolbar. It
        has no access to the websites you visit. When you choose it, it opens ScamCam in a new tab with the link, selected text,
        or page address you picked, carried in the part of the address after #, which browsers do not send to servers. ScamCam
        clears that from the address as soon as the page loads, and the check then works exactly like one you paste in, under
        this policy. The extension stores nothing and sends nothing on its own.
      </p>

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
          <strong>Domain registries, Cloudflare DNS (its 1.1.1.2 security filter), URLhaus and ThreatFox (abuse.ch), Spamhaus, PhishStats, and Cloudflare Radar</strong>{" "}
          receive only the website name, for example <em>example.com</em> or <em>login.example.com</em>, never the rest of the
          link or your message. Spamhaus is asked through Cloudflare&apos;s DNS resolver.
        </li>
        <li>
          <strong>Bitly, is.gd, and v.gd</strong> receive only the short code of one of their own short links, such as{" "}
          <em>bit.ly/abc</em>, so ScamCam can learn where it leads without opening it.
        </li>
        <li>
          <strong>Discord</strong> receives only the invite code from a discord.gg or discord.com/invite link, and{" "}
          <strong>Steam</strong> (Valve) receives only the profile name or account number from a steamcommunity.com link,
          with ScamCam&apos;s own Steam Web API key. Neither receives your message or your IP address. Steam information is
          shown as is, without any warranty, and ScamCam is not endorsed by or affiliated with Valve or Steam.
        </li>
        <li>
          <strong>GitHub</strong> receives only the account and repository name from a GitHub link, such as{" "}
          <em>someone/project</em>, with ScamCam&apos;s own token, never the rest of the link, your message, or your IP
          address.
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
          <strong>Modrinth</strong> receives the SHA-1 fingerprint of a Minecraft mod you check and the mod ID written inside
          it (such as <code>sodium</code>), or the fingerprints of up to 50 mods a modpack carries or downloads from outside
          Modrinth, never the file, its name, or your IP address.
        </li>
        <li>
          <strong>Have I Been Pwned</strong> receives only the first 5 characters of a password&apos;s SHA-1 fingerprint
          when you check a password, asked by ScamCam on your behalf, never the password, the rest of the fingerprint, or
          your IP address. ScamCam also downloads its public list of breached websites (CC BY 4.0) by itself, with nothing
          from visitors.
        </li>
        <li>
          <strong>2FA Directory and Passkeys Directory by 2factorauth, Apple&apos;s Password Manager Resources, and the
          Washington State and California attorneys general</strong> publish the lists the site lookup uses. A scheduled job
          downloads them once a day, with nothing from visitors.
        </li>
        <li>
          <strong>Phishing.Database, MetaMask&apos;s phishing list, ScamSniffer, PhishDestroy, a public-domain Discord and Steam
          scam list, and CERT Polska&apos;s warning list</strong> are public lists of scam sites, and ScamSniffer also lists scam
          wallet addresses. ScamCam keeps a scrambled copy of each and checks links, email senders, and wallet addresses
          against them without sending them anywhere.
        </li>
        <li>
          <strong>The FTC&apos;s Do Not Call reports and the FCC&apos;s consumer complaints</strong> are the phone numbers people
          reported to the Federal Trade Commission and the Federal Communications Commission for unwanted calls and texts.
          ScamCam keeps scrambled copies of the last one and three months and checks numbers against them without sending
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
      <p>
        ScamCam has no session replay: nothing records your clicks, mouse movements, scrolling, or keystrokes. Fonts,
        images, and scripts come from ScamCam itself, not from Google or any font, analytics, or ad network. The only
        outside code a page loads is Cloudflare&apos;s bot check.
      </p>

      <h2>Cookies and Do Not Track</h2>
      <p>
        ScamCam sets no cookies of its own. Cloudflare may set strictly necessary security cookies. Your theme choice is
        saved in your browser only. ScamCam does not track you across sites, so Do Not Track signals change nothing.
        ScamCam never sells or shares personal information, including for targeted advertising. If your browser sends a
        Global Privacy Control signal, it is treated as a request not to sell or share, which ScamCam already never does.
        See the <Link to="/cookies">cookie policy</Link>.
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
        are based in the United States (including Discord, Steam, and GitHub), Australia (Have I Been Pwned), Switzerland (abuse.ch),
        and the countries where
        Spamhaus, PhishStats, and each domain registry operate.
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
        This version takes effect on October 8, 2026. It adds the breach check, which asks Pwned Passwords about the first
        5 characters of a password&apos;s fingerprint and searches Have I Been Pwned&apos;s list of breached sites on your
        device, GitHub repository details for GitHub links, a password strength estimate and passphrase maker that work only on your
        device, a site lookup searched on your device, and the removal of login tokens and cookies from text before it is
        sent, and says that ScamCam has no session replay, loads no fonts or code from other companies apart from the bot
        check, and treats Global Privacy Control as a request not to sell or share. The version of October 7, 2026 added email file checks, Discord invite and Steam account lookups, short
        link expansion with Bitly and is.gd, the FCC&apos;s complaint numbers, and ScamSniffer&apos;s list of scam wallets.
        Any change will be posted on this page with a new date.
      </p>
    </DocumentPage>
  );
}
