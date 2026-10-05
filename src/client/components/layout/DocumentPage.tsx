import type { ReactNode } from "react";
import { useDocumentTitle } from "@/router";

export interface DocumentPageProps {
  title: string;
  reference: string;
  updated: string;
  draft?: boolean;
  lead?: ReactNode;
  children: ReactNode;
}

export function DocumentPage({ title, reference, updated, draft = false, lead, children }: DocumentPageProps) {
  useDocumentTitle(title);
  return (
    <article className="mx-auto max-w-6xl px-4 pt-10 sm:pt-14">
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
      <div className="prose-doc mt-6">{children}</div>
    </article>
  );
}
