import { authResults, emailDomainPattern, maxEmailAttachments, maxEmailBytes, type AuthResult, type EmailAttachment, type EmailFacts } from "../../shared/email";
import { maxInputLength } from "../../shared/extract";
import { inspectSource } from "./file-inspect";

export interface EmailRead {
  content: string;
  facts: EmailFacts;
}

export class EmailReadError extends Error {
  override name = "EmailReadError";
}

interface Part {
  headers: [string, string][];
  body: string;
}

interface Leaf {
  type: string;
  charset: string;
  encoding: string;
  disposition: string;
  filename: string;
  body: string;
}

const maxParts = 100;
const maxDepth = 6;
const maxHtmlCharacters = 400_000;
const blockTags = new Set(["br", "p", "div", "tr", "li", "h1", "h2", "h3", "h4", "h5", "h6", "table", "blockquote", "hr"]);
const skippedTags = new Set(["script", "style", "head", "title"]);
const entities: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function bytesToBinary(bytes: Uint8Array): string {
  const chunks: string[] = [];
  for (let index = 0; index < bytes.length; index += 8192) {
    chunks.push(String.fromCharCode(...bytes.subarray(index, index + 8192)));
  }
  return chunks.join("");
}

function binaryToBytes(binary: string): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index) & 0xff;
  }
  return bytes;
}

function decodeBytes(bytes: Uint8Array, charset: string): string {
  const label = charset.trim().toLowerCase() || "utf-8";
  try {
    return new TextDecoder(label).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

function headerText(raw: string): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(binaryToBytes(raw));
  } catch {
    return raw;
  }
}

function decodeBase64(text: string): Uint8Array<ArrayBuffer> {
  let clean = text.replace(/[^A-Za-z0-9+/]/g, "");
  if (clean.length % 4 === 1) {
    clean = clean.slice(0, -1);
  }
  try {
    return binaryToBytes(atob(clean + "=".repeat((4 - (clean.length % 4)) % 4)));
  } catch {
    return new Uint8Array(0);
  }
}

function decodeQuotedPrintable(text: string): Uint8Array<ArrayBuffer> {
  return binaryToBytes(text.replace(/=\r?\n/g, "").replace(/=([0-9A-Fa-f]{2})/g, (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16))));
}

export function decodeEncodedWords(value: string): string {
  return value
    .replace(/(=\?[^?\s]+\?[bBqQ]\?[^?\s]*\?=)\s+(?==\?[^?\s]+\?[bBqQ]\?)/g, "$1")
    .replace(/=\?([^?\s]+)\?([bBqQ])\?([^?\s]*)\?=/g, (_, charset: string, kind: string, data: string) => {
      const bytes = kind.toLowerCase() === "b" ? decodeBase64(data) : decodeQuotedPrintable(data.replace(/_/g, " "));
      return decodeBytes(bytes, charset.replace(/\*.*$/, ""));
    });
}

function splitPart(raw: string): Part {
  const match = /\r?\n\r?\n/.exec(raw);
  const head = match ? raw.slice(0, match.index) : raw;
  const body = match ? raw.slice(match.index + match[0].length) : "";
  const headers: [string, string][] = [];
  for (const line of head.split(/\r?\n/)) {
    if (/^[ \t]/.test(line) && headers.length > 0) {
      headers[headers.length - 1]![1] += ` ${line.trim()}`;
      continue;
    }
    const colon = line.indexOf(":");
    if (colon > 0) {
      headers.push([line.slice(0, colon).trim().toLowerCase(), line.slice(colon + 1).trim()]);
    }
  }
  return { headers, body };
}

function header(part: Part, name: string): string {
  return part.headers.find(([key]) => key === name)?.[1] ?? "";
}

function parameter(value: string, name: string): string {
  const extended = new RegExp(`;\\s*${name}\\*(?:0\\*)?\\s*=\\s*([^;]+)`, "i").exec(value);
  if (extended) {
    const [, charset = "utf-8", , encoded = ""] = /^([^']*)'([^']*)'(.*)$/.exec(extended[1]!.trim().replace(/^"|"$/g, "")) ?? [];
    return decodeBytes(binaryToBytes(encoded.replace(/%([0-9A-Fa-f]{2})/g, (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)))), charset);
  }
  const plain = new RegExp(`;\\s*${name}\\s*=\\s*(?:"([^"]*)"|([^;\\s]+))`, "i").exec(value);
  return decodeEncodedWords(plain?.[1] ?? plain?.[2] ?? "");
}

function leaves(raw: string): Leaf[] {
  const found: Leaf[] = [];
  const walk = (text: string, depth: number) => {
    if (found.length >= maxParts) {
      return;
    }
    const part = splitPart(text);
    const contentType = header(part, "content-type");
    const type = (contentType.split(";")[0] ?? "").trim().toLowerCase() || "text/plain";
    const boundary = parameter(contentType, "boundary");
    if (type.startsWith("multipart/") && boundary && depth < maxDepth) {
      const marker = `--${boundary}`;
      const sections = part.body.split(marker).slice(1);
      for (const section of sections) {
        if (section.startsWith("--")) {
          break;
        }
        walk(section.replace(/^[ \t]*\r?\n/, ""), depth + 1);
      }
      return;
    }
    const disposition = header(part, "content-disposition");
    found.push({
      type,
      charset: parameter(contentType, "charset"),
      encoding: header(part, "content-transfer-encoding").toLowerCase(),
      disposition: (disposition.split(";")[0] ?? "").trim().toLowerCase(),
      filename: parameter(disposition, "filename") || parameter(contentType, "name"),
      body: part.body,
    });
  };
  walk(raw, 0);
  return found;
}

function leafBytes(leaf: Leaf): Uint8Array<ArrayBuffer> {
  if (leaf.encoding === "base64") {
    return decodeBase64(leaf.body);
  }
  if (leaf.encoding === "quoted-printable") {
    return decodeQuotedPrintable(leaf.body);
  }
  return binaryToBytes(leaf.body);
}

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,8});/gi, (whole, name: string) => {
    if (name.startsWith("#")) {
      const code = name[1] === "x" || name[1] === "X" ? Number.parseInt(name.slice(2), 16) : Number.parseInt(name.slice(1), 10);
      return code > 0 && code <= 0x10ffff && (code < 0xd800 || code > 0xdfff) ? String.fromCodePoint(code) : " ";
    }
    return entities[name.toLowerCase()] ?? whole;
  });
}

function tidy(text: string): string {
  return text
    .replace(/[ \t\f\v\xa0]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function htmlToText(input: string): string {
  const html = input.slice(0, maxHtmlCharacters);
  const out: string[] = [];
  let index = 0;
  let skip: string | null = null;
  let link: { href: string; start: number } | null = null;
  while (index < html.length) {
    const open = html.indexOf("<", index);
    if (!skip) {
      out.push(decodeEntities(html.slice(index, open < 0 ? html.length : open)));
    }
    if (open < 0) {
      break;
    }
    if (html.startsWith("<!--", open)) {
      const end = html.indexOf("-->", open + 4);
      index = end < 0 ? html.length : end + 3;
      continue;
    }
    const close = html.indexOf(">", open + 1);
    if (close < 0) {
      break;
    }
    const tag = html.slice(open + 1, close);
    const closing = /^\s*\//.test(tag);
    const name = (/^\s*\/?\s*([a-zA-Z][a-zA-Z0-9]*)/.exec(tag)?.[1] ?? "").toLowerCase();
    if (skip) {
      if (closing && name === skip) {
        skip = null;
      }
    } else if (!closing && skippedTags.has(name)) {
      skip = name;
    } else if (name === "a" && !closing) {
      const href = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i.exec(tag);
      link = { href: decodeEntities(href?.[1] ?? href?.[2] ?? href?.[3] ?? "").trim(), start: out.length };
    } else if (name === "a" && closing && link) {
      const label = tidy(out.splice(link.start).join("")).replace(/[[\]\n]+/g, " ").trim();
      const href = /^https?:\/\/\S+$/i.test(link.href) ? link.href.replace(/[()]/g, (bracket) => (bracket === "(" ? "%28" : "%29")) : "";
      out.push(href ? (label ? `[${label}](${href})` : ` ${href} `) : label);
      link = null;
    } else {
      out.push(blockTags.has(name) ? "\n" : " ");
    }
    index = close + 1;
  }
  return tidy(out.join(""));
}

function domainOf(address: string): string | undefined {
  const at = address.lastIndexOf("@");
  if (at < 0) {
    return undefined;
  }
  const raw = address.slice(at + 1).replace(/[>\s;,"']+$/, "").trim().toLowerCase();
  try {
    const hostname = new URL(`http://${raw}`).hostname;
    return emailDomainPattern.test(hostname) ? hostname : undefined;
  } catch {
    return undefined;
  }
}

function sender(value: string): { name: string; domain: string | undefined } {
  const decoded = decodeEncodedWords(headerText(value));
  const angle = /<([^<>]*)>\s*$/.exec(decoded);
  const address = angle ? angle[1]! : decoded.trim();
  const name = angle ? decoded.slice(0, angle.index).trim().replace(/^"|"$/g, "").trim() : "";
  return { name: name.replace(/\s+/g, " ").slice(0, 120), domain: domainOf(address) };
}

function relatedDomains(first: string, second: string): boolean {
  return first === second || first.endsWith(`.${second}`) || second.endsWith(`.${first}`);
}

function authResult(value: string | undefined): AuthResult {
  const result = (value ?? "").toLowerCase();
  if (result === "temperror" || result === "permerror") {
    return "error";
  }
  return (authResults as readonly string[]).includes(result) ? (result as AuthResult) : "unknown";
}

function methodResults(value: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const match of value.matchAll(/\b(spf|dkim|dmarc)\s*=\s*([a-z]+)/gi)) {
    const method = match[1]!.toLowerCase();
    if (!found.has(method)) {
      found.set(method, match[2]!);
    }
  }
  return found;
}

export function authenticationFrom(part: Part): Pick<EmailFacts, "spf" | "dkim" | "dmarc"> {
  const [top, ...lower] = part.headers.filter(([name]) => name === "authentication-results").map(([, value]) => methodResults(value));
  const receivedSpf = /^\s*([a-z]+)/i.exec(header(part, "received-spf"))?.[1];
  const resultFor = (method: "spf" | "dkim" | "dmarc"): AuthResult => {
    const reported = top?.get(method) ?? (method === "spf" ? receivedSpf : undefined);
    const result = reported ? authResult(reported) : top ? "none" : "unknown";
    const worse = lower.map((found) => authResult(found.get(method)));
    if (result !== "pass" && result !== "fail" && worse.includes("fail")) {
      return "fail";
    }
    return result === "unknown" && worse.includes("none") ? "none" : result;
  };
  return { spf: resultFor("spf"), dkim: resultFor("dkim"), dmarc: resultFor("dmarc") };
}

async function attachmentFacts(leaf: Leaf): Promise<EmailAttachment | null> {
  const bytes = leafBytes(leaf);
  const name = leaf.filename || "attachment";
  const inspection = await inspectSource(name, { size: bytes.length, read: async (offset, length) => bytes.slice(offset, offset + length) });
  if (inspection.kind === "image" && inspection.findings.length === 0) {
    return null;
  }
  return { kind: inspection.kind, ...(inspection.extension ? { extension: inspection.extension } : {}), findings: inspection.findings };
}

export async function readEmailText(raw: string): Promise<EmailRead> {
  const top = splitPart(raw);
  if (!top.headers.some(([name]) => name === "from" || name === "subject" || name === "received")) {
    throw new EmailReadError("This does not look like an email file. Save the email as a .eml file and try again.");
  }
  const from = sender(header(top, "from"));
  const replyTo = sender(header(top, "reply-to"));
  const subject = decodeEncodedWords(headerText(header(top, "subject"))).replace(/\s+/g, " ").trim().slice(0, 200);
  const parts = leaves(raw);
  const isAttachment = (leaf: Leaf) => leaf.disposition === "attachment" || (leaf.filename !== "" && !leaf.type.startsWith("text/"));
  const html = parts.find((leaf) => leaf.type === "text/html" && !isAttachment(leaf));
  const plain = parts.find((leaf) => leaf.type === "text/plain" && !isAttachment(leaf));
  const body = html ? htmlToText(decodeBytes(leafBytes(html), html.charset)) : plain ? tidy(decodeBytes(leafBytes(plain), plain.charset)) : "";
  const attachments: EmailAttachment[] = [];
  for (const leaf of parts.filter(isAttachment)) {
    if (attachments.length >= maxEmailAttachments) {
      break;
    }
    const facts = await attachmentFacts(leaf);
    if (facts) {
      attachments.push(facts);
    }
  }
  const heading = [from.name && `From: ${from.name}`, subject && `Subject: ${subject}`].filter(Boolean).join("\n");
  const content = [heading, body].filter(Boolean).join("\n\n").slice(0, maxInputLength).trim();
  return {
    content: content || "(This email has no text.)",
    facts: {
      ...(from.domain ? { fromDomain: from.domain } : {}),
      ...authenticationFrom(top),
      replyToDiffers: Boolean(from.domain && replyTo.domain && !relatedDomains(from.domain, replyTo.domain)),
      attachments,
    },
  };
}

export async function readEmail(file: File): Promise<EmailRead> {
  if (file.size > maxEmailBytes) {
    throw new EmailReadError("This email file is too large to read. Emails up to 25 MB can be checked.");
  }
  return readEmailText(bytesToBinary(new Uint8Array(await file.arrayBuffer())));
}
