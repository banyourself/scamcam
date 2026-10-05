# Compliance matrix

Research summary from 2026-10-05. **This is not legal advice.** Items marked "uncertain" should be reviewed by a
lawyer or a law school clinic before launch. Draft policy pages (Stage 2) are drafts for review.

| Law or standard | Likely applies? | Why | What ScamCam does |
|---|---|---|---|
| CCPA / CPRA | Probably not | Covers for-profit "businesses" above revenue or volume thresholds | Design to its standard anyway; treat IPs and hashed IPs as personal information |
| CalOPPA | Uncertain | "Operator" may require a commercial site | Follow it: privacy policy with effective date, Do Not Track statement, third-party disclosure |
| California Age-Appropriate Design Code | Probably not | Applies to CCPA businesses; parts enforceable since April 2026 | Privacy-protective defaults anyway |
| COPPA (2025 amendments, compliance date April 22, 2026) | Uncertain | Covers sites run for commercial purposes; a gaming-focused site may be seen as directed to children | No personal information collected from users; IP only for security; written retention policy (`RETENTION_POLICY.md`) |
| GDPR / UK GDPR | Uncertain | Applies when offering services to people in the EU or UK, paid or not; an English, US-focused site arguably does not target them | No personal data stored; document legal basis (legitimate interest in security) in the Privacy Policy |
| ePrivacy / PECR | Yes if EU or UK users | Strictly necessary security storage needs no consent | No non-essential cookies, so no banner; list Cloudflare's security cookies |
| California breach notice (Civ. Code 1798.82) | Applies to any person, but covered data types are not stored | Names with SSNs, credentials, and similar | Store none of those |
| ADA Title III | Very unlikely | Ninth Circuit requires a nexus to a physical place | Target WCAG 2.2 AA voluntarily |
| WCAG 2.2 AA | Target | Accessibility for everyone | Semantic HTML, labels, focus styles, reduced motion, contrast checks (Stage 2 audit) |
| RFC 9116 | Adopted | `security.txt` with Contact and Expires (less than a year out) | `public/.well-known/security.txt`, expiry checked in CI |
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
