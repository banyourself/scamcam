import { DocumentPage } from "@/components/layout/DocumentPage";

export function AcceptableUsePage() {
  return (
    <DocumentPage title="Acceptable use" reference="SC-POL-03" updated="2026-10-05" draft>
      <p>ScamCam is shared by everyone for free, so please keep it usable for others.</p>
      <h2>Do not</h2>
      <ul>
        <li>Send automated or bulk requests, scrape results, or try to get around rate limits or the bot check.</li>
        <li>Use ScamCam to test whether your own scam or malware gets detected.</li>
        <li>Submit other people&apos;s private information, passwords, or login codes.</li>
        <li>Use results to harass, threaten, or publicly accuse a person.</li>
        <li>Attack, overload, or probe ScamCam outside the rules in the vulnerability disclosure policy.</li>
        <li>Present ScamCam results as an official finding by Steam, Discord, Roblox, Microsoft, or anyone else.</li>
      </ul>
      <h2>What happens</h2>
      <p>Requests that break these rules may be blocked. Serious abuse may be reported to the provider involved.</p>
    </DocumentPage>
  );
}
