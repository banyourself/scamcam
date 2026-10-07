import type { FileFinding, FileKind } from "./file-check";

export const authResults = ["pass", "fail", "softfail", "neutral", "none", "error", "unknown"] as const;
export type AuthResult = (typeof authResults)[number];

export const maxEmailAttachments = 5;
export const maxEmailBytes = 25 * 1024 * 1024;
export const emailDomainPattern = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,63}|xn--[a-z0-9-]{2,59})$/;

export function isEmailFile(file: { name: string; type: string }): boolean {
  return file.type === "message/rfc822" || file.name.trim().toLowerCase().endsWith(".eml");
}

export interface EmailAttachment {
  kind: FileKind;
  extension?: string;
  findings: FileFinding[];
}

export interface EmailFacts {
  fromDomain?: string;
  spf: AuthResult;
  dkim: AuthResult;
  dmarc: AuthResult;
  replyToDiffers: boolean;
  attachments: EmailAttachment[];
}
