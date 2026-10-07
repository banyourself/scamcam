import { googleAdvisoryUrl, riskExplanations, riskLabels, uncheckedReasons, type Evidence, type ScanReport } from "../../../shared/report";
import { Link } from "@/router";
import { cn } from "@/lib/cn";
import { levelTextClass } from "./levels";
import { RiskMeter } from "./RiskMeter";

const signalLabels: Record<Evidence["signal"], string> = {
  raises_risk: "Raises risk",
  lowers_risk: "Lowers risk",
  neutral: "Context",
};

function exhibitLetter(index: number): string {
  return index < 26 ? String.fromCharCode(65 + index) : String(index + 1);
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function ReportView({ report }: { report: ScanReport }) {
  return (
    <section aria-labelledby="report-heading" className="border border-rule bg-panel">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-rule px-5 py-3 font-mono text-xs uppercase tracking-[0.14em] text-ink-faint">
        <span>Case {report.caseNumber}</span>
        <time dateTime={report.createdAt}>{formatTime(report.createdAt)}</time>
      </header>

      <div className="grid gap-6 p-5 sm:grid-cols-[auto_1fr] sm:items-center">
        <p className={cn("stamp", levelTextClass[report.level])} id="report-heading">
          {riskLabels[report.level]}
        </p>
        <div>
          <p className="text-lg text-ink">{report.summary}</p>
          <p className="mt-1 text-sm text-ink-soft">
            {riskExplanations[report.level]} Confidence: <strong className="text-ink">{report.confidence}</strong>.
          </p>
        </div>
      </div>

      <div className="px-5 pb-5">
        <RiskMeter level={report.level} />
      </div>

      <div className="border-t border-rule px-5 py-4">
        <p className="rule-label">Subject</p>
        <p className="mt-2 break-all font-mono text-sm text-ink">
          {report.subject.display || <span className="font-sans text-ink-soft">Message text not shared</span>}
        </p>
        {report.subject.registrableDomain && (
          <p className="mt-1 text-sm text-ink-soft">
            Registered domain: <span className="font-mono text-ink">{report.subject.registrableDomain}</span>
          </p>
        )}
        {report.subject.fingerprint && (
          <div className="mt-2 text-sm text-ink-soft">
            <p>
              SHA-256: <span className="break-all font-mono text-ink">{report.subject.fingerprint}</span>
            </p>
            <p className="mt-1">
              <a
                href={`https://www.virustotal.com/gui/file/${report.subject.fingerprint}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent underline underline-offset-4"
              >
                Look it up on VirusTotal yourself
              </a>{" "}
              (opens VirusTotal, which then learns this fingerprint; ScamCam does not send it there).
            </p>
          </div>
        )}
      </div>

      <div className="border-t border-rule px-5 py-4">
        <h3 className="rule-label">Evidence</h3>
        {report.evidence.length === 0 ? (
          <p className="mt-3 text-sm text-ink-soft">No source reported anything about this.</p>
        ) : (
          <ol className="mt-3 space-y-4">
            {report.evidence.map((item, index) => (
              <li key={item.id} className="border-l-2 border-rule pl-4">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="evidence-tag">Exhibit {exhibitLetter(index)}</span>
                  <span className="font-mono text-xs uppercase tracking-wider text-ink-faint">{signalLabels[item.signal]}</span>
                </div>
                <p className="mt-2 font-medium text-ink">{item.title}</p>
                <p className="mt-1 text-sm text-ink-soft">{item.detail}</p>
                <p className="mt-1 font-mono text-xs text-ink-faint">
                  Source:{" "}
                  {item.source.url ? (
                    <a className="underline underline-offset-2 hover:text-ink" href={item.source.url} rel="noreferrer" target="_blank">
                      {item.source.name}
                    </a>
                  ) : (
                    item.source.name
                  )}
                  {" / "}checked <time dateTime={item.checkedAt}>{formatTime(item.checkedAt)}</time>
                </p>
              </li>
            ))}
          </ol>
        )}
        {report.notChecked.length > 0 && (
          <div className="mt-4 text-sm text-ink-soft">
            <p className="font-medium text-ink">Not checked</p>
            <ul className="mt-1 list-[square] pl-5">
              {report.notChecked.map((source) => (
                <li key={source.name}>
                  {source.name} {uncheckedReasons[source.reason]}.
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {report.recommendations.length > 0 && (
        <div className="border-t border-rule px-5 py-4">
          <h3 className="rule-label">What to do</h3>
          <ul className="mt-3 list-[square] space-y-1.5 pl-5 text-ink">
            {report.recommendations.map((tip) => (
              <li key={tip}>{tip}</li>
            ))}
          </ul>
        </div>
      )}

      <footer className="space-y-2 border-t border-rule bg-panel-2 px-5 py-4 text-xs text-ink-soft">
        <p>
          This is an automated assessment and it can be wrong. A clean result never proves a link or message is safe.{" "}
          <Link className="underline underline-offset-2 hover:text-ink" to="/contact">
            Report a mistake
          </Link>
          .
        </p>
        {report.usesGoogleSafeBrowsing && (
          <p>
            Advisory provided by Google.{" "}
            <a className="underline underline-offset-2 hover:text-ink" href={googleAdvisoryUrl} rel="noreferrer" target="_blank">
              About Google Safe Browsing advisories
            </a>
            . Google works to provide the most accurate and up-to-date information, but cannot guarantee it is complete or
            error-free.
          </p>
        )}
      </footer>
    </section>
  );
}
