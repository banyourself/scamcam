import { Link } from "@/router";

const groups = [
  {
    heading: "ScamCam",
    links: [
      { to: "/", label: "Check a link or message" },
      { to: "/how-it-works", label: "How it works" },
      { to: "/extension", label: "Browser extension" },
      { to: "/stats", label: "Totals" },
      { to: "/contact", label: "Contact and corrections" },
    ],
  },
  {
    heading: "Policies",
    links: [
      { to: "/privacy", label: "Privacy" },
      { to: "/terms", label: "Terms of service" },
      { to: "/acceptable-use", label: "Acceptable use" },
      { to: "/cookies", label: "Cookies" },
      { to: "/accessibility", label: "Accessibility" },
    ],
  },
  {
    heading: "Security",
    links: [
      { to: "/security", label: "Security policy" },
      { to: "/disclosure", label: "Report a vulnerability" },
      { to: "/.well-known/security.txt", label: "security.txt" },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="mt-16 border-t border-rule">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 sm:grid-cols-[1.4fr_repeat(3,1fr)]">
        <div>
          <p className="display text-xl">ScamCam</p>
          <p className="mt-2 max-w-xs text-sm text-ink-soft">
            Free and noncommercial. No ads, no accounts, no tracking. Results are automated and can be wrong.
          </p>
        </div>
        {groups.map((group) => (
          <nav key={group.heading} aria-label={group.heading}>
            <p className="rule-label">{group.heading}</p>
            <ul className="mt-3 space-y-2 text-sm">
              {group.links.map((link) => (
                <li key={link.to}>
                  {link.to.startsWith("/.well-known") ? (
                    <a className="text-ink-soft hover:text-ink" href={link.to}>
                      {link.label}
                    </a>
                  ) : (
                    <Link className="text-ink-soft hover:text-ink" to={link.to}>
                      {link.label}
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>
    </footer>
  );
}
