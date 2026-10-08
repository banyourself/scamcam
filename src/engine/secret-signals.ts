import { secretHelp, type SecretKind } from "../shared/secrets";
import { sourceNames, type Signal } from "./signals";

export function secretSignals(kinds: SecretKind[]): Signal[] {
  return kinds.map((kind) => {
    const help = secretHelp[kind];
    return {
      id: `secret-${kind}`,
      source: sourceNames.message,
      sourceUrl: help.url,
      direction: help.scamSign ? "raises" : "context",
      strength: help.scamSign ? "strong" : "weak",
      ...(help.scamSign ? { family: "account_cookie" as const } : {}),
      title: help.title,
      detail: `ScamCam removed it before checking. ${help.advice}`,
    };
  });
}
