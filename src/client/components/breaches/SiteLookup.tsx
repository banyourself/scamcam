import { useId, useState } from "react";
import type { BreachCatalog, BreachEntry } from "../../../shared/api";
import { breachNoteLabels, hibpBreachUrl, hibpHomePage, hibpLicenseUrl, searchBreaches, searchTerm } from "../../../shared/breaches";
import {
  changePasswordListUrl,
  methodsOf,
  noticeSources,
  passkeySecondStep,
  passkeySignIn,
  passkeysDirectoryUrl,
  searchNotices,
  searchSites,
  twoFactorDirectoryUrl,
  twoFactorLabels,
  type BreachNotice,
  type BreachNotices,
  type SiteEntry,
  type SiteSecurity,
} from "../../../shared/site-data";
import { Button } from "@/components/ui/button";
import { loadBreachCatalog } from "@/lib/breach-check";
import { loadBreachNotices, loadSiteSecurity } from "@/lib/site-data";

const number = new Intl.NumberFormat("en-US");
const fieldClass = "min-w-0 flex-1 rounded-[3px] border border-rule-strong bg-bg px-3.5 py-2.5 font-mono text-[0.95rem] text-ink placeholder:text-ink-faint focus-visible:border-accent";
const shownClasses = 6;
const shownSites = 3;

export function longDate(day: string): string {
  const date = new Date(`${day}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? day : date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
}

function safeHref(url: string | undefined): string | undefined {
  return url && url.startsWith("https://") ? url : undefined;
}

function OutLink({ href, children }: { href: string | undefined; children: string }) {
  const safe = safeHref(href);
  return safe ? (
    <a href={safe} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex min-h-6 items-center">
      {children}
    </a>
  ) : null;
}

function orList(items: string[]): string {
  if (items.length <= 1) {
    return items.join("");
  }
  return `${items.slice(0, -1).join(", ")}${items.length > 2 ? "," : ""} or ${items.at(-1)}`;
}

function methodText(site: SiteEntry): string | null {
  if (site.m === undefined) {
    return null;
  }
  if (site.m === 0) {
    return "2FA Directory lists this site as not offering two-step verification.";
  }
  const methods = methodsOf(site.m).map((method) => {
    if (method === "custom-software" && site.sw?.length) {
      return `${twoFactorLabels[method]} (${site.sw.join(", ")})`;
    }
    if (method === "custom-hardware" && site.hw?.length) {
      return `${twoFactorLabels[method]} (${site.hw.join(", ")})`;
    }
    return twoFactorLabels[method];
  });
  return `Two-step verification with ${orList(methods)}.`;
}

function uniqueSites(sites: SiteEntry[]): SiteEntry[] {
  const seen = new Set<string>();
  return sites.filter((site) => {
    const key = JSON.stringify([site.m, site.doc, site.pk, site.pkDoc, site.cp]);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function SiteCard({ site }: { site: SiteEntry }) {
  const methods = methodText(site);
  const strong = site.m !== undefined && methodsOf(site.m).some((method) => method === "totp" || method === "u2f");
  const weakOnly = site.m !== undefined && site.m > 0 && !strong;
  return (
    <li className="!mt-3 border border-rule bg-panel px-4 py-3">
      <p className="font-mono text-ink">{site.d}</p>
      {methods && <p className="!mt-1 text-sm text-ink">{methods}</p>}
      {strong && <p className="!mt-1 text-sm">Pick an authenticator app or a security key over text messages when you can.</p>}
      {weakOnly && <p className="!mt-1 text-sm">Turn it on anyway. A code by text or email still stops most people who only have your password.</p>}
      {site.pk !== undefined && (site.pk & passkeySignIn) !== 0 && <p className="!mt-1 text-sm text-ink">You can sign in with a passkey instead of a password.</p>}
      {site.pk !== undefined && (site.pk & passkeySignIn) === 0 && (site.pk & passkeySecondStep) !== 0 && (
        <p className="!mt-1 text-sm text-ink">A passkey can be your second step.</p>
      )}
      {(site.note || site.pkNote) && <p className="!mt-1 text-xs text-ink-soft">Note from the directory: {[site.note, site.pkNote].filter(Boolean).join(" ")}</p>}
      <p className="!mt-2 flex flex-wrap gap-x-4 gap-y-2 text-sm">
        <OutLink href={site.doc}>Turn on two-step verification</OutLink>
        <OutLink href={site.pkDoc}>Set up a passkey</OutLink>
        <OutLink href={site.cp}>Change your password</OutLink>
        <OutLink href={site.rec}>Account recovery help</OutLink>
      </p>
    </li>
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

function NoticeItem({ notice }: { notice: BreachNotice }) {
  const source = noticeSources[notice.s];
  const dates = notice.b ?? [];
  return (
    <li className="!mt-3 border border-rule bg-panel px-4 py-3">
      <p className="text-ink">
        <strong>{notice.n}</strong>
      </p>
      <p className="!mt-1 text-sm">
        Reported to the {source.name} on {longDate(notice.r)}
        {dates.length > 0 ? `, for a breach that started on ${longDate(dates[0]!)}` : ""}.
        {notice.a !== undefined ? ` ${number.format(notice.a)} ${source.residents} affected.` : ""}
        {notice.c ? ` Cause: ${notice.c}.` : ""}
      </p>
      <p className="!mt-1 text-sm">
        <a href={source.list} target="_blank" rel="noopener noreferrer">
          Find it on the attorney general&apos;s list
        </a>
      </p>
    </li>
  );
}

type LoadState = "idle" | "loading" | "done";

interface Loaded {
  catalog: BreachCatalog | null;
  security: SiteSecurity | null;
  notices: BreachNotices | null;
}

export function SiteLookup() {
  const id = useId();
  const [query, setQuery] = useState("");
  const [searched, setSearched] = useState("");
  const [state, setState] = useState<LoadState>("idle");
  const [loaded, setLoaded] = useState<Loaded>({ catalog: null, security: null, notices: null });
  const shown = state === "done" ? query : searched;
  const term = searchTerm(shown);
  const ready = state === "done" && term.length >= 2;
  const sites = ready && loaded.security ? uniqueSites(searchSites(loaded.security, term, 12)).slice(0, shownSites) : [];
  const breaches = ready && loaded.catalog ? searchBreaches(loaded.catalog, shown) : [];
  const notices = ready && loaded.notices ? searchNotices(loaded.notices, term) : [];

  async function search() {
    setSearched(query);
    if (state !== "idle") {
      return;
    }
    setState("loading");
    const [catalog, security, noticeList] = await Promise.all([loadBreachCatalog(), loadSiteSecurity(), loadBreachNotices()]);
    setLoaded({ catalog, security, notices: noticeList });
    setState("done");
  }

  return (
    <section aria-labelledby={`${id}-heading`} className="mt-4 border border-rule bg-panel px-5 py-4">
      <h3 id={`${id}-heading`} className="!mt-0">
        Look up a site
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
            placeholder="discord.com or Discord"
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
          ScamCam downloads the lists once and your browser searches them, so what you type is never sent anywhere.
        </p>
      </form>

      {ready && (
        <div role="status" aria-live="polite" className="mt-4 space-y-6 text-sm">
          <div>
            <h4 className="!mt-0 font-semibold text-ink">How to protect your account</h4>
            {!loaded.security ? (
              <p>The account security list could not be loaded right now. Try again in a few minutes.</p>
            ) : sites.length === 0 ? (
              <p>No two-step verification, passkey, or change-password details match &quot;{shown.trim()}&quot;. Try the site&apos;s address, such as discord.com.</p>
            ) : (
              <ul className="!list-none !pl-0">
                {sites.map((site) => (
                  <SiteCard key={site.d} site={site} />
                ))}
              </ul>
            )}
          </div>

          <div>
            <h4 className="!mt-0 font-semibold text-ink">Breach notices filed with state attorneys general</h4>
            {!loaded.notices ? (
              <p>The breach notice list could not be loaded right now. Try again in a few minutes.</p>
            ) : notices.length === 0 ? (
              <p>
                No breach notice filed in Washington or California matches &quot;{shown.trim()}&quot;. Companies file there only when a
                breach affects people in those states.
              </p>
            ) : (
              <>
                <p>
                  Matched by company name, so a result can be a different company with a similar name. If you got a letter about a breach,
                  compare it with the copy on the attorney general&apos;s site before you call a number or open a link in it.
                </p>
                <ul className="!list-none !pl-0">
                  {notices.map((notice) => (
                    <NoticeItem key={`${notice.s}-${notice.n}-${notice.r}`} notice={notice} />
                  ))}
                </ul>
              </>
            )}
          </div>

          <div>
            <h4 className="!mt-0 font-semibold text-ink">Leaked data on Have I Been Pwned</h4>
            {!loaded.catalog ? (
              <p>The breach list could not be loaded right now. Try again in a few minutes.</p>
            ) : breaches.length === 0 ? (
              <p>
                Have I Been Pwned has no leaked data from &quot;{shown.trim()}&quot;.{" "}
                {notices.length > 0
                  ? "It lists a breach only once the stolen data turns up, so a company can report a breach, as above, without appearing here."
                  : "That does not prove the site was never breached; many breaches are never made public."}
              </p>
            ) : (
              <>
                <p>
                  {breaches.length === 20 ? "The first 20" : breaches.length} {breaches.length === 1 ? "breach matches" : "breaches match"} &quot;
                  {shown.trim()}&quot;.
                </p>
                <ul className="!list-none !pl-0">
                  {breaches.map((entry) => (
                    <BreachItem key={entry.name} entry={entry} catalog={loaded.catalog!} />
                  ))}
                </ul>
              </>
            )}
          </div>
        </div>
      )}

      <p className="mt-4 text-xs text-ink-soft">
        Breach data from{" "}
        <a href={hibpHomePage} target="_blank" rel="noopener noreferrer">
          Have I Been Pwned
        </a>{" "}
        (
        <a href={hibpLicenseUrl} target="_blank" rel="noopener noreferrer">
          CC BY 4.0
        </a>
        {loaded.catalog ? `, copied on ${longDate(loaded.catalog.fetchedAt.slice(0, 10))}` : ""}). Two-step verification data sourced from{" "}
        <a href={twoFactorDirectoryUrl} target="_blank" rel="noopener noreferrer">
          2FA Directory
        </a>{" "}
        by 2factorauth (<a href="/licenses/2fa-directory.txt">MIT</a>), passkey data from{" "}
        <a href={passkeysDirectoryUrl} target="_blank" rel="noopener noreferrer">
          Passkeys Directory
        </a>{" "}
        by 2factorauth (
        <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener noreferrer">
          CC BY 4.0
        </a>
        ), and change-password links from{" "}
        <a href={changePasswordListUrl} target="_blank" rel="noopener noreferrer">
          Apple&apos;s Password Manager Resources
        </a>{" "}
        (<a href="/licenses/apple-password-manager-resources.txt">MIT</a>). Breach notices from the{" "}
        <a href={noticeSources.wa.list} target="_blank" rel="noopener noreferrer">
          Washington State
        </a>{" "}
        and{" "}
        <a href={noticeSources.ca.list} target="_blank" rel="noopener noreferrer">
          California
        </a>{" "}
        attorneys general, which are public records. ScamCam copies these lists once a day.
      </p>
    </section>
  );
}
