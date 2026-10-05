import { useId } from "react";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { useApiHealth, type ApiHealth } from "@/hooks/useApiHealth";

function statusText(health: ApiHealth): string {
  if (health.state === "checking") {
    return "Checking service status";
  }
  if (health.state === "offline") {
    return "The ScamCam service is not reachable right now";
  }
  return health.health.scanning === "available" ? "Scanning is available" : "Scanning is not available yet";
}

export function App() {
  const inputId = useId();
  const hintId = useId();
  const health = useApiHealth();

  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:rounded-md focus:bg-card focus:px-3 focus:py-2"
      >
        Skip to content
      </a>
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-4">
          <a href="/" className="text-lg font-semibold tracking-tight">
            ScamCam
          </a>
          <ThemeToggle />
        </div>
      </header>

      <main id="main" className="mx-auto w-full max-w-3xl flex-1 px-4 py-12 sm:py-20">
        <p className="text-sm font-medium uppercase tracking-widest text-primary">Put scams in focus</p>
        <h1 className="mt-3 text-4xl font-bold tracking-tight sm:text-5xl">Think it&apos;s a scam?</h1>
        <p className="mt-4 text-lg text-muted-foreground">
          Paste a suspicious link or message, like a Steam trade offer, a Discord gift, or a Roblox account warning.
          ScamCam checks it against independent security sources and explains what it finds.
        </p>

        <Card className="mt-8">
          <form
            onSubmit={(event) => event.preventDefault()}
            aria-describedby={hintId}
            className="flex flex-col gap-4"
          >
            <label htmlFor={inputId} className="text-sm font-medium">
              Link or message
            </label>
            <Textarea
              id={inputId}
              name="content"
              maxLength={4000}
              disabled
              placeholder="https://steamcommunlty.com/tradeoffer/new/..."
            />
            <p id={hintId} className="text-sm text-muted-foreground">
              Never paste passwords, login codes, or personal details. ScamCam does not need them.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" disabled>
                Check it
              </Button>
              <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
                {statusText(health)}
              </p>
            </div>
          </form>
        </Card>

        <p className="mt-6 text-sm text-muted-foreground">
          ScamCam is in early development. Results will always show their sources and how sure they are, and a clean
          result never means a link is guaranteed safe.
        </p>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-6 text-sm text-muted-foreground">
          <p>Free and noncommercial. No ads, no tracking.</p>
          <a className="underline underline-offset-4 hover:text-foreground" href="/.well-known/security.txt">
            Report a security issue
          </a>
        </div>
      </footer>
    </div>
  );
}
