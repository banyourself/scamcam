import { useEffect, useState } from "react";
import type { StatsResponse, StatsSummary } from "../../shared/api";
import { riskLabels, riskLevels } from "../../shared/report";
import { DocumentPage } from "@/components/layout/DocumentPage";
import { Link } from "@/router";

const kindNames: Record<keyof StatsSummary["byKind"], string> = { url: "Links", message: "Messages", file: "Files" };
const number = new Intl.NumberFormat("en-US");

function Summary({ title, summary }: { title: string; summary: StatsSummary }) {
  const share = summary.checks ? Math.round((summary.flagged / summary.checks) * 100) : 0;
  return (
    <section className="border border-rule bg-panel p-5">
      <h2 className="!mt-0 !text-xl">{title}</h2>
      <p className="font-mono text-3xl text-ink">{number.format(summary.checks)} checks</p>
      <p>
        {number.format(summary.flagged)} came back suspicious or worse{summary.checks ? ` (${share} percent)` : ""}.
      </p>
      <dl className="mt-3 grid grid-cols-[1fr_auto] gap-x-6 gap-y-1 text-sm">
        {riskLevels.map((level) => (
          <div key={level} className="contents">
            <dt className="text-ink-soft">{riskLabels[level]}</dt>
            <dd className="text-right font-mono text-ink">{number.format(summary.byLevel[level])}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 text-sm text-ink-soft">
        {(Object.keys(kindNames) as (keyof StatsSummary["byKind"])[])
          .map((kind) => `${kindNames[kind]}: ${number.format(summary.byKind[kind])}`)
          .join(" · ")}
      </p>
    </section>
  );
}

export function StatsPage() {
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    fetch("/api/v1/stats", { headers: { Accept: "application/json" } })
      .then((response) => (response.ok ? (response.json() as Promise<StatsResponse>) : Promise.reject(new Error(String(response.status)))))
      .then((data) => live && setStats(data))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, []);

  return (
    <DocumentPage
      title="Totals"
      reference="SC-DOC-04"
      updated="2026-10-07"
      lead="How many checks ScamCam ran recently, and how many came back as scams. Counted anonymously."
    >
      {stats ? (
        <div className="mt-2 grid gap-4 md:grid-cols-2">
          <Summary title="Last 7 days" summary={stats.last7} />
          <Summary title="Last 30 days" summary={stats.last30} />
        </div>
      ) : (
        <p role="status">{failed ? "The totals could not be loaded right now. Try again in a minute." : "Loading the totals."}</p>
      )}
      <h2>How this is counted</h2>
      <p>
        Each check adds one to a counter for that day, the kind of thing checked (a link, a message, or a file), and the
        result. That is all that is counted. Nothing anyone checked is stored, and nothing about who checked it. Counters
        are deleted after 90 days. Details are in the <Link to="/privacy">privacy policy</Link>.
      </p>
    </DocumentPage>
  );
}
