import { useDeferredValue, useId, useMemo, useState } from "react";
import { extractInput, maxInputLength } from "../../../shared/extract";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { ApiHealth } from "@/hooks/useApiHealth";

function statusLine(health: ApiHealth): { label: string; tone: "standby" | "offline" | "live" } {
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

export function ScanPanel({ health }: { health: ApiHealth }) {
  const inputId = useId();
  const hintId = useId();
  const previewId = useId();
  const [text, setText] = useState("");
  const deferred = useDeferredValue(text);
  const extracted = useMemo(() => extractInput(deferred), [deferred]);
  const status = statusLine(health);
  const canScan = health.state === "online" && health.health.scanning === "available";
  const hidden = [
    extracted.redactions.emails && plural(extracted.redactions.emails, "email"),
    extracted.redactions.phoneNumbers && plural(extracted.redactions.phoneNumbers, "phone number"),
    extracted.redactions.codes && plural(extracted.redactions.codes, "code"),
  ].filter(Boolean);

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

      <form
        className="mt-4 flex flex-col gap-3"
        aria-describedby={hintId}
        onSubmit={(event) => {
          event.preventDefault();
        }}
      >
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
            <p className="text-ink-faint">As you type, ScamCam shows what it would check. Nothing leaves your browser yet.</p>
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

        <div className="flex flex-wrap items-center gap-3 pt-1">
          <Button type="submit" disabled={!canScan || text.trim().length === 0}>
            Check it
          </Button>
          {!canScan && <p className="text-sm text-ink-soft">Checking is not open yet. ScamCam is still being built.</p>}
        </div>
      </form>
    </div>
  );
}
