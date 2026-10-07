import { modIdPattern, type FileFinding } from "../../shared/file-check";

export interface ClassText {
  constants: string[];
  hidden: string[];
}

export interface JarScan {
  marks: Set<string>;
  tools: Set<string>;
  partial: boolean;
}

const decoder = new TextDecoder("utf-8");
const u16 = (bytes: Uint8Array, offset: number) => {
  if (offset + 2 > bytes.length) {
    throw new RangeError("truncated class file");
  }
  return (bytes[offset]! << 8) | bytes[offset + 1]!;
};
const u32 = (bytes: Uint8Array, offset: number) => {
  if (offset + 4 > bytes.length) {
    throw new RangeError("truncated class file");
  }
  return ((bytes[offset]! << 24) | (bytes[offset + 1]! << 16) | (bytes[offset + 2]! << 8) | bytes[offset + 3]!) >>> 0;
};

const constantSizes: Record<number, number> = { 3: 5, 4: 5, 5: 9, 6: 9, 7: 3, 8: 3, 9: 5, 10: 5, 11: 5, 12: 5, 15: 4, 16: 3, 17: 5, 18: 5, 19: 3, 20: 3 };
const byteArray = 8;
const charArray = 5;
const maxLiteral = 4096;
const base64Text = /^[A-Za-z0-9+/]{16,8192}={0,2}$/;

function printable(text: string): boolean {
  if (text.length < 4) {
    return false;
  }
  let plain = 0;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if ((code >= 0x20 && code < 0x7f) || code === 9 || code === 10 || code === 13) {
      plain += 1;
    }
  }
  return plain / text.length >= 0.9;
}

function fromBase64(text: string): string | null {
  if (text.length % 4 !== 0 || !base64Text.test(text)) {
    return null;
  }
  try {
    const decoded = atob(text);
    return printable(decoded) ? decoded : null;
  } catch {
    return null;
  }
}

function pushedValue(code: Uint8Array, at: number): { value: number; next: number } | null {
  const op = code[at];
  if (op === undefined) {
    return null;
  }
  if (op >= 0x02 && op <= 0x08) {
    return { value: op - 0x03, next: at + 1 };
  }
  if (op === 0x10 && at + 1 < code.length) {
    return { value: (code[at + 1]! << 24) >> 24, next: at + 2 };
  }
  if (op === 0x11 && at + 2 < code.length) {
    return { value: (((code[at + 1]! << 8) | code[at + 2]!) << 16) >> 16, next: at + 3 };
  }
  return null;
}

function arrayLiterals(code: Uint8Array, found: string[]): void {
  for (let at = 0; at + 1 < code.length; at += 1) {
    if (code[at] !== 0xbc || (code[at + 1] !== byteArray && code[at + 1] !== charArray)) {
      continue;
    }
    const store = code[at + 1] === byteArray ? 0x54 : 0x55;
    const values: number[] = [];
    let next = at + 2;
    while (code[next] === 0x59 && values.length < maxLiteral) {
      const index = pushedValue(code, next + 1);
      const value = index && index.value === values.length ? pushedValue(code, index.next) : null;
      if (!value || code[value.next] !== store) {
        break;
      }
      values.push(store === 0x54 ? value.value & 0xff : value.value & 0xffff);
      next = value.next + 1;
    }
    if (values.length >= 4) {
      const text = String.fromCharCode(...values);
      if (printable(text)) {
        found.push(text);
      }
      at = next - 1;
    }
  }
}

function codeLiterals(bytes: Uint8Array, start: number, pool: (string | undefined)[], found: string[]): void {
  let offset = start + 6;
  offset += 2 + u16(bytes, offset) * 2;
  for (const visit of [false, true]) {
    const members = u16(bytes, offset);
    offset += 2;
    for (let member = 0; member < members; member += 1) {
      const attributes = u16(bytes, offset + 6);
      offset += 8;
      for (let attribute = 0; attribute < attributes; attribute += 1) {
        const name = pool[u16(bytes, offset)];
        const length = u32(bytes, offset + 2);
        const body = offset + 6;
        if (body + length > bytes.length) {
          throw new RangeError("truncated class file");
        }
        if (visit && name === "Code" && length >= 8) {
          const codeLength = u32(bytes, body + 4);
          if (8 + codeLength <= length) {
            arrayLiterals(bytes.subarray(body + 8, body + 8 + codeLength), found);
          }
        }
        offset = body + length;
      }
    }
  }
}

export function classText(bytes: Uint8Array): ClassText | null {
  try {
    if (bytes.length < 10 || u32(bytes, 0) !== 0xcafebabe) {
      return null;
    }
    const count = u16(bytes, 8);
    const pool: (string | undefined)[] = [];
    const constants: string[] = [];
    let offset = 10;
    for (let index = 1; index < count; index += 1) {
      const tag = bytes[offset];
      if (tag === 1) {
        const end = offset + 3 + u16(bytes, offset + 1);
        if (end > bytes.length) {
          return null;
        }
        const text = decoder.decode(bytes.subarray(offset + 3, end));
        pool[index] = text;
        constants.push(text);
        offset = end;
        continue;
      }
      const size = tag === undefined ? undefined : constantSizes[tag];
      if (size === undefined) {
        return null;
      }
      offset += size;
      if (tag === 5 || tag === 6) {
        index += 1;
      }
    }
    const hidden = constants.flatMap((text) => fromBase64(text) ?? []);
    try {
      codeLiterals(bytes, offset, pool, hidden);
    } catch {
      return { constants, hidden };
    }
    return { constants, hidden };
  } catch {
    return null;
  }
}

export function newJarScan(): JarScan {
  return { marks: new Set(), tools: new Set(), partial: false };
}

const exactMarks = new Map<string, string>([
  ["func_148254_d", "session"],
  ["func_111286_b", "session"],
  ["net/minecraft/class_320", "sessionClass"],
  ["method_1674", "sessionMember"],
  ["method_1675", "sessionMember"],
  ["field_1983", "sessionMember"],
  ["net/minecraft/client/User", "userClass"],
  ["getAccessToken", "userMember"],
  ["getSessionId", "userMember"],
  ["java/net/HttpURLConnection", "network"],
  ["javax/net/ssl/HttpsURLConnection", "network"],
  ["java/net/http/HttpClient", "network"],
  ["java/net/URLConnection", "network"],
  ["java/net/Socket", "network"],
  ["okhttp3/OkHttpClient", "network"],
  ["org/apache/http/client/HttpClient", "network"],
  ["java/lang/ProcessBuilder", "exec"],
  ["java/lang/Runtime", "runtime"],
  ["exec", "runtimeExec"],
  ["java/net/URLClassLoader", "classLoader"],
  ["(Ljava/lang/String;Ljava/lang/String;ILjava/lang/String;)V", "urlParts"],
]);

const analysisTools = [
  "wireshark", "httpdebugger", "fiddler", "processhacker", "procmon", "x64dbg", "x32dbg", "ollydbg", "ida64", "dnspy", "tcpview",
  "vboxtray", "vboxservice", "vmtoolsd", "vmwaretray", "vmwareuser", "sandboxie",
];
const launcherFolders = [".lunarclient", "prismlauncher", "polymc", "multimc", ".feather", "badlion", "tlauncher", "atlauncher"];
const webhook = /discord(?:app)?\.com\/api\/webhooks\/\d{17,20}\/[\w-]{50,}/i;
const telegramBot = /api\.telegram\.org\/bot\d{6,12}:[\w-]{30,}/i;
const hiddenChat = /discord(?:app)?\.com\/api\/webhooks|api\.telegram\.org\/bot/;
const commands = /schtasks(?:\.exe)?\s+\/create|mshta|attrib(?:\.exe)?\s+\+h|currentversion\\run|add-mppreference|set-mppreference|vssadmin|bitsadmin(?:\.exe)?\s+\/transfer|certutil(?:\.exe)?\s+-urlcache|downloadstring/;
const hiddenHosts = /https?:\/\/([a-z0-9.-]+)/g;
const minecraftHosts = /(?:^|\.)(?:minecraft\.net|mojang\.com|minecraftservices\.com)$/;
const ipUrl = /https?:\/\/(\d{1,3}(?:\.\d{1,3}){3})(?![\d.])/;
const bareIp = /^(\d{1,3}(?:\.\d{1,3}){3})$/;

function publicIp(address: string): boolean {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part > 255)) {
    return false;
  }
  const [a, b] = parts as [number, number, number, number];
  return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127));
}

function pathMarks(lower: string, marks: Set<string>): void {
  const segment = (name: string) => lower === name || lower.endsWith(`\\${name}`) || lower.endsWith(`/${name}`) || lower.includes(`\\${name}\\`) || lower.includes(`/${name}/`);
  if (/local storage[\\/]+leveldb/.test(lower)) {
    marks.add("tokenStore");
  }
  if (segment("local storage")) {
    marks.add("localStorage");
  }
  if (segment("leveldb")) {
    marks.add("leveldb");
  }
  if (/[\\/]login data$/.test(lower) || /[\\/]network[\\/]cookies$/.test(lower)) {
    marks.add("browserLogins");
  }
  if (lower === "login data") {
    marks.add("loginData");
  }
  if (segment("user data")) {
    marks.add("userData");
  }
  if (lower === "os_crypt") {
    marks.add("osCrypt");
  }
  if (lower === "encrypted_key") {
    marks.add("encryptedKey");
  }
  if (segment("logins.json")) {
    marks.add("firefoxLogins");
  }
  if (segment("key4.db")) {
    marks.add("firefoxKeys");
  }
  if (segment("tdata")) {
    marks.add("tdata");
  }
  if (lower.includes("telegram desktop")) {
    marks.add("telegram");
  }
  if (lower.includes("nkbihfbeogaeaoehlefnkodbefgpgknn") || lower.includes("exodus.wallet")) {
    marks.add("wallet");
  }
  if (lower.includes("launcher_accounts") || lower.includes("microsoft_accounts.json")) {
    marks.add("accounts");
  }
  if (lower.includes("accounts.json")) {
    marks.add("accountsFile");
  }
  if (launcherFolders.some((folder) => lower.includes(folder))) {
    marks.add("launcherFolder");
  }
}

export function addClass(scan: JarScan, text: ClassText): void {
  const local = new Set<string>();
  for (const constant of text.constants) {
    const mark = exactMarks.get(constant);
    if (mark) {
      local.add(mark);
    }
    if (constant.length < 4) {
      continue;
    }
    if (webhook.test(constant) || telegramBot.test(constant)) {
      scan.marks.add("chat");
    }
  }
  for (const value of [...text.constants, ...text.hidden]) {
    if (value.length < 4) {
      continue;
    }
    const lower = value.toLowerCase();
    pathMarks(lower, scan.marks);
    for (const tool of analysisTools) {
      if (lower.includes(tool)) {
        scan.tools.add(tool);
      }
    }
    if (lower.includes("tasklist")) {
      scan.marks.add("tasklist");
    }
    if (commands.test(lower)) {
      scan.marks.add("commands");
    }
    const ip = ipUrl.exec(lower)?.[1];
    if (ip && publicIp(ip)) {
      scan.marks.add("hiddenDownload");
    }
  }
  let hiddenAddress = false;
  for (const value of text.hidden) {
    const lower = value.toLowerCase();
    if (hiddenChat.test(lower)) {
      scan.marks.add("chat");
    }
    const ip = bareIp.exec(lower.trim())?.[1];
    const hosts = [...lower.matchAll(hiddenHosts)].map((match) => match[1]!);
    if (hosts.some((host) => !minecraftHosts.test(host)) || (ip && publicIp(ip))) {
      hiddenAddress = true;
      scan.marks.add("hiddenDownload");
    }
  }
  if (local.has("session") || (local.has("sessionClass") && local.has("sessionMember")) || (local.has("userClass") && local.has("userMember"))) {
    scan.marks.add("sessionRead");
  }
  for (const mark of ["network", "exec"]) {
    if (local.has(mark)) {
      scan.marks.add(mark);
    }
  }
  if (local.has("runtime") && local.has("runtimeExec")) {
    scan.marks.add("exec");
  }
  if (local.has("classLoader") && (local.has("urlParts") || hiddenAddress)) {
    scan.marks.add("remoteCode");
  }
}

export function addEntryName(scan: JarScan, extension: string | null): void {
  if (extension && ["exe", "scr", "bat", "cmd", "ps1", "vbs", "vbe", "hta", "lnk", "msi", "wsf"].includes(extension)) {
    scan.marks.add("program");
  }
}

export function jarFindings(scan: JarScan): FileFinding[] {
  const has = (mark: string) => scan.marks.has(mark);
  const findings: FileFinding[] = [];
  if (
    has("tokenStore") ||
    (has("localStorage") && has("leveldb")) ||
    has("browserLogins") ||
    (has("loginData") && has("userData")) ||
    (has("osCrypt") && has("encryptedKey")) ||
    (has("firefoxLogins") && has("firefoxKeys")) ||
    (has("tdata") && has("telegram")) ||
    has("wallet")
  ) {
    findings.push("jar_steals_logins");
  }
  if (has("chat")) {
    findings.push("jar_sends_to_chat");
  }
  if (has("remoteCode")) {
    findings.push("jar_runs_downloaded_code");
  }
  if (scan.tools.size >= 2 || (has("tasklist") && scan.tools.size >= 1)) {
    findings.push("jar_hides_from_analysis");
  }
  if (has("exec") && has("commands")) {
    findings.push("jar_runs_commands");
  }
  if (has("accounts") || (has("accountsFile") && has("launcherFolder"))) {
    findings.push("jar_reads_accounts");
  }
  if (has("sessionRead") && has("network")) {
    findings.push("jar_session_token");
  }
  if (has("hiddenDownload")) {
    findings.push("jar_hidden_download");
  }
  if (has("program")) {
    findings.push("jar_has_program");
  }
  if (scan.partial) {
    findings.push("jar_partly_read");
  }
  return findings;
}

function cleanId(value: unknown): string | null {
  const id = typeof value === "string" ? value.trim().toLowerCase() : "";
  return modIdPattern.test(id) ? id : null;
}

export function parsedJson(text: string): unknown {
  try {
    return JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  } catch {
    return null;
  }
}

export const modInfoFiles = ["fabric.mod.json", "quilt.mod.json", "meta-inf/neoforge.mods.toml", "meta-inf/mods.toml", "mcmod.info", "plugin.yml", "paper-plugin.yml", "bungee.yml"] as const;

export function modIdFrom(file: (typeof modInfoFiles)[number], text: string): string | null {
  switch (file) {
    case "fabric.mod.json":
      return cleanId((parsedJson(text) as { id?: unknown } | null)?.id);
    case "quilt.mod.json":
      return cleanId((parsedJson(text) as { quilt_loader?: { id?: unknown } } | null)?.quilt_loader?.id);
    case "meta-inf/neoforge.mods.toml":
    case "meta-inf/mods.toml": {
      const mods = text.slice(Math.max(0, text.indexOf("[[mods]]")));
      return cleanId(/^\s*modId\s*=\s*["']([^"'\n]+)["']/m.exec(mods)?.[1]);
    }
    case "mcmod.info": {
      const info = parsedJson(text) as { modid?: unknown }[] | { modList?: { modid?: unknown }[] } | null;
      const first = Array.isArray(info) ? info[0] : info?.modList?.[0];
      return cleanId(first?.modid);
    }
    case "plugin.yml":
    case "paper-plugin.yml":
    case "bungee.yml":
      return cleanId(/^name:\s*["']?([^"'\n#]+?)["']?\s*$/m.exec(text)?.[1]);
  }
}
