import { useId, useState } from "react";
import type { ScanReport } from "../../../shared/report";
import { defaultShareMinutes, shareMinutes, type CreatedShare, type ShareMinutes } from "../../../shared/share";
import { Button } from "@/components/ui/button";

function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function ShareControls({ report, signature }: { report: ScanReport; signature: string }) {
  const groupId = useId();
  const [minutes, setMinutes] = useState<ShareMinutes>(defaultShareMinutes);
  const [includeMessage, setIncludeMessage] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState<{ url: string; expiresAt: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const isMessage = report.subject.kind === "message";

  async function create() {
    setBusy(true);
    setError("");
    setCopied(false);
    try {
      const response = await fetch("/api/v1/shares", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ report, signature, minutes, includeMessage: isMessage && includeMessage }),
      });
      const body = (await response.json()) as CreatedShare & { error?: { message?: string } };
      if (!response.ok) {
        setError(body.error?.message ?? "The share link could not be made. Try again in a minute.");
        return;
      }
      setCreated({ url: `${window.location.origin}/r/${body.id}#${body.key}`, expiresAt: body.expiresAt });
    } catch {
      setError("ScamCam could not be reached. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <section aria-labelledby={`${groupId}-heading`} className="mt-4 border border-rule bg-panel px-5 py-4">
      <h2 id={`${groupId}-heading`} className="rule-label">
        Share this report
      </h2>
      {created ? (
        <div className="mt-3 space-y-2">
          <label htmlFor={`${groupId}-link`} className="text-sm text-ink">
            Anyone with this link can see the report until {clock(created.expiresAt)}.
          </label>
          <div className="flex flex-wrap gap-2">
            <input
              id={`${groupId}-link`}
              readOnly
              value={created.url}
              onFocus={(event) => event.currentTarget.select()}
              className="min-w-0 flex-1 border border-rule-strong bg-panel-2 px-3 py-2 font-mono text-xs text-ink"
            />
            <Button size="sm" onClick={() => void copy(created.url)}>
              {copied ? "Copied" : "Copy link"}
            </Button>
          </div>
          <p className="text-xs text-ink-soft" aria-live="polite">
            ScamCam keeps only an encrypted copy that it cannot read, and deletes it after the link expires.
          </p>
        </div>
      ) : (
        <div className="mt-3 space-y-3">
          <fieldset>
            <legend className="text-sm text-ink">Link works for</legend>
            <div className="mt-2 flex flex-wrap gap-4">
              {shareMinutes.map((option) => (
                <label key={option} className="flex items-center gap-2 text-sm text-ink">
                  <input type="radio" name={`${groupId}-minutes`} value={option} checked={minutes === option} onChange={() => setMinutes(option)} />
                  {option} minutes
                </label>
              ))}
            </div>
          </fieldset>
          {isMessage && (
            <label className="flex items-start gap-2 text-sm text-ink">
              <input type="checkbox" className="mt-1" checked={includeMessage} onChange={(event) => setIncludeMessage(event.target.checked)} />
              <span>
                Include the message text. Emails, phone numbers, and codes stay hidden, but names and usernames would be
                visible to anyone with the link.
              </span>
            </label>
          )}
          <p className="text-xs text-ink-soft">
            The link shows the result and the evidence{report.subject.kind === "file" ? " (the file's type, size, and fingerprint, never its name)" : ", including the checked links"}
            {isMessage && includeMessage ? ", and the message text" : ""}.
          </p>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void create()}>
            {busy ? "Making link" : "Make share link"}
          </Button>
        </div>
      )}
      {error && (
        <p role="alert" className="mt-3 border-l-4 border-level-malicious bg-panel-2 px-4 py-3 text-sm text-ink">
          {error}
        </p>
      )}
    </section>
  );
}
