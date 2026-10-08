import { useId, useState } from "react";
import type { BreachCatalog, BreachEntry } from "../../shared/api";
import { breachNoteLabels, hibpBreachListPage, hibpBreachUrl, hibpHomePage, hibpLicenseUrl, searchBreaches } from "../../shared/breaches";
import { pwnedPasswordsPage } from "../../shared/passwords";
import { DocumentPage } from "@/components/layout/DocumentPage";
import { Button } from "@/components/ui/button";
import { checkPassword, loadBreachCatalog, type PasswordResult } from "@/lib/breach-check";
import { Link } from "@/router";

const number = new Intl.NumberFormat("en-US");
const fieldClass = "min-w-0 flex-1 rounded-[3px] border border-rule-strong bg-bg px-3.5 py-2.5 font-mono text-[0.95rem] text-ink placeholder:text-ink-faint focus-visible:border-accent";
const shownClasses = 6;

function longDate(day: string): string {
  const date = new Date(`${day}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? day : date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
}

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

function BreachItem({ entry, catalog }: { entry: BreachEntry; catalog: BreachCatalog }) {
  const classes = entry.classes.map((index) => catalog.dataClasses[index]).filter((name): name is string => Boolean(name));
  const extra = classes.length - shownClasses;
  return (
    <li className="!mt-3 border border-rule bg-panel px-4 py-3">
      <p className="text-ink">
        <strong>{entry.title}</strong>
        {entry.domain && <span className="ml-2 font-mono text-sm text-ink-soft">{entry.domain}</span>}
      </p>
      <p className="!mt-1 text-sm">
        Breached on {longDate(entry.breachDate)}, {number.format(entry.accounts)} accounts. Added to Have I Been Pwned on{" "}
        {longDate(entry.addedDate)}.
      </p>
      {classes.length > 0 && (
        <p className="!mt-1 text-sm">
          Exposed: {classes.slice(0, shownClasses).join(", ")}
          {extra > 0 ? `, and ${extra} more` : ""}.
        </p>
      )}
      {entry.notes.length > 0 && <p className="!mt-1 text-sm text-ink">{entry.notes.map((note) => breachNoteLabels[note]).join(". ")}.</p>}
      <p className="!mt-1 text-sm">
        <a href={hibpBreachUrl(entry.name)} target="_blank" rel="noopener noreferrer">
          Details on Have I Been Pwned
        </a>
      </p>
    </li>
  );
}

function BreachSearch() {
  const id = useId();
  const [query, setQuery] = useState("");
  const [catalog, setCatalog] = useState<BreachCatalog | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "failed" | "ready">("idle");
  const [searched, setSearched] = useState("");
  const term = catalog ? query : searched;
  const results = catalog && term.trim().length >= 2 ? searchBreaches(catalog, term) : [];

  async function search() {
    setSearched(query);
    if (catalog || state === "loading") {
      return;
    }
    setState("loading");
    const loaded = await loadBreachCatalog();
    setCatalog(loaded);
    setState(loaded ? "ready" : "failed");
  }

  return (
    <section aria-labelledby={`${id}-heading`} className="mt-4 border border-rule bg-panel px-5 py-4">
      <h3 id={`${id}-heading`} className="!mt-0">
        Has this site been breached?
      </h3>
      <form
        className="mt-3 space-y-3"
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          void search();
        }}
      >
        <label htmlFor={`${id}-query`} className="block text-sm text-ink">
          Website or company name
        </label>
        <div className="flex flex-wrap gap-2">
          <input
            id={`${id}-query`}
            type="search"
            className={fieldClass}
            placeholder="adobe.com or Adobe"
            autoComplete="off"
            spellCheck={false}
            maxLength={200}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-describedby={`${id}-help`}
          />
          <Button type="submit" disabled={state === "loading" || query.trim().length < 2}>
            {state === "loading" ? "Loading" : "Search"}
          </Button>
        </div>
        <p id={`${id}-help`} className="text-sm text-ink-soft">
          ScamCam downloads the whole list of known breaches once, and your browser searches it, so what you type is never
          sent anywhere.
        </p>
      </form>
      <div role="status" aria-live="polite" className="mt-3 text-sm">
        {state === "failed" && <p>The breach list could not be loaded right now. Try again in a few minutes.</p>}
        {catalog && term.trim().length >= 2 && (
          <p>
            {results.length === 0
              ? `No known breach matches "${term.trim()}". That does not prove the site was never breached; many breaches are never made public.`
              : `${results.length === 20 ? "The first 20" : results.length} known ${results.length === 1 ? "breach matches" : "breaches match"} "${term.trim()}".`}
          </p>
        )}
      </div>
      {results.length > 0 && catalog && (
        <ul className="!list-none !pl-0">
          {results.map((entry) => (
            <BreachItem key={entry.name} entry={entry} catalog={catalog} />
          ))}
        </ul>
      )}
      <p className="mt-4 text-xs text-ink-soft">
        Breach data from{" "}
        <a href={hibpHomePage} target="_blank" rel="noopener noreferrer">
          Have I Been Pwned
        </a>
        , licensed under{" "}
        <a href={hibpLicenseUrl} target="_blank" rel="noopener noreferrer">
          CC BY 4.0
        </a>
        {catalog ? `, copied on ${longDate(catalog.fetchedAt.slice(0, 10))}` : ""}.
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
      lead="Find out whether a password has leaked in a data breach without sending it anywhere, and look up which websites and companies have been breached."
    >
      <h2>Check a password</h2>
      <p>
        This is the only place ScamCam asks for a password, and it never leaves your device. Never type a password into a
        page someone sent you a link to. If you would rather not type it here, many password managers have the same check
        built in.
      </p>
      <PasswordCheck />

      <h2>Look up a website or company</h2>
      <p>
        Search the{" "}
        <a href={hibpBreachListPage} target="_blank" rel="noopener noreferrer">
          breaches Have I Been Pwned knows about
        </a>{" "}
        by website or company name. Link reports also mention when a link&apos;s site had a known breach, because scammers
        often send fake &quot;secure your account&quot; messages after one.
      </p>
      <BreachSearch />

      <h2>Email addresses</h2>
      <p>
        ScamCam does not check email addresses. Have I Been Pwned&apos;s email search needs a paid key, and the free
        services either ask sites like this one to pay or show anyone the breaches of any address, including sensitive ones
        such as dating sites. You can check your own address on{" "}
        <a href={hibpHomePage} target="_blank" rel="noopener noreferrer">
          haveibeenpwned.com
        </a>
        , which hides sensitive breaches until you prove the address is yours.
      </p>

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
          If a message says your account was breached and asks you to act fast, <Link to="/">check it with ScamCam</Link>{" "}
          first.
        </li>
      </ul>
    </DocumentPage>
  );
}
