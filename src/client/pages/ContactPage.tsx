import { DocumentPage } from "@/components/layout/DocumentPage";
import { Link } from "@/router";

const topics = [
  {
    title: "A result about my website looks wrong",
    body: "Send the address of the site and why you think the result is mistaken. Confirmed mistakes are corrected and logged, usually within 7 days.",
    subject: "ScamCam result review",
  },
  {
    title: "I found a security problem",
    body: "Please follow the vulnerability disclosure policy so the issue can be fixed safely.",
    subject: "ScamCam security",
  },
  {
    title: "Anything else",
    body: "Questions, accessibility problems, privacy requests, or ideas.",
    subject: "ScamCam",
  },
];

export function ContactPage() {
  return (
    <DocumentPage
      title="Contact"
      reference="SC-DOC-02"
      updated="2026-10-05"
      lead="ScamCam is run by one person. Email is the fastest way to reach me."
    >
      <div className="mt-2 grid gap-4">
        {topics.map((topic) => (
          <section key={topic.title} className="border border-rule bg-panel p-5">
            <h2 className="!mt-0 !text-xl">{topic.title}</h2>
            <p>{topic.body}</p>
            <p>
              <a href={`mailto:kevin@kevinle.tech?subject=${encodeURIComponent(topic.subject)}`}>Email kevin@kevinle.tech</a>
              {topic.subject === "ScamCam security" && (
                <>
                  {" "}
                  after reading the <Link to="/disclosure">disclosure policy</Link>
                </>
              )}
            </p>
          </section>
        ))}
      </div>
      <p>
        Do not email passwords, login codes, or other secrets. If you were scammed, also report it on the platform where it
        happened, and in the United States at reportfraud.ftc.gov.
      </p>
    </DocumentPage>
  );
}
