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
| RFC 9116 | Adopted | `security.txt` with Contact and Expires (less than a year out) | `public/.well-known/security.txt`, expiry checked in CI. `Policy` points to the disclosure policy at `/disclosure`. The contact domain has working mail records (MX, SPF, DKIM, and a DMARC reject policy, checked by DNS lookup on 2026-10-05), and a test report from an outside address arrived the same day |
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

## Open legal questions, researched

Researched from public sources on 2026-10-05 at Kevin's request, in place of a lawyer. These are the best answers a
careful non-lawyer can reach, not legal advice. A lawyer or law school clinic can still confirm them.

| # | Question | Best answer | Change made |
|---|---|---|---|
| 1 | Does CalOPPA apply? | Probably not. Its "operator" must both collect and maintain personally identifiable information (name, address, email, phone, or similar) from Californians and run the site "for commercial purposes" (Bus. and Prof. Code 22577). ScamCam is noncommercial and keeps no such information | None needed; the Privacy page already covers CalOPPA's elements, and the effective date is set at launch |
| 2 | Could COPPA apply? | Probably not. COPPA's "operator" is a site "operated for commercial purposes", and the FTC says the rule targets commercial sites. If it did apply, the security use of IP addresses fits the "support for the internal operations" exception, and the 2025 amendments (compliance date April 22, 2026) require the online notice to say which internal operations use the identifier and how it is kept from other uses; general wording is enough | Privacy page: the younger-users section now says the IP address is used only for rate limits and the bot check, never to contact, profile, or advertise, and is not saved |
| 3 | GDPR legal basis, representative, contact details, Article 22 | GDPR probably does not apply: an English, US-only site that is merely reachable from the EU is not "offering" services there (Recital 23, EDPB Guidelines 3/2018), and ScamCam does no tracking. If it did, legitimate interests (Article 6(1)(f)) fits best, because messages can contain other people's data, which the contract basis does not cover. The Article 27 exemption covers only processing that is "not carried out regularly", so it would not clearly apply, which matters only if GDPR applies at all. An email address is the minimum contact detail. Article 22 does not apply, because a risk label about a link has no legal or similarly significant effect on the visitor | Privacy page: the legal basis section now says GDPR may not apply, names legitimate interests for the check and for security, and says messages that mention other people are used only for the check |
| 4 | Risk of labeling a website | The main risk is state defamation or trade libel, not federal false advertising, which needs commercial advertising between competitors. In *Enigma Software v. Malwarebytes* (9th Cir. 2023) the court said that in a security context, "malicious" and "threat" can be factual claims; before that appeal, the district court had found them opinion because Malwarebytes disclosed its criteria. *Zango v. Kaspersky* (9th Cir. 2009) gave Section 230(c)(2)(B) immunity to filtering software, but ScamCam advises rather than blocks, so that immunity is uncertain. California's anti-SLAPP law treats consumer warnings as a public issue (*Wilbanks v. Wolk*, 2004), but that case also shows that specific false statements of fact still lose. Showing a report to one visitor still counts as publication | The strongest level is now "Listed as malicious" instead of "Confirmed malicious", so it states a checkable fact (a named source lists it) rather than ScamCam's own conclusion. Reports keep describing signals, naming sources and dates, saying results can be wrong, and offering corrections |
| 5 | Terms and users under 18 | California lets minors disaffirm contracts (Family Code 6710), and courts have let minors escape game terms that way (*R.A. v. Epic Games*, C.D. Cal. 2019). So the liability limit and governing law clause may not bind a minor. The practical risk is small for a free information tool with no payments. A minimum age would not change COPPA's look at the actual audience and would turn away the young players who most need the tool | Terms: "If you are under 18, please read these terms with a parent or guardian." No minimum age |
| 6 | Safe harbor for researchers | Meaningful for ScamCam's own service. After *Van Buren v. United States* (2021), CFAA liability turns on authorization, which the owner can give in writing. The Justice Department's May 2022 policy says good-faith security research should not be charged under the CFAA. California Penal Code 502 requires acting "without permission". The Copyright Office renewed the DMCA 1201 security research exemption on October 28, 2024 (37 CFR 201.40). The owner cannot authorize testing of Cloudflare or other providers | Disclosure page: the safe harbor now follows the disclose.io core terms (CFAA and state law authorization, a DMCA 1201 waiver, a waiver of conflicting terms, no reports to law enforcement) and says it covers only ScamCam itself |
| 7 | Provider terms | Safe Browsing: allowed, because it is "not for sale or revenue generating purposes". Its warnings must use qualifying words, credit "Advisory provided by Google" with the v4 advisory link (still the current one), link to Google's definition of each threat type, and say in the product documentation that the protection is not perfect. Workers AI: Cloudflare does not use the content for training and keeps it only if the site stores it in another Cloudflare service. Cloudflare's Data Processing Addendum is incorporated by reference into the Self-Serve Subscription Agreement, so it covers free accounts. Phishing.Database: MIT license; the notice is required only when copies are distributed, and ScamCam keeps a private hashed copy. URLhaus: free for not-for-profit use with an Auth-Key, within fair-use volumes. RDAP registry terms were not checked | Reports: Google warnings now link to Google's threat definition and say "potentially unsafe". How it works: Google's protection notice. Privacy page: the Workers AI sentence now matches Cloudflare's wording |
| 8 | Is the name safe? | Probably. Kevin's USPTO search found no "ScamCam" mark, and a web search found only "SCRAM CAM", a registered mark for offender-monitoring devices in an unrelated field. No current web presence or registration was found for the 2024 travel startup. US trademark rights are territorial, so a foreign business without US use has no US rights unless the mark is famous here | Keep the name. If anyone complains, reply politely and consider renaming; nothing is sold, so a rename costs little |

Sources: [Bus. and Prof. Code 22577](https://california.public.law/codes/business_and_professions_code_section_22577),
[FTC 2025 COPPA amendments summary (Fenwick)](https://www.fenwick.com/insights/publications/coppas-coming-of-age-key-compliance-changes-in-ftcs-final-rule),
[EDPB Guidelines 3/2018](https://edpb.europa.eu/sites/edpb/files/files/file1/edpb_guidelines_3_2018_territorial_scope_en.pdf),
[Enigma v. Malwarebytes (2023), discussed by Eric Goldman](https://blog.ericgoldman.org/archives/2023/06/the-9th-circuit-keeps-trying-to-ruin-cybersecurity-enigma-v-malwarebytes.htm),
[Zango v. Kaspersky](https://caselaw.findlaw.com/us-9th-circuit/1093914.html),
[Wilbanks v. Wolk](https://caselaw.findlaw.com/ca-court-of-appeal/1010347.html),
[minors and arbitration (R.A. v. Epic Games)](https://cpmlegal.com/blogs-Advocates-For-Justice/disaffirmance-by-a-minor-as-a-defense-to-arbitration),
[DMCA 1201 rulemaking, October 2024](https://ipwatchdog.com/2024/10/25/copyright-office-denies-proposed-ai-security-research-exemption-triennial-rulemaking-dmca/),
[Safe Browsing permitted use](https://developers.google.com/safe-browsing/reference/Appropriate.Usage),
[Workers AI privacy](https://developers.cloudflare.com/workers-ai/platform/privacy/),
[Cloudflare Self-Serve Subscription Agreement](https://www.cloudflare.com/terms/),
[Phishing.Database license](https://github.com/Phishing-Database/Phishing.Database/blob/master/LICENSE),
[abuse.ch terms of use](https://abuse.ch/terms-of-use/).
