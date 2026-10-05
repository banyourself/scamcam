import { useDeferredValue, useId, useMemo, useState, type FormEvent } from "react";
import { extractInput, maxInputLength } from "../../../shared/extract";
import type { ScanReport } from "../../../shared/report";
import { TurnstileWidget } from "@/components/scan/TurnstileWidget";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { ApiHealth } from "@/hooks/useApiHealth";

function statusLine(health: ApiHealth, busy: boolean): { label: string; tone: "standby" | "offline" | "live" } {
  if (busy) {
    return { label: "Checking", tone: "standby" };
  }
  if (health.state === "checking") {
    return { label: "Connecting", tone: "standby" };
  }
  if (health.state === "offline") {
    return { label: "Service unreachable", tone: "offline" };
  }
  if (health.health.scanning === "available") {
    return { label: "Ready", tone: "live" };
  }
  if (health.health.scanning === "paused") {
    return { label: "Paused: daily free limit reached", tone: "offline" };
  }
  return { label: "Standby: checking opens soon", tone: "standby" };
}

const toneClass = {
  standby: "bg-accent",
  offline: "bg-level-malicious",
  live: "bg-level-safe",
};

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

async function readError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: { message?: string } };
    if (body.error?.message) {
      return body.error.message;
    }
  } catch {
    return "Something went wrong. Try again in a minute.";
  }
  return "Something went wrong. Try again in a minute.";
}

export interface ScanPanelProps {
  health: ApiHealth;
  onReport: (report: ScanReport) => void;
}

export function ScanPanel({ health, onReport }: ScanPanelProps) {
  const inputId = useId();
  const hintId = useId();
  const previewId = useId();
  const [text, setText] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [resetKey, setResetKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const deferred = useDeferredValue(text);
  const extracted = useMemo(() => extractInput(deferred), [deferred]);
  const status = statusLine(health, busy);
  const siteKey = health.state === "online" ? health.health.turnstileSiteKey : null;
  const canScan = health.state === "online" && health.health.scanning === "available";
  const hidden = [
    extracted.redactions.emails && plural(extracted.redactions.emails, "email"),
    extracted.redactions.phoneNumbers && plural(extracted.redactions.phoneNumbers, "phone number"),
    extracted.redactions.codes && plural(extracted.redactions.codes, "code"),
  ].filter(Boolean);
  const waitingForCheck = Boolean(siteKey) && !token;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!canScan || busy || text.trim().length === 0) {
      return;
    }
    if (waitingForCheck) {
      setError("Wait for the security check to finish, then try again.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/v1/scans", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ content: text, ...(token ? { turnstileToken: token } : {}) }),
      });
      if (!response.ok) {
        setError(await readError(response));
        return;
      }
      onReport((await response.json()) as ScanReport);
    } catch {
      setError("ScamCam could not be reached. Check your connection and try again.");
    } finally {
      setBusy(false);
      setToken(null);
      setResetKey((key) => key + 1);
    }
  }

  return (
    <div className="viewfinder p-5 sm:p-7">
      <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-[0.7rem] uppercase tracking-[0.16em] text-ink-faint">
        <span className="flex items-center gap-2">
          <span className={`inline-block h-2 w-2 rounded-full ${toneClass[status.tone]}`} aria-hidden="true" />
          <span role="status" aria-live="polite">
            {status.label}
          </span>
        </span>
        <span aria-hidden="true">Evidence intake / CAM 01</span>
      </div>

      <form className="mt-4 flex flex-col gap-3" aria-describedby={hintId} aria-busy={busy} onSubmit={(event) => void submit(event)}>
        <label htmlFor={inputId} className="text-sm font-medium text-ink">
          Paste the link or message you are unsure about
        </label>
        <Textarea
          id={inputId}
          name="content"
          value={text}
          maxLength={maxInputLength}
          onChange={(event) => setText(event.target.value)}
          aria-describedby={`${hintId} ${previewId}`}
          spellCheck={false}
          autoComplete="off"
          placeholder={"hey bro i accidentally reported your account, talk to the staff here: discord-appeals.example/report"}
        />
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-ink-faint">
          <p id={hintId}>Never paste passwords, login codes, or your real name or address. ScamCam never needs them.</p>
          <p className="font-mono" aria-hidden="true">
            {text.length}/{maxInputLength}
          </p>
        </div>

        <div id={previewId} className="border border-dashed border-rule bg-panel-2 px-4 py-3 text-sm" aria-live="polite">
          {extracted.links.length === 0 && hidden.length === 0 ? (
            <p className="text-ink-faint">As you type, ScamCam shows what it will check. Nothing is sent until you press Check it.</p>
          ) : (
            <div className="space-y-2">
              {extracted.links.length > 0 && (
                <div>
                  <p className="font-mono text-[0.7rem] uppercase tracking-[0.14em] text-ink-faint">
                    {plural(extracted.links.length, "link")} to check
                  </p>
                  <ul className="mt-1 space-y-0.5">
                    {extracted.links.map((link) => (
                      <li key={link} className="break-all font-mono text-ink">
                        {link}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {hidden.length > 0 && (
                <p className="text-ink-soft">
                  <span className="redact mr-2 align-middle" aria-hidden="true">
                    xxxx
                  </span>
                  Hidden before checking: {hidden.join(", ")}.
                </p>
              )}
            </div>
          )}
        </div>

        {canScan && siteKey && (
          <TurnstileWidget
            siteKey={siteKey}
            resetKey={resetKey}
            onToken={(value) => setToken(value)}
            onUnavailable={() => setError("The security check could not load. Turn off blockers for challenges.cloudflare.com or try again later.")}
          />
        )}

        <div className="flex flex-wrap items-center gap-3 pt-1">
          <Button type="submit" disabled={!canScan || busy || text.trim().length === 0 || waitingForCheck}>
            {busy ? "Checking" : "Check it"}
          </Button>
          {!canScan && health.state !== "checking" && <p className="text-sm text-ink-soft">Checking is not available right now.</p>}
          {canScan && waitingForCheck && text.trim().length > 0 && <p className="text-sm text-ink-soft">Waiting for the security check.</p>}
        </div>
        {error && (
          <p role="alert" className="border-l-4 border-level-malicious bg-panel-2 px-4 py-3 text-sm text-ink">
            {error}
          </p>
        )}
      </form>
    </div>
  );
}
