import { useDeferredValue, useId, useMemo, useRef, useState, type ClipboardEvent, type DragEvent, type FormEvent } from "react";
import { extractInput, maxInputLength } from "../../../shared/extract";
import type { ScanReport } from "../../../shared/report";
import { reportSignatureHeader } from "../../../shared/share";
import { TurnstileWidget } from "@/components/scan/TurnstileWidget";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { ApiHealth } from "@/hooks/useApiHealth";
import { acceptedImageTypes, ScreenshotError } from "@/lib/image-check";
import { cleanReadText, combineWithReadText } from "@/lib/screenshot-text";

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
  onReport: (report: ScanReport, signature: string | null) => void;
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
  const [reading, setReading] = useState<number | null>(null);
  const [readNote, setReadNote] = useState("");
  const [fromScreenshot, setFromScreenshot] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
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

  async function readImage(file: File) {
    if (reading !== null) {
      return;
    }
    setReading(0);
    setError("");
    setReadNote("");
    try {
      const { readScreenshot } = await import("@/lib/screenshot");
      const result = await readScreenshot(file, (share) => setReading(share));
      if (cleanReadText(result.text).length === 0 && result.qrTexts.length === 0) {
        setError("No text was found in that screenshot. Crop it to the message, or type the text instead.");
        return;
      }
      setText((current) => combineWithReadText(current, result.text, result.qrTexts));
      setFromScreenshot(true);
      setReadNote("Read from your screenshot on this device. Check the text and fix any mistakes, then press Check it.");
    } catch (problem) {
      setError(problem instanceof ScreenshotError ? problem.message : "This screenshot could not be read. Try again, or type the text instead.");
    } finally {
      setReading(null);
      if (fileInput.current) {
        fileInput.current.value = "";
      }
    }
  }

  function imageFrom(files: FileList | null | undefined): File | undefined {
    return files ? [...files].find((file) => file.type.startsWith("image/")) : undefined;
  }

  function pasted(event: ClipboardEvent<HTMLTextAreaElement>) {
    const image = imageFrom(event.clipboardData?.files);
    if (image) {
      event.preventDefault();
      void readImage(image);
    }
  }

  function dropped(event: DragEvent<HTMLFormElement>) {
    const image = imageFrom(event.dataTransfer?.files);
    if (image) {
      event.preventDefault();
      void readImage(image);
    }
  }

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
        body: JSON.stringify({ content: text, ...(token ? { turnstileToken: token } : {}), ...(fromScreenshot ? { fromScreenshot: true } : {}) }),
      });
      if (!response.ok) {
        setError(await readError(response));
        return;
      }
      onReport((await response.json()) as ScanReport, response.headers.get(reportSignatureHeader));
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

      <form
        className="mt-4 flex flex-col gap-3"
        aria-describedby={hintId}
        aria-busy={busy || reading !== null}
        onSubmit={(event) => void submit(event)}
        onDragOver={(event) => {
          if (event.dataTransfer?.types.includes("Files")) {
            event.preventDefault();
          }
        }}
        onDrop={dropped}
      >
        <label htmlFor={inputId} className="text-sm font-medium text-ink">
          Paste the link or message you are unsure about, or a screenshot of it
        </label>
        <Textarea
          id={inputId}
          name="content"
          value={text}
          maxLength={maxInputLength}
          onChange={(event) => {
            setText(event.target.value);
            if (event.target.value.trim() === "") {
              setFromScreenshot(false);
            }
          }}
          onPaste={pasted}
          aria-describedby={`${hintId} ${previewId}`}
          spellCheck={false}
          autoComplete="off"
          placeholder={"hey bro i accidentally reported your account, talk to the staff here: discord-appeals.example/report"}
        />
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-ink-faint">
          <p id={hintId}>
            Never paste passwords, login codes, or your real name or address. ScamCam never needs them. Screenshots are read on
            your device and never uploaded.
          </p>
          <p className="font-mono" aria-hidden="true">
            {text.length}/{maxInputLength}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button variant="outline" size="sm" disabled={reading !== null || busy} onClick={() => fileInput.current?.click()}>
            {reading === null ? "Read a screenshot" : "Reading"}
          </Button>
          <input
            ref={fileInput}
            type="file"
            accept={acceptedImageTypes}
            className="sr-only"
            tabIndex={-1}
            aria-hidden="true"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) {
                void readImage(file);
              }
            }}
          />
          <p className="text-xs text-ink-soft" aria-live="polite">
            {reading !== null
              ? `Reading the screenshot on this device: ${Math.round(reading * 100)}%`
              : readNote || "Or paste a screenshot into the box, or drop one here."}
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
