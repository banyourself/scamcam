import type { ScanReport } from "../../../shared/report";

interface ExternalCheck {
  name: string;
  href: (value: string) => string;
}

const domainChecks: ExternalCheck[] = [
  { name: "VirusTotal", href: (domain) => `https://www.virustotal.com/gui/domain/${domain}` },
  { name: "Google Safe Browsing", href: (domain) => `https://transparencyreport.google.com/safe-browsing/search?url=${domain}` },
  { name: "urlscan.io", href: (domain) => `https://urlscan.io/search/#domain%3A${domain}` },
  { name: "Cisco Talos", href: (domain) => `https://talosintelligence.com/reputation_center/lookup?search=${domain}` },
  { name: "ScamAdviser", href: (domain) => `https://www.scamadviser.com/check-website/${domain}` },
  { name: "URLVoid", href: (domain) => `https://www.urlvoid.com/scan/${domain}/` },
];

const fileChecks: ExternalCheck[] = [
  { name: "VirusTotal", href: (hash) => `https://www.virustotal.com/gui/file/${hash}` },
  { name: "Hybrid Analysis", href: (hash) => `https://hybrid-analysis.com/search?query=${hash}` },
  { name: "Cisco Talos", href: (hash) => `https://talosintelligence.com/talos_file_reputation?s=${hash}` },
];

const domainPattern = /^(?=.{1,253}$)(?:[a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9_])?\.)+(?:[a-z]{2,63}|xn--[a-z0-9-]{2,59})$/;
const fingerprintPattern = /^[0-9a-f]{64}$/;

export function ExternalChecks({ report }: { report: ScanReport }) {
  const fingerprint = report.subject.fingerprint && fingerprintPattern.test(report.subject.fingerprint) ? report.subject.fingerprint : null;
  const domain = !fingerprint && report.subject.registrableDomain && domainPattern.test(report.subject.registrableDomain) ? report.subject.registrableDomain : null;
  const value = fingerprint ?? domain;
  if (!value) {
    return null;
  }
  const checks = fingerprint ? fileChecks : domainChecks;
  const what = fingerprint ? "this file's fingerprint" : value;
  return (
    <div className="border-t border-rule px-5 py-4">
      <h3 className="rule-label">Check it yourself elsewhere</h3>
      <p className="mt-2 text-sm text-ink-soft">
        These open other well-known checkers in a new tab. They learn {what} only when you click; ScamCam does not send it
        to them.
      </p>
      <ul className="mt-3 flex flex-wrap gap-2">
        {checks.map((check) => (
          <li key={check.name}>
            <a
              href={check.href(encodeURIComponent(value))}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center border border-rule-strong px-3 py-1.5 text-sm text-ink underline-offset-4 hover:underline"
            >
              {check.name}
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
