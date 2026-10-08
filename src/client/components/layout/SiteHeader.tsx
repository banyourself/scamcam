import { ThemeToggle } from "@/components/ThemeToggle";
import { LogoMark } from "@/components/layout/Logo";
import { Link, usePath } from "@/router";
import { cn } from "@/lib/cn";

const navigation = [
  { to: "/", label: "Check" },
  { to: "/breaches", label: "Breaches" },
  { to: "/how-it-works", label: "How it works" },
  { to: "/security", label: "Security" },
];

export function SiteHeader() {
  const path = usePath();
  return (
    <header className="border-b border-rule bg-bg/90">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-3 px-4 py-3">
        <Link to="/" className="flex items-center gap-2.5 text-ink" aria-label="ScamCam home">
          <LogoMark className="h-8 w-8 text-accent" />
          <span className="display text-2xl tracking-wide">ScamCam</span>
        </Link>
        <div className="flex items-center gap-2 sm:gap-4">
          <nav aria-label="Main">
            <ul className="flex flex-wrap items-center gap-1 font-mono text-sm">
              {navigation.map((item) => (
                <li key={item.to}>
                  <Link
                    to={item.to}
                    aria-current={path === item.to ? "page" : undefined}
                    className={cn(
                      "whitespace-nowrap rounded-sm px-2 py-1.5 text-ink-soft hover:text-ink",
                      path === item.to && "text-ink underline decoration-accent decoration-2 underline-offset-[6px]",
                    )}
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
