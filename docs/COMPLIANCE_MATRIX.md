# Compliance matrix

Research summary from 2026-10-05. **This is not legal advice.** Items marked "uncertain" should be reviewed by a
lawyer or a law school clinic before launch. Draft policy pages (Stage 2) are drafts for review.

| Law or standard | Likely applies? | Why | What ScamCam does |
|---|---|---|---|
| CCPA / CPRA | Probably not | Covers for-profit "businesses" above revenue or volume thresholds | Design to its standard anyway; treat IPs and hashed IPs as personal information |
| CalOPPA | Uncertain | "Operator" may require a commercial site | Follow it. The draft lists what is processed and who receives it, answers Do Not Track, says no other company can track visitors across sites through ScamCam, and says how changes are posted. The effective date is set at launch |
| California Age-Appropriate Design Code | Probably not | Applies to CCPA businesses; parts enforceable since April 2026 | Privacy-protective defaults anyway |
| COPPA (2025 amendments, compliance date April 22, 2026) | Uncertain | Covers sites run for commercial purposes; a gaming-focused site may be seen as directed to children | No personal information collected from users; IP only for security; written retention policy (`RETENTION_POLICY.md`) |
| GDPR / UK GDPR | Uncertain | Applies when offering services to people in the EU or UK, paid or not; an English, US-focused site arguably does not target them | No personal data stored. The draft Privacy Policy states the legal basis (the check the visitor asks for, and legitimate interest in security), says results are not decisions about people, and says where data is processed |
| ePrivacy / PECR | Yes if EU or UK users | Strictly necessary security storage needs no consent | No non-essential cookies, so no banner; Cloudflare's security cookies are listed. `npm run test:privacy` confirms in a real browser that ScamCam sets no cookies and stores only the theme choice (Turnstile test keys; repeat on the live site) |
| California breach notice (Civ. Code 1798.82) | Applies to any person, but covered data types are not stored | Names with SSNs, credentials, and similar | Store none of those |
| ADA Title III | Very unlikely | Ninth Circuit requires a nexus to a physical place | Target WCAG 2.2 AA voluntarily |
| WCAG 2.2 AA | Target | Accessibility for everyone | Semantic HTML, labels, focus styles, reduced motion, contrast checks (Stage 2 audit) |
| RFC 9116 | Adopted | `security.txt` with Contact and Expires (less than a year out) | `public/.well-known/security.txt`, expiry checked in CI. `Policy` points to the disclosure policy at `/disclosure`. The contact domain has working mail records (MX, SPF, and a DMARC reject policy, checked by DNS lookup on 2026-10-05) |
| OWASP ASVS, API Top 10, NIST CSF 2.0, SP 800-63B | Adopted as guidance | Engineering quality | Mapped in `SECURITY.md` and `TEST_PLAN.md`; SP 800-63B applies only if accounts are added |
| Provider terms | Yes | Safe Browsing, URLhaus, RDAP servers | See `API_LICENSE_MATRIX.md`; Safe Browsing wording rules are mandatory |

## Verdict wording

ScamCam's own verdicts are not protected by Section 230, and *Enigma v. Malwarebytes* (9th Cir. 2023) found that
labeling software "malicious" can be a statement of fact. So reports:

- describe signals, not intent ("High risk: matches known phishing patterns" plus the reasons),
- never say "fraud", "criminal", or "this person is scamming you", and never name individuals,
- show the date and source of every finding,
- say the assessment is automated and can be wrong,
- offer a way to request review of a result (Contact page, Stage 2), with corrections logged.

## Name and trademark

- USPTO Trademark Search, wordmark "ScamCam", run by Kevin on 2026-10-05: **no results**, live or dead. Still to run:
  "SCAM CAM" (with a space) and a design-mark search if a logo is adopted.
- A 2024 startup called ScamCam (Amsterdam Law Hub listing, LinkedIn; Tracxn lists Vilnius) works on scam protection
  for travelers. Same field, different market. Main naming risk.
- "Scam-Cam Technologies" (CCTV) and "SCRAM CAM" (offender monitoring) are in unrelated classes.
- Assessment: low risk in the US after the USPTO search; the EU startup remains the main overlap. Decide before Stage 6.

## Questions for a lawyer or law school clinic

The policy pages stay marked as drafts until these are answered. Each question names the page it affects.

1. CalOPPA (Privacy): does "operator" reach a free, noncommercial site, and if so, is the draft enough?
2. COPPA (Privacy, Terms): could a site about game trading scams be "directed to children"? ScamCam collects no
   personal information from visitors and uses IP addresses only for security, which may fit the "support for internal
   operations" exception.
3. GDPR (Privacy): which legal basis fits the check itself, contract or legitimate interest? Is an Article 27
   representative needed, given that processing is occasional and the EU is not targeted? Is an email address enough
   as the controller's contact details?
4. Defamation (report wording, Terms): is "High risk" with listed reasons safe for named websites after *Enigma v.
   Malwarebytes*? Is the correction process enough?
5. Minors and contracts (Terms): are the limitation of liability and governing law clauses enforceable against
   visitors under 18, who can disaffirm contracts? Should the Terms say anything about age?
6. Safe harbor (Disclosure): does the wording give researchers meaningful protection under the CFAA and DMCA
   section 1201?
7. Providers (Privacy, reports): do the Safe Browsing wording and caching, Workers AI use, and the MIT credit for
   Phishing.Database meet each provider's terms? Is Cloudflare's data processing addendum in place for a free account?
8. Name (all pages): is "ScamCam" safe to use given the 2024 startup with the same name? See the trademark notes above.

