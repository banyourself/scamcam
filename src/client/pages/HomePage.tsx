import { useEffect, useRef, useState } from "react";
import type { ScanReport } from "../../shared/report";
import { ReportView } from "@/components/report/ReportView";
import { ShareControls } from "@/components/report/ShareControls";
import { ScanPanel } from "@/components/scan/ScanPanel";
import { useApiHealth } from "@/hooks/useApiHealth";
import { Link, useDocumentTitle } from "@/router";

const platforms = [
  {
    name: "Steam",
    file: "SC-STM",
    scams: [
      "A trade offer or \"verify your inventory\" link to a site whose name is one letter off from steamcommunity.com.",
      "Someone says your account will be banned unless you log in through their link or scan their QR code.",
      "A \"middleman\" or \"Steam staff\" account offers to hold your items during a trade.",
    ],
  },
  {
    name: "Discord",
    file: "SC-DSC",
    scams: [
      "\"Free Nitro\" or a game gift that asks you to log in or link your account.",
      "\"I accidentally reported you, talk to this admin\" followed by a request for your login or a screen share.",
      "A bot or server asks you to scan a QR code to \"verify\". Scanning it can log someone else into your account.",
    ],
  },
  {
    name: "Roblox",
    file: "SC-RBX",
    scams: [
      "Free Robux generators, \"admin\" giveaways, or sites that ask for your password or cookie.",
      "Someone offers to buy limited items off-platform or asks you to pay first through a gift card.",
      "A message says your account will be deleted unless you verify it on another site.",
    ],
  },
  {
    name: "Minecraft",
    file: "SC-MC",
    scams: [
      "A mod, client, or server pack from an unofficial site or a direct message that asks you to run a file.",
      "An \"account migration\" or \"free cape\" page that copies the Microsoft sign-in page.",
      "Paying for a server rank or account through an unofficial seller who disappears.",
    ],
  },
];

const reportParts = [
  { tag: "Exhibit A", title: "A clear verdict", body: "One of five levels, from \"no known threat detected\" to \"confirmed malicious\", with how sure ScamCam is." },
  { tag: "Exhibit B", title: "The evidence", body: "Each finding, which independent source reported it, and when it was checked. Sources that could not be checked are listed too." },
  { tag: "Exhibit C", title: "What to do next", body: "Plain steps, like how to secure your account or report the message on the platform it came from." },
];

export function HomePage() {
  useDocumentTitle("ScamCam");
  const health = useApiHealth();
  const [result, setResult] = useState<{ report: ScanReport; signature: string | null } | null>(null);
  const report = result?.report ?? null;
  const reportSection = useRef<HTMLElement>(null);

  useEffect(() => {
    if (report && reportSection.current) {
      reportSection.current.scrollIntoView({ behavior: "smooth", block: "start" });
      reportSection.current.focus({ preventScroll: true });
    }
  }, [report]);

  return (
    <>
      <section className="mx-auto grid max-w-6xl gap-10 px-4 pt-12 sm:pt-16 lg:grid-cols-[1fr_1.15fr] lg:items-start">
        <div>
          <p className="kicker">Put scams in focus</p>
          <h1 className="display mt-4 text-6xl sm:text-7xl">
            Think it&apos;s
            <br />a scam?
          </h1>
          <p className="mt-5 max-w-md text-lg text-ink-soft">
            Paste a suspicious link or message. ScamCam checks it against independent security sources and shows you
            the evidence, not just a score.
          </p>
          <dl className="mt-8 grid max-w-md grid-cols-3 gap-4 border-t border-rule pt-5 font-mono text-xs uppercase tracking-[0.12em]">
            <div>
              <dt className="text-ink-faint">Cost</dt>
              <dd className="mt-1 text-ink">Free</dd>
            </div>
            <div>
              <dt className="text-ink-faint">Account</dt>
              <dd className="mt-1 text-ink">None</dd>
            </div>
            <div>
              <dt className="text-ink-faint">Tracking</dt>
              <dd className="mt-1 text-ink">None</dd>
            </div>
          </dl>
        </div>
        <ScanPanel health={health} onReport={(next, signature) => setResult({ report: next, signature })} />
      </section>

      {report && (
        <section ref={reportSection} tabIndex={-1} aria-label="Report" className="mx-auto mt-12 max-w-4xl scroll-mt-6 px-4 focus:outline-none">
          <ReportView report={report} />
          {result?.signature && <ShareControls key={report.caseNumber} report={report} signature={result.signature} />}
        </section>
      )}

      <section aria-labelledby="report-parts" className="mx-auto mt-20 max-w-6xl px-4">
        <h2 id="report-parts" className="rule-label">
          What you get back
        </h2>
        <ol className="mt-6 grid gap-6 md:grid-cols-3">
          {reportParts.map((part) => (
            <li key={part.tag} className="border border-rule bg-panel p-5">
              <span className="evidence-tag">{part.tag}</span>
              <h3 className="mt-4 text-lg font-semibold text-ink">{part.title}</h3>
              <p className="mt-2 text-sm text-ink-soft">{part.body}</p>
            </li>
          ))}
        </ol>
        <p className="mt-4 text-sm text-ink-soft">
          A clean result never means a link is guaranteed safe.{" "}
          <Link to="/how-it-works" className="text-accent underline underline-offset-4">
            How ScamCam decides
          </Link>
        </p>
      </section>

      <section aria-labelledby="known-scams" className="mx-auto mt-20 max-w-6xl px-4">
        <h2 id="known-scams" className="rule-label">
          Known scams in gaming
        </h2>
        <p className="mt-4 max-w-2xl text-ink-soft">
          Most gaming scams want one of three things: your login, your items, or your money. These are the patterns
          ScamCam is built to recognize.
        </p>
        <div className="mt-6 grid gap-6 sm:grid-cols-2">
          {platforms.map((platform) => (
            <article key={platform.name} className="border border-rule bg-panel p-5">
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="display text-3xl">{platform.name}</h3>
                <span className="font-mono text-[0.7rem] uppercase tracking-[0.16em] text-ink-faint">File {platform.file}</span>
              </div>
              <ul className="mt-3 list-[square] space-y-2 pl-5 text-sm text-ink-soft">
                {platform.scams.map((scam) => (
                  <li key={scam}>{scam}</li>
                ))}
              </ul>
            </article>
          ))}
        </div>
        <div className="mt-6 border-l-4 border-accent bg-panel-2 px-5 py-4 text-sm text-ink-soft">
          <p className="font-medium text-ink">If you already clicked or logged in</p>
          <p className="mt-1">
            Change that password from the official app or website, turn on two-factor authentication, sign out of other
            sessions, and check your trade or friend history. Then report the message on the platform where you got it.
          </p>
        </div>
      </section>
    </>
  );
}
