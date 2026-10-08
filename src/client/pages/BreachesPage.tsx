import { useId, useState } from "react";
import { hibpBreachListPage, hibpHomePage } from "../../shared/breaches";
import { pwnedPasswordsPage } from "../../shared/passwords";
import { AccountChecklists } from "@/components/breaches/AccountChecklists";
import { PassphraseMaker, PasswordStrength } from "@/components/breaches/PasswordTools";
import { SiteLookup } from "@/components/breaches/SiteLookup";
import { DocumentPage } from "@/components/layout/DocumentPage";
import { Button } from "@/components/ui/button";
import { checkPassword, type PasswordResult } from "@/lib/breach-check";
import { Link } from "@/router";

const number = new Intl.NumberFormat("en-US");
const fieldClass = "min-w-0 flex-1 rounded-[3px] border border-rule-strong bg-bg px-3.5 py-2.5 font-mono text-[0.95rem] text-ink placeholder:text-ink-faint focus-visible:border-accent";

function PasswordAnswer({ result }: { result: PasswordResult }) {
  if (result.status === "found") {
    return (
      <div className="mt-4 border-l-4 border-level-malicious bg-panel-2 px-4 py-3 text-ink">
        <p className="font-semibold">
          This password has appeared in data breaches {number.format(result.count)} {result.count === 1 ? "time" : "times"}.
        </p>
        <p className="mt-2 text-sm text-ink-soft">
          Stop using it. Change it on every account that uses it, starting with your email, and give each account its own
          long password. Attackers try leaked passwords on other sites automatically, so a leaked password is unsafe even if
          your account was never in a breach. A password manager can make and remember strong passwords, and two-step
          verification protects you even when a password leaks.
        </p>
      </div>
    );
  }
  if (result.status === "not_found") {
    return (
      <div className="mt-4 border-l-4 border-level-safe bg-panel-2 px-4 py-3 text-ink">
        <p className="font-semibold">This password was not found in any known breach.</p>
        <p className="mt-2 text-sm text-ink-soft">
          That is good news, but it does not make the password strong or secret. A short or guessable password can still be
          cracked, and a password you use on several sites is only as safe as the weakest one. Use a long passphrase that you
          use nowhere else, and turn on two-step verification.
        </p>
      </div>
    );
  }
  return (
    <p className="mt-4 border-l-4 border-level-suspicious bg-panel-2 px-4 py-3 text-sm text-ink">
      {result.status === "rate_limited"
        ? "You have checked a lot of passwords in the last minute. Wait a minute and try again."
        : "Pwned Passwords could not be reached right now, so nothing was checked. Try again in a minute."}
    </p>
  );
}

function PasswordCheck() {
  const id = useId();
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<PasswordResult | null>(null);

  async function check() {
    if (password === "" || busy) {
      return;
    }
    setBusy(true);
    setResult(null);
    const outcome = await checkPassword(password);
    setPassword("");
    setResult(outcome);
    setBusy(false);
  }

  return (
    <section aria-labelledby={`${id}-heading`} className="mt-4 border border-rule bg-panel px-5 py-4">
      <h3 id={`${id}-heading`} className="!mt-0">
        Has this password leaked?
      </h3>
      <form
        className="mt-3 space-y-3"
        autoComplete="off"
        onSubmit={(event) => {
          event.preventDefault();
          void check();
        }}
      >
        <label htmlFor={`${id}-password`} className="block text-sm text-ink">
          Password to check
        </label>
        <div className="flex flex-wrap gap-2">
          <input
            id={`${id}-password`}
            type={visible ? "text" : "password"}
            className={fieldClass}
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            maxLength={1024}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            aria-describedby={`${id}-help`}
          />
          <Button type="submit" disabled={busy || password === ""}>
            {busy ? "Checking" : "Check password"}
          </Button>
        </div>
        <label className="flex items-center gap-2 text-sm text-ink">
          <input type="checkbox" checked={visible} onChange={(event) => setVisible(event.target.checked)} />
          Show the password while typing
        </label>
        <PasswordStrength password={password} />
        <p id={`${id}-help`} className="text-sm text-ink-soft">
          Your password never leaves this device. Your browser turns it into a SHA-1 fingerprint and sends only its first 5
          of 40 characters. ScamCam passes them to Pwned Passwords, which answers with every leaked fingerprint that starts
          the same way, and your browser looks for yours among them. The box is cleared after each check, and nothing is
          saved.
        </p>
      </form>
      <div role="status" aria-live="polite">
        {result && <PasswordAnswer result={result} />}
      </div>
      <p className="mt-4 text-xs text-ink-soft">
        Uses{" "}
        <a href={pwnedPasswordsPage} target="_blank" rel="noopener noreferrer">
          Pwned Passwords by Have I Been Pwned
        </a>
        .
      </p>
    </section>
  );
}

export function BreachesPage() {
  return (
    <DocumentPage
      title="Breach check"
      reference="SC-DOC-05"
      updated="2026-10-08"
      lead="Check whether a password has leaked, make a strong passphrase, look up how to protect an account on a site and whether it was breached, and lock down your accounts. Nothing you type here is sent anywhere."
    >
      <h2>Check a password</h2>
      <p>
        This is the only place ScamCam asks for a password, and it never leaves your device. Never type a password into a
        page someone sent you a link to. If you would rather not type it here, many password managers have the same check
        built in.
      </p>
      <PasswordCheck />
      <PassphraseMaker />

      <h2>Look up a website or company</h2>
      <p>
        Search by website or company name to see how to turn on two-step verification and passkeys there, where to change
        your password, the{" "}
        <a href={hibpBreachListPage} target="_blank" rel="noopener noreferrer">
          breaches Have I Been Pwned knows about
        </a>
        , and breach notices the company filed with the Washington or California attorney general. Link reports also mention
        when a link&apos;s site had a known breach, because scammers often send fake &quot;secure your account&quot; messages
        after one.
      </p>
      <SiteLookup />

      <h2>Lock down your accounts</h2>
      <p>
        If you think someone has your password or got into an account, do these steps from a device you trust. Signing out
        everywhere matters as much as a new password, because a stolen login cookie keeps working until the session ends.
      </p>
      <AccountChecklists />

      <h2>If your computer may be infected</h2>
      <p>
        Some breaches on Have I Been Pwned say &quot;From stealer logs&quot;. Those passwords were not taken from a website.
        Malware on people&apos;s own computers copied them, often after they ran a fake game cheat, a cracked game, a
        &quot;free Robux&quot; tool, or a mod from an unofficial site. This kind of malware takes saved passwords and login
        cookies, and a login cookie gets past two-step verification.
      </p>
      <ol>
        <li>
          Clean the computer first. Run a full scan, and on Windows also run a Microsoft Defender offline scan (Windows
          Security, then Virus and threat protection, then Scan options). If you are not sure it is clean, back up your files
          and reinstall the system.
        </li>
        <li>
          Then, from the clean computer or another device you trust, change your passwords, starting with your email, and
          sign out everywhere using the steps above. Changing them on an infected computer hands the new ones over too.
        </li>
        <li>Turn on two-step verification, and check each account&apos;s recovery email, phone number, and connected apps.</li>
        <li>If card or bank details were saved in your browser, tell your bank.</li>
        <li>
          Before you open a game file or mod someone sends you, <Link to="/">check the file with ScamCam</Link>.
        </li>
      </ol>

      <h2>Email addresses</h2>
      <p>
        ScamCam does not look up email addresses, because the free services that do either ask sites like this one to pay
        or show anyone the breaches of any address, including sensitive ones. These free services check your own address
        and make you prove it is yours before they show the sensitive results:
      </p>
      <ul>
        <li>
          <a href={hibpHomePage} target="_blank" rel="noopener noreferrer">
            Have I Been Pwned
          </a>{" "}
          shows most breaches right away. Its{" "}
          <a href="https://haveibeenpwned.com/Dashboard" target="_blank" rel="noopener noreferrer">
            free dashboard
          </a>
          , which signs you in with a link sent to your email, also shows sensitive breaches and stealer logs, and{" "}
          <a href="https://haveibeenpwned.com/NotifyMe" target="_blank" rel="noopener noreferrer">
            Notify Me
          </a>{" "}
          emails you about new ones.
        </li>
        <li>
          <a href="https://monitor.mozilla.org/" target="_blank" rel="noopener noreferrer">
            Mozilla Monitor
          </a>{" "}
          sends free breach alerts for your email address.
        </li>
      </ul>

      <h2>If you were in a breach</h2>
      <ul>
        <li>Change the password on that site, and on every other site where you used the same one.</li>
        <li>Turn on two-step verification, ideally with an app or a security key instead of text messages.</li>
        <li>
          Expect scam emails and texts that mention the breach. Open the site yourself instead of following a link, and never
          share a login code.
        </li>
        <li>If card or bank details were exposed, watch your statements and tell your bank about anything you do not recognize.</li>
        <li>
          Real breach letters and settlements never charge a fee or ask for your password. If a message says your account was
          breached and asks you to act fast, <Link to="/">check it with ScamCam</Link> first.
        </li>
      </ul>

      <h2>If your identity details were exposed</h2>
      <p>If a breach exposed your Social Security number, ID, or financial details, these free steps help in the United States:</p>
      <ul>
        <li>
          Follow the FTC&apos;s steps for your kind of breach at{" "}
          <a href="https://www.identitytheft.gov/databreach" target="_blank" rel="noopener noreferrer">
            IdentityTheft.gov
          </a>
          .
        </li>
        <li>
          Freeze your credit for free at each of the three bureaus:{" "}
          <a href="https://www.equifax.com/personal/credit-report-services/credit-freeze/" target="_blank" rel="noopener noreferrer">
            Equifax
          </a>
          ,{" "}
          <a href="https://www.experian.com/help/credit-freeze/" target="_blank" rel="noopener noreferrer">
            Experian
          </a>
          , and{" "}
          <a href="https://www.transunion.com/credit-freeze" target="_blank" rel="noopener noreferrer">
            TransUnion
          </a>
          . A freeze stops new accounts being opened in your name, and you can lift it when you need credit.
        </li>
        <li>
          Get your free credit reports at{" "}
          <a href="https://www.annualcreditreport.com/" target="_blank" rel="noopener noreferrer">
            AnnualCreditReport.com
          </a>
          , the only site the FTC says is authorized to give them out for free.
        </li>
        <li>
          Get an{" "}
          <a href="https://www.irs.gov/identity-theft-fraud-scams/get-an-identity-protection-pin" target="_blank" rel="noopener noreferrer">
            IRS Identity Protection PIN
          </a>{" "}
          so nobody else can file a tax return in your name.
        </li>
        <li>
          Report fraud to the FTC at{" "}
          <a href="https://reportfraud.ftc.gov/" target="_blank" rel="noopener noreferrer">
            ReportFraud.ftc.gov
          </a>
          .
        </li>
      </ul>
    </DocumentPage>
  );
}
