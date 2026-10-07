import { useState } from "react";
import type { ScanReport } from "../../../shared/report";
import { Button } from "@/components/ui/button";
import { reportableLevels, reportPlaces, reportSummary } from "@/lib/report-summary";

export function ReportIt({ report }: { report: ScanReport }) {
  const [copied, setCopied] = useState<"" | "done" | "failed">("");
  if (!reportableLevels.has(report.level)) {
    return null;
  }
  const places = reportPlaces(report);

  async function copy() {
    try {
      await navigator.clipboard.writeText(reportSummary(report));
      setCopied("done");
    } catch {
      setCopied("failed");
    }
  }

  return (
    <div className="border-t border-rule px-5 py-4">
      <h3 className="rule-label">Report it</h3>
      <p className="mt-2 text-sm text-ink-soft">
        Reporting gets scams taken down faster and warns other people. Copy a summary of this report, then paste it into
        the right place below. Nothing is sent until you do.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button type="button" variant="outline" onClick={() => void copy()}>
          Copy summary
        </Button>
        <span className="text-sm text-ink-soft" role="status" aria-live="polite">
          {copied === "done" ? "Copied. Paste it into the report form." : copied === "failed" ? "Copying was blocked. Select the case details above instead." : ""}
        </span>
      </div>
      <ul className="mt-3 grid gap-2 sm:grid-cols-2">
        {places.map((place) => (
          <li key={place.name}>
            <a
              href={place.href}
              target="_blank"
              rel="noopener noreferrer"
              className="block border border-rule-strong px-3 py-2 text-sm text-ink underline-offset-4 hover:underline"
            >
              {place.name}
              <span className="sr-only"> (opens in a new tab)</span>
              <span className="block text-xs text-ink-soft">{place.note}</span>
            </a>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-sm text-ink-soft">
        Lost money or gave out a password? Contact your bank or card company first, change that password, then report it
        to the FTC and at ic3.gov.
      </p>
    </div>
  );
}
