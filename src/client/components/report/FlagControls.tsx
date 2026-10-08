import { useId, useState } from "react";
import { flagKeepDays, flagNoteMaxLength, flagReasonLabels, flagReasons, type FlagReason } from "../../../shared/flags";
import type { ScanReport } from "../../../shared/report";
import { flagTurnstileAction } from "../../../shared/turnstile";
import { TurnstileWidget } from "@/components/scan/TurnstileWidget";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

type FlagStatus = "received" | "already_received";

const kept: Record<ScanReport["subject"]["kind"], { what: string; never: string }> = {
  url: { what: "the site's domain", never: "the full link" },
  message: { what: "the domain of the main link", never: "the message itself" },
  file: { what: "the file's fingerprint", never: "the file or its name" },
};

export function FlagControls({ report, signature, siteKey }: { report: ScanReport; signature: string; siteKey: string | null }) {
  const groupId = useId();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<FlagReason | null>(null);
  const [note, setNote] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [resetKey, setResetKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState<FlagStatus | null>(null);
  const stored = kept[report.subject.kind];

  function retryCheck() {
    setToken(null);
    setResetKey((value) => value + 1);
  }

  async function send() {
    if (!reason) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/v1/flags", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          report,
          signature,
          reason,
          ...(note.trim() ? { note: note.trim().slice(0, flagNoteMaxLength) } : {}),
          ...(token ? { turnstileToken: token } : {}),
        }),
      });
      const body = (await response.json()) as { status?: FlagStatus; error?: { message?: string } };
      if (!response.ok || !body.status) {
        setError(body.error?.message ?? "The flag could not be sent. Try again in a minute.");
        retryCheck();
        return;
      }
      setSent(body.status);
    } catch {
      setError("ScamCam could not be reached. Check your connection and try again.");
      retryCheck();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby={`${groupId}-heading`} className="mt-4 border border-rule bg-panel px-5 py-4">
      <h2 id={`${groupId}-heading`} className="rule-label">
        Think this result is wrong?
      </h2>
      {sent ? (
        <p role="status" className="mt-3 text-sm text-ink">
          {sent === "received" ? "Thanks. A person will review this report." : "This report was already flagged and is waiting for review."} A flag does
          not change the result for anyone.
        </p>
      ) : open ? (
        <form
          className="mt-3 space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
        >
          <fieldset>
            <legend className="text-sm text-ink">What is wrong?</legend>
            <div className="mt-2 space-y-2">
              {flagReasons.map((option) => (
                <label key={option} className="flex items-start gap-2 text-sm text-ink">
                  <input type="radio" className="mt-1" name={`${groupId}-reason`} value={option} checked={reason === option} onChange={() => setReason(option)} />
                  <span>{flagReasonLabels[option]}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <div>
            <label htmlFor={`${groupId}-note`} className="text-sm text-ink">
              Anything that would help the review (optional)
            </label>
            <Textarea
              id={`${groupId}-note`}
              className="mt-2 min-h-20"
              maxLength={flagNoteMaxLength}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              aria-describedby={`${groupId}-note-help`}
            />
            <p id={`${groupId}-note-help`} className="mt-1 text-xs text-ink-soft">
              Up to {flagNoteMaxLength} characters. Leave out your name, where you live, and other personal details. Emails,
              phone numbers, and codes are hidden automatically.
            </p>
          </div>
          <p className="text-xs text-ink-soft">
            ScamCam keeps the result, the names of the findings, {stored.what}, and your note for {flagKeepDays} days, never {stored.never}.
          </p>
          {siteKey && (
            <TurnstileWidget
              siteKey={siteKey}
              action={flagTurnstileAction}
              resetKey={resetKey}
              onToken={(value) => setToken(value)}
              onUnavailable={() => setError("The security check could not load. Turn off blockers for challenges.cloudflare.com or try again later.")}
            />
          )}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm" disabled={busy || !reason || (Boolean(siteKey) && !token)}>
              {busy ? "Sending" : "Send for review"}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <div className="mt-3 space-y-3">
          <p className="text-sm text-ink-soft">
            Flag it for a person to review. A flag never changes any result by itself, so it cannot be used to make a scam look safe.
          </p>
          <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
            Flag result as incorrect
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
