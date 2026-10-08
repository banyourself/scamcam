import type { ZxcvbnFactory } from "@zxcvbn-ts/core";
import { useDeferredValue, useEffect, useId, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { buildPassphrase, describeStrength, loadStrengthChecker, loadWordlist, type Passphrase } from "@/lib/password-tools";

const effWordlistUrl = "https://www.eff.org/dice";
const meterColors = ["bg-level-malicious", "bg-level-high", "bg-level-suspicious", "bg-level-safe", "bg-level-safe"];
const selectClass = "rounded-[3px] border border-rule-strong bg-bg px-2 py-1.5 text-sm text-ink focus-visible:border-accent";
const secondsPerYear = 365.25 * 24 * 60 * 60;
const whole = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

export function guessingTime(bits: number, perSecond = 1e12): string {
  const seconds = 2 ** (bits - 1) / perSecond;
  if (seconds >= secondsPerYear * 1e9) {
    return "more than a billion years";
  }
  if (seconds >= secondsPerYear) {
    return `about ${whole.format(seconds / secondsPerYear)} years`;
  }
  const days = seconds / 86_400;
  return days >= 1 ? `about ${whole.format(days)} days` : "less than a day";
}

export function PasswordStrength({ password }: { password: string }) {
  const deferred = useDeferredValue(password);
  const [checker, setChecker] = useState<ZxcvbnFactory | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (deferred === "" || checker || failed) {
      return;
    }
    let live = true;
    loadStrengthChecker().then(
      (loaded) => live && setChecker(loaded),
      () => live && setFailed(true),
    );
    return () => {
      live = false;
    };
  }, [deferred, checker, failed]);

  const strength = useMemo(() => (checker && deferred !== "" ? describeStrength(checker.check(deferred.slice(0, 256))) : null), [checker, deferred]);

  if (password === "") {
    return null;
  }
  if (!strength) {
    return <p className="text-sm text-ink-faint">{failed ? "The strength estimate could not load." : "Loading the strength estimate"}</p>;
  }
  return (
    <div className="space-y-2 border border-rule bg-panel-2 px-4 py-3 text-sm">
      <div className="flex gap-1" aria-hidden="true">
        {[0, 1, 2, 3, 4].map((step) => (
          <span key={step} className={cn("h-1.5 flex-1 rounded-full", step <= strength.score ? meterColors[strength.score] : "bg-rule")} />
        ))}
      </div>
      <p className="text-ink">
        Strength: <strong aria-live="polite">{strength.label}</strong>
      </p>
      <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-[auto_1fr]">
        <dt className="text-ink-soft">Guessing it at a login page with limits</dt>
        <dd className="text-ink">{strength.online}</dd>
        <dt className="text-ink-soft">Guessing a leaked copy with fast computers</dt>
        <dd className="text-ink">{strength.offline}</dd>
      </dl>
      {strength.warning && <p className="text-ink">{strength.warning}</p>}
      {strength.suggestions.length > 0 && (
        <ul className="!mt-1">
          {strength.suggestions.map((tip) => (
            <li key={tip}>{tip}</li>
          ))}
        </ul>
      )}
      <p className="text-xs text-ink-soft">
        Estimated on this device with{" "}
        <a href="https://github.com/zxcvbn-ts/zxcvbn" target="_blank" rel="noopener noreferrer">
          zxcvbn-ts
        </a>{" "}
        (<a href="/licenses/zxcvbn-ts.txt">MIT</a>). Length matters most. A strong-looking password is still unsafe once it has leaked, so check it
        too.
      </p>
    </div>
  );
}

export function PassphraseMaker() {
  const id = useId();
  const [count, setCount] = useState(6);
  const [separator, setSeparator] = useState("-");
  const [extras, setExtras] = useState(false);
  const [result, setResult] = useState<Passphrase | null>(null);
  const [note, setNote] = useState("");

  async function make() {
    try {
      const words = await loadWordlist();
      setResult(buildPassphrase(words, count, separator, extras));
      setNote("");
    } catch {
      setNote("The word list could not load. Try again in a moment.");
    }
  }

  async function copy() {
    if (!result) {
      return;
    }
    try {
      await navigator.clipboard.writeText(result.phrase);
      setNote("Copied. Paste it into your password manager or the site, then clear your clipboard.");
    } catch {
      setNote("Copying is blocked here. Select the passphrase and copy it yourself.");
    }
  }

  return (
    <section aria-labelledby={`${id}-heading`} className="mt-4 border border-rule bg-panel px-5 py-4">
      <h3 id={`${id}-heading`} className="!mt-0">
        Make a strong passphrase
      </h3>
      <p className="mt-2 text-sm">
        Random words are easy to type and very hard to guess. Your browser picks them with its secure random number generator, and the
        passphrase is never sent anywhere or saved.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        <label className="flex items-center gap-2 text-ink">
          Words
          <select className={selectClass} value={count} onChange={(event) => setCount(Number(event.target.value))}>
            {[5, 6, 7, 8].map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-ink">
          Between words
          <select className={selectClass} value={separator} onChange={(event) => setSeparator(event.target.value)}>
            <option value="-">hyphens</option>
            <option value=" ">spaces</option>
            <option value=".">periods</option>
          </select>
        </label>
        <label className="flex items-center gap-2 text-ink">
          <input type="checkbox" checked={extras} onChange={(event) => setExtras(event.target.checked)} />
          Add a capital letter and a number
        </label>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button type="button" onClick={() => void make()}>
          {result ? "Make another" : "Make a passphrase"}
        </Button>
        {result && (
          <Button type="button" variant="outline" onClick={() => void copy()}>
            Copy
          </Button>
        )}
      </div>
      {result && (
        <div className="mt-3 border border-rule bg-panel-2 px-4 py-3">
          <p className="break-all font-mono text-lg text-ink" translate="no">
            {result.phrase}
          </p>
          <p className="mt-2 text-sm text-ink-soft">
            {result.bits} bits of randomness. A computer making a trillion guesses a second would need {guessingTime(result.bits)} on average
            to find it.
          </p>
        </div>
      )}
      <p role="status" aria-live="polite" className="mt-2 text-sm text-ink-soft">
        {note}
      </p>
      <p className="mt-3 text-xs text-ink-soft">
        Words from the{" "}
        <a href={effWordlistUrl} target="_blank" rel="noopener noreferrer">
          Electronic Frontier Foundation&apos;s long word list
        </a>{" "}
        (7,776 words,{" "}
        <a href="https://www.eff.org/copyright" target="_blank" rel="noopener noreferrer">
          CC BY
        </a>
        ). Use the extra capital and number only for sites that demand them; they add little strength.
      </p>
    </section>
  );
}
