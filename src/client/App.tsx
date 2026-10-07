import { lazy, Suspense, type ComponentType } from "react";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { AcceptableUsePage } from "@/pages/AcceptableUsePage";
import { AccessibilityPage } from "@/pages/AccessibilityPage";
import { ContactPage } from "@/pages/ContactPage";
import { CookiesPage } from "@/pages/CookiesPage";
import { DisclosurePage } from "@/pages/DisclosurePage";
import { ExtensionPage } from "@/pages/ExtensionPage";
import { HomePage } from "@/pages/HomePage";
import { HowItWorksPage } from "@/pages/HowItWorksPage";
import { NotFoundPage } from "@/pages/NotFoundPage";
import { PrivacyPage } from "@/pages/PrivacyPage";
import { SecurityPage } from "@/pages/SecurityPage";
import { StatsPage } from "@/pages/StatsPage";
import { SharedReportPage } from "@/pages/SharedReportPage";
import { TermsPage } from "@/pages/TermsPage";
import { usePath } from "@/router";

const DesignPreviewPage = import.meta.env.DEV
  ? lazy(() => import("@/pages/DesignPreviewPage").then((module) => ({ default: module.DesignPreviewPage })))
  : null;

const routes: Record<string, ComponentType> = {
  "/": HomePage,
  "/how-it-works": HowItWorksPage,
  "/extension": ExtensionPage,
  "/stats": StatsPage,
  "/privacy": PrivacyPage,
  "/terms": TermsPage,
  "/acceptable-use": AcceptableUsePage,
  "/cookies": CookiesPage,
  "/accessibility": AccessibilityPage,
  "/security": SecurityPage,
  "/disclosure": DisclosurePage,
  "/contact": ContactPage,
};

export function App() {
  const path = usePath();
  const Page =
    routes[path] ?? (path.startsWith("/r/") ? SharedReportPage : path === "/design" && DesignPreviewPage ? DesignPreviewPage : NotFoundPage);

  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-10 focus:bg-panel focus:px-3 focus:py-2 focus:text-ink"
      >
        Skip to content
      </a>
      <SiteHeader />
      <main id="main" tabIndex={-1} className="flex-1 focus:outline-none">
        <Suspense fallback={<p className="mx-auto max-w-6xl px-4 pt-10 text-ink-soft">Loading</p>}>
          <Page />
        </Suspense>
      </main>
      <SiteFooter />
    </div>
  );
}
