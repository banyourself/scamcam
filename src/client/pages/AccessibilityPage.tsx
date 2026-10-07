import { DocumentPage } from "@/components/layout/DocumentPage";

export function AccessibilityPage() {
  return (
    <DocumentPage title="Accessibility" reference="SC-POL-05" updated="2026-10-07">
      <p>
        ScamCam aims to meet the Web Content Accessibility Guidelines (WCAG) 2.2 at level AA, so that anyone can check a
        suspicious message, including people who use screen readers, keyboards, magnification, or high contrast.
      </p>
      <h2>What is in place</h2>
      <ul>
        <li>Every page works with a keyboard, with a visible focus outline and a skip link.</li>
        <li>Form fields have labels and hints that screen readers announce.</li>
        <li>Risk levels are written out in words, never shown by color alone.</li>
        <li>Light and dark themes, readable at 320 pixels wide and when zoomed to 200 percent.</li>
        <li>Motion is minimal and turns off when your device asks for reduced motion.</li>
        <li>Automated accessibility checks run on every page before each release.</li>
        <li>
          The browser extension works from the keyboard: Alt+Shift+S opens it, its field and buttons are labeled, errors are
          announced, and it follows your system's light or dark setting and reduced motion.
        </li>
      </ul>
      <h2>Known limitations</h2>
      <p>Automated checks cannot catch everything. A manual screen reader review has not been done yet and is planned.</p>
      <h2>Feedback</h2>
      <p>
        If something is hard to use, email <a href="mailto:kevin@kevinle.tech">kevin@kevinle.tech</a> and describe the
        page and what happened. Replies within 7 days.
      </p>
    </DocumentPage>
  );
}
