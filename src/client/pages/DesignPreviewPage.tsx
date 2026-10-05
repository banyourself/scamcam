import { ReportView } from "@/components/report/ReportView";
import { useDocumentTitle } from "@/router";
import { previewReports } from "@/preview-reports";

export function DesignPreviewPage() {
  useDocumentTitle("Design preview");
  return (
    <div className="mx-auto max-w-4xl space-y-10 px-4 pt-10">
      <div>
        <p className="kicker">Development only</p>
        <h1 className="display mt-3 text-5xl">Report design preview</h1>
        <p className="mt-3 text-ink-soft">
          Made-up example reports for designing the report layout. This page is not included in production builds.
        </p>
      </div>
      {previewReports.map((report) => (
        <ReportView key={report.caseNumber} report={report} />
      ))}
    </div>
  );
}
