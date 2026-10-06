import { useEffect, useState } from "react";
import { fromBase64Url } from "../../shared/base64url";
import { shareIdPattern, shareKeyPattern, type SharedReport, type StoredShare } from "../../shared/share";
import { ReportView } from "@/components/report/ReportView";
import { Link, usePath, useDocumentTitle } from "@/router";

type State = { kind: "loading" } | { kind: "gone" } | { kind: "broken" } | { kind: "ready"; shared: SharedReport };

async function openShare(id: string, key: string): Promise<State> {
  const keyBytes = fromBase64Url(key);
  if (!shareIdPattern.test(id) || !shareKeyPattern.test(key) || !keyBytes) {
    return { kind: "broken" };
  }
  const response = await fetch(`/api/v1/shares/${id}`, { headers: { Accept: "application/json" } });
  if (response.status === 404) {
    return { kind: "gone" };
  }
  if (!response.ok) {
    return { kind: "broken" };
  }
  const stored = (await response.json()) as StoredShare;
  const iv = fromBase64Url(stored.iv);
  const ciphertext = fromBase64Url(stored.ciphertext);
  if (!iv || !ciphertext) {
    return { kind: "broken" };
  }
  try {
    const cryptoKey = await crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, ["decrypt"]);
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, cryptoKey, ciphertext);
    return { kind: "ready", shared: JSON.parse(new TextDecoder().decode(plain)) as SharedReport };
  } catch {
    return { kind: "broken" };
  }
}

function minutesLeft(iso: string): number {
  return Math.max(0, Math.ceil((Date.parse(iso) - Date.now()) / 60_000));
}

export function SharedReportPage() {
  useDocumentTitle("Shared report");
  const path = usePath();
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    const robots = document.createElement("meta");
    robots.name = "robots";
    robots.content = "noindex, nofollow";
    document.head.appendChild(robots);
    return () => robots.remove();
  }, []);

  useEffect(() => {
    let alive = true;
    const id = path.slice("/r/".length);
    openShare(id, window.location.hash.slice(1))
      .then((next) => alive && setState(next))
      .catch(() => alive && setState({ kind: "broken" }));
    return () => {
      alive = false;
    };
  }, [path]);

  return (
    <div className="mx-auto max-w-4xl px-4 pt-12">
      <p className="kicker">Shared report</p>
      {state.kind === "loading" && <p className="mt-4 text-ink-soft">Opening the shared report</p>}
      {(state.kind === "gone" || state.kind === "broken") && (
        <>
          <h1 className="display mt-3 text-5xl">{state.kind === "gone" ? "This link has expired" : "This link does not work"}</h1>
          <p className="mt-4 max-w-xl text-lg text-ink-soft">
            {state.kind === "gone"
              ? "Shared reports last at most 15 minutes and are then deleted."
              : "The link may be incomplete. Ask the person who shared it to copy the whole link."}{" "}
            You can check the link or message yourself.
          </p>
          <p className="mt-6">
            <Link to="/" className="text-accent underline underline-offset-4">
              Go to the check page
            </Link>
          </p>
        </>
      )}
      {state.kind === "ready" && (
        <>
          <h1 className="display mt-3 text-5xl">A report someone shared</h1>
          <p className="mt-4 max-w-2xl text-ink-soft">
            Checked {new Date(state.shared.report.createdAt).toLocaleString()}. This is a snapshot, and the link stops working in{" "}
            {minutesLeft(state.shared.expiresAt)} minutes. For a fresh result, <Link to="/" className="text-accent underline underline-offset-4">check it yourself</Link>.
            {!state.shared.includesMessage && " The person who shared it did not include the message text."}
          </p>
          <div className="mt-6">
            <ReportView report={state.shared.report} />
          </div>
        </>
      )}
    </div>
  );
}
