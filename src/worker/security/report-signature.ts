import { fromBase64Url, toBase64Url } from "../../shared/base64url";
import type { ScanReport } from "../../shared/report";

const minimumKeyLength = 32;

async function signingKey(secret: string | undefined, usage: "sign" | "verify"): Promise<CryptoKey | null> {
  if (!secret || secret.length < minimumKeyLength) {
    return null;
  }
  return crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [usage]);
}

export async function signReport(report: ScanReport, secret: string | undefined): Promise<string | null> {
  const key = await signingKey(secret, "sign");
  if (!key) {
    return null;
  }
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(JSON.stringify(report)));
  return toBase64Url(new Uint8Array(signature));
}

export async function reportIsAuthentic(report: ScanReport, signature: string, secret: string | undefined): Promise<boolean> {
  const key = await signingKey(secret, "verify");
  const bytes = fromBase64Url(signature);
  if (!key || !bytes || bytes.length !== 32) {
    return false;
  }
  return crypto.subtle.verify("HMAC", key, bytes, new TextEncoder().encode(JSON.stringify(report)));
}

export function sharingConfigured(secret: string | undefined): boolean {
  return Boolean(secret && secret.length >= minimumKeyLength);
}
