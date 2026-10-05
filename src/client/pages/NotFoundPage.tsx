import { Link, useDocumentTitle } from "@/router";

export function NotFoundPage() {
  useDocumentTitle("Page not found");
  return (
    <div className="mx-auto max-w-6xl px-4 pt-16">
      <p className="kicker">Error 404</p>
      <h1 className="display mt-3 text-6xl">Out of focus</h1>
      <p className="mt-4 max-w-md text-lg text-ink-soft">There is no page at this address.</p>
      <p className="mt-6">
        <Link to="/" className="text-accent underline underline-offset-4">
          Go to the check page
        </Link>
      </p>
    </div>
  );
}
