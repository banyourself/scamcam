import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { cn } from "@/lib/cn";
import { Link, usePath, useDocumentTitle } from "@/router";

export interface DocumentPageProps {
  title: string;
  reference: string;
  updated: string;
  draft?: boolean;
  lead?: ReactNode;
  children: ReactNode;
}

interface Section {
  id: string;
  text: string;
}

const related: [string, string][] = [
  ["/how-it-works", "How it works"],
  ["/security", "Security"],
  ["/privacy", "Privacy"],
  ["/terms", "Terms"],
  ["/disclosure", "Disclosure policy"],
];

function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "section";
}

function useSections(body: RefObject<HTMLDivElement | null>, key: string): [Section[], string] {
  const [sections, setSections] = useState<Section[]>([]);
  const [active, setActive] = useState("");

  useEffect(() => {
    const root = body.current;
    if (!root) return;
    const used = new Set<string>();
    const found = [...root.querySelectorAll("h2")].map((heading) => {
      let id = heading.id || slug(heading.textContent ?? "");
      for (let n = 2; used.has(id); n += 1) id = `${slug(heading.textContent ?? "")}-${n}`;
      used.add(id);
      heading.id = id;
      return { id, text: heading.textContent ?? "" };
    });
    setSections(found);
    const target = decodeURIComponent(window.location.hash.slice(1));
    if (target) document.getElementById(target)?.scrollIntoView();

    let frame = 0;
    let pinnedUntil = 0;
    const update = () => {
      frame = 0;
      if (performance.now() < pinnedUntil) return;
      let current = found[0]?.id ?? "";
      for (const section of found) {
        const heading = document.getElementById(section.id);
        if (heading && heading.getBoundingClientRect().top <= 140) current = section.id;
      }
      const bottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;
      const last = found.at(-1);
      if (bottom && last) current = last.id;
      setActive(current);
    };
    const onScroll = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };
    const onHash = () => {
      const id = decodeURIComponent(window.location.hash.slice(1));
      if (found.some((section) => section.id === id)) {
        pinnedUntil = performance.now() + 800;
        setActive(id);
      }
    };
    update();
    onHash();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("hashchange", onHash);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("hashchange", onHash);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [body, key]);

  return [sections, active];
}

export function DocumentPage({ title, reference, updated, draft = false, lead, children }: DocumentPageProps) {
  useDocumentTitle(title);
  const path = usePath();
  const body = useRef<HTMLDivElement>(null);
  const [sections, active] = useSections(body, path);
  const others = related.filter(([to]) => to !== path);

  return (
    <article className="mx-auto max-w-6xl px-4 pt-10 sm:pt-14 lg:grid lg:grid-cols-[minmax(0,1fr)_15rem] lg:gap-16">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-xs uppercase tracking-[0.16em] text-ink-faint">
          <span>Ref {reference}</span>
          <span aria-hidden="true">/</span>
          <span>Updated {updated}</span>
          {draft && (
            <>
              <span aria-hidden="true">/</span>
              <span className="text-level-suspicious">Draft for review</span>
            </>
          )}
        </div>
        <h1 className="display mt-3 text-5xl sm:text-6xl">{title}</h1>
        {lead && <div className="mt-4 max-w-[68ch] text-lg text-ink-soft">{lead}</div>}
        {draft && (
          <p className="mt-6 max-w-[68ch] border-l-4 border-level-suspicious bg-panel-2 px-4 py-3 text-sm text-ink-soft">
            This page is a draft written before ScamCam launches. It has not been reviewed by a lawyer and is not legal
            advice. It will be reviewed before the site goes live.
          </p>
        )}
        <div ref={body} className="prose-doc mt-6">
          {children}
        </div>
      </div>
      <aside className="hidden lg:block" aria-label="Page contents">
        <div className="sticky top-8 border-l border-rule pl-6 pt-1">
          {sections.length > 1 && (
            <nav aria-label="On this page">
              <p className="font-mono text-xs uppercase tracking-[0.16em] text-ink-faint">On this page</p>
              <ol className="mt-3 space-y-2 text-sm">
                {sections.map((section) => (
                  <li key={section.id}>
                    <a
                      href={`#${section.id}`}
                      aria-current={active === section.id ? "location" : undefined}
                      className={cn(
                        "-ml-[25px] block border-l-2 py-0.5 pl-[23px] transition-colors",
                        active === section.id
                          ? "border-accent text-ink"
                          : "border-transparent text-ink-soft hover:text-ink",
                      )}
                    >
                      {section.text}
                    </a>
                  </li>
                ))}
              </ol>
            </nav>
          )}
          <nav aria-label="Related pages" className={sections.length > 1 ? "mt-8" : ""}>
            <p className="font-mono text-xs uppercase tracking-[0.16em] text-ink-faint">Related</p>
            <ul className="mt-3 space-y-2 text-sm">
              {others.map(([to, label]) => (
                <li key={to}>
                  <Link to={to} className="text-ink-soft hover:text-ink">
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          <div className="mt-8 border border-rule bg-panel-2 px-4 py-3">
            <p className="text-sm text-ink-soft">Got a link, message, or file you are not sure about?</p>
            <Link to="/" className="mt-2 inline-block font-mono text-sm text-accent underline underline-offset-4">
              Check it now
            </Link>
          </div>
        </div>
      </aside>
    </article>
  );
}
