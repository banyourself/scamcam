import { fromBase64Url } from "../../shared/base64url";
import { maxInputLength } from "../../shared/extract";

const pattern = /^#check=([A-Za-z0-9_-]{1,16384})$/;
const controlCharacters = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
let taken: string | null | undefined;

export function decodeHandoff(hash: string): string | null {
  const match = pattern.exec(hash);
  if (!match) {
    return null;
  }
  const bytes = match?.[1] ? fromBase64Url(match[1]) : null;
  if (!bytes) {
    return null;
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
  text = text.replace(controlCharacters, "").trim();
  return text ? text.slice(0, maxInputLength) : null;
}

export function takeHandoff(): string | null {
  if (taken !== undefined) {
    return taken;
  }
  taken = null;
  if (typeof window === "undefined" || !window.location.hash.startsWith("#check=")) {
    return taken;
  }
  taken = decodeHandoff(window.location.hash);
  window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
  return taken;
}
