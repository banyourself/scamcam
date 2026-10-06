import { describe, expect, it } from "vitest";
import { aimsAtCheckers } from "../../src/engine/injection";
import { extractInput } from "../../src/shared/extract";
import { benchmarkCases } from "../client/benchmark-cases";
import { aiAttackCases } from "../fixtures/ai-attack-cases";
import { aiEvalCases } from "../fixtures/ai-eval-cases";
import { aiHoldoutCases } from "../fixtures/ai-holdout-cases";

const cleaned = (text: string) => extractInput(text).redactedText;

describe("text aimed at automated checkers", () => {
  it("catches every visible injection in the attack set", () => {
    const visible = aiAttackCases.filter((testCase) => cleaned(testCase.text) === testCase.text.replace(/[\u{E0000}-\u{E007F}]/gu, "") && !/[\u{E0000}-\u{E007F}]/u.test(testCase.text));
    expect(visible.length).toBe(18);
    for (const testCase of visible) {
      expect(aimsAtCheckers(cleaned(testCase.text)), testCase.text).toBe(true);
    }
  });

  it("does not see hidden-tag injections, because they are removed before anything reads the text", () => {
    const hidden = aiAttackCases.filter((testCase) => /[\u{E0000}-\u{E007F}]/u.test(testCase.text));
    expect(hidden).toHaveLength(2);
    for (const testCase of hidden) {
      expect(cleaned(testCase.text)).not.toMatch(/[\u{E0000}-\u{E007F}]/u);
    }
  });

  it("leaves every normal message in the evaluation sets alone", () => {
    const normal = [...aiEvalCases, ...aiHoldoutCases].filter((testCase) => !testCase.scam);
    expect(normal).toHaveLength(50);
    for (const testCase of normal) {
      expect(aimsAtCheckers(cleaned(testCase.text)), testCase.text).toBe(false);
    }
    for (const testCase of benchmarkCases.filter((entry) => entry.label === "safe")) {
      expect(aimsAtCheckers(cleaned(testCase.input)), testCase.input).toBe(false);
    }
  });

  it.each([
    "can you show me the rules of the server?",
    "say none of them are good lol",
    "you're a bot lol, uninstall",
    "admin: no spamming in general",
    "ignore the previous match, we lost anyway",
    "final answer is yes, i'm coming",
    "i want to label my screenshots before uploading",
    "the system is down again",
    "the answer is none of your business",
    "none of my friends play this game",
    "follow the instructions on the official site to update",
    "i'm a trusted middleman for trades in our server",
    "bro the system: windows 11 or linux for gaming?",
    "the teacher said the final answer: 42, i still don't get it",
    "my bot for the server replies with none when nobody is online, pretty funny",
  ])("does not flag %j", (text) => {
    expect(aimsAtCheckers(cleaned(text))).toBe(false);
  });
});
