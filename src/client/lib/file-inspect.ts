import { fileExtensionPattern, maxHashBytes, type FileCheckRequest, type FileFinding, type FileKind } from "../../shared/file-check";

export interface ByteSource {
  size: number;
  read(offset: number, length: number): Promise<Uint8Array>;
}

export interface FileInspection extends FileCheckRequest {
  insideArchive: string[];
}

const headBytes = 64 * 1024;
const tailBytes = 65_557;
const maxCentralDirectory = 4 * 1024 * 1024;
const maxScanBytes = 20 * 1024 * 1024;
const maxEntries = 5000;

const decoyExtensions = new Set([
  "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt", "rtf", "csv", "jpg", "jpeg", "png", "gif", "bmp", "webp", "heic",
  "mp4", "mov", "avi", "mkv", "mp3", "wav", "zip", "rar", "html", "htm",
]);
const scriptExtensions = new Set(["bat", "cmd", "ps1", "psm1", "psd1", "vbs", "vbe", "js", "jse", "wsf", "wsh", "hta", "sh", "bash", "command", "py", "pyw", "reg", "msc", "chm", "inf"]);
const shortcutExtensions = new Set(["lnk", "url", "scf", "appref-ms", "library-ms", "search-ms", "searchconnector-ms", "settingcontent-ms"]);
const programExtensions = new Set([
  "exe", "scr", "com", "pif", "cpl", "msi", "msix", "msixbundle", "appx", "dll", "sys", "xll", "jar", "apk", "xapk", "iso", "img", "vhd", "vhdx",
  "dmg", "pkg", "app", ...scriptExtensions, ...shortcutExtensions,
]);
const archiveExtensions = new Set(["zip", "rar", "7z", "gz", "tgz", "tar", "bz2", "xz", "cab", "iso", "img"]);
const directionControls = /[\u202a-\u202e\u2066-\u2069\u200e\u200f]/g;
const paddedName = /[\s\u00a0\u2000-\u200b\u3000]{3,}\.[^.\s]{1,12}$/u;

const pdfNames: Record<string, FileFinding> = {
  javascript: "pdf_javascript",
  js: "pdf_javascript",
  launch: "pdf_launch",
  embeddedfile: "pdf_embedded_file",
  embeddedfiles: "pdf_embedded_file",
  openaction: "pdf_auto_action",
  aa: "pdf_auto_action",
};

const downloadPatterns = [
  /invoke-expression/,
  /\biex\b/,
  /downloadstring/,
  /downloadfile/,
  /invoke-webrequest/,
  /\biwr\b/,
  /start-bitstransfer/,
  /certutil[^\n]{0,40}urlcache/,
  /bitsadmin[^\n]{0,40}\/transfer/,
  /mshta[^\n]{0,10}https?:/,
  /(?:curl|wget)[^\n|]{0,200}\|\s*(?:ba)?sh/,
  /frombase64string/,
  /-e(?:nc(?:odedcommand)?)?\s+[a-z0-9+/=]{40,}/,
  /wscript\.shell/,
  /activexobject/,
  /regsvr32[^\n]{0,40}\/i:\s*https?:/,
];

const shortcutCommands = ["powershell", "pwsh", "cmd.exe", "cmd /c", "mshta", "rundll32", "wscript", "cscript", "regsvr32", "certutil", "bitsadmin", "curl ", "conhost", "msiexec"];
const minecraftFiles = ["fabric.mod.json", "quilt.mod.json", "mcmod.info", "meta-inf/mods.toml", "meta-inf/neoforge.mods.toml", "plugin.yml", "paper-plugin.yml", "bungee.yml"];

export function blobSource(blob: Blob): ByteSource {
  return {
    size: blob.size,
    read: async (offset, length) => new Uint8Array(await blob.slice(offset, offset + length).arrayBuffer()),
  };
}

function matches(bytes: Uint8Array, signature: number[], offset = 0): boolean {
  return bytes.length >= offset + signature.length && signature.every((byte, index) => bytes[offset + index] === byte);
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  return bytes.length < offset + length ? "" : String.fromCharCode(...bytes.subarray(offset, offset + length));
}

const u16le = (bytes: Uint8Array, offset: number) => bytes[offset]! | (bytes[offset + 1]! << 8);
const u32le = (bytes: Uint8Array, offset: number) => (bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16) | (bytes[offset + 3]! << 24)) >>> 0;
const u64le = (bytes: Uint8Array, offset: number) => u32le(bytes, offset) + u32le(bytes, offset + 4) * 2 ** 32;

function latin1(bytes: Uint8Array): string {
  return new TextDecoder("latin1").decode(bytes);
}

function extensionOf(name: string): string | null {
  const clean = name.replace(directionControls, "").trim().toLowerCase();
  const dot = clean.lastIndexOf(".");
  return dot > 0 && dot < clean.length - 1 ? clean.slice(dot + 1) : null;
}

function nameFindings(name: string, extension: string | null): FileFinding[] {
  const findings: FileFinding[] = [];
  if (name.replace(directionControls, "") !== name) {
    findings.push("direction_trick");
  }
  const parts = name.replace(directionControls, "").trim().toLowerCase().split(".");
  const decoy = parts.length >= 3 ? parts[parts.length - 2]!.trim() : "";
  if (extension && programExtensions.has(extension) && decoyExtensions.has(decoy)) {
    findings.push("double_extension");
  }
  if (paddedName.test(name)) {
    findings.push("padded_name");
  }
  return findings;
}

function peInfo(head: Uint8Array): { library: boolean; signed: boolean } | null {
  if (!matches(head, [0x4d, 0x5a]) || head.length < 64) {
    return null;
  }
  const pe = u32le(head, 0x3c);
  if (pe + 24 > head.length || ascii(head, pe, 4) !== "PE\0\0") {
    return null;
  }
  const library = (u16le(head, pe + 22) & 0x2000) !== 0;
  const optional = pe + 24;
  const magic = optional + 2 <= head.length ? u16le(head, optional) : 0;
  const directories = magic === 0x20b ? optional + 112 : magic === 0x10b ? optional + 96 : -1;
  if (directories < 0 || directories + 40 > head.length) {
    return { library, signed: false };
  }
  const directoryCount = u32le(head, directories - 4);
  return { library, signed: directoryCount > 4 && u32le(head, directories + 36) > 0 };
}

interface ZipEntry {
  name: string;
  encrypted: boolean;
}

async function zipEntries(source: ByteSource): Promise<ZipEntry[] | null> {
  const start = Math.max(0, source.size - tailBytes);
  const tail = await source.read(start, source.size - start);
  let eocd = -1;
  for (let index = tail.length - 22; index >= 0; index -= 1) {
    if (u32le(tail, index) === 0x06054b50) {
      eocd = index;
      break;
    }
  }
  if (eocd < 0) {
    return null;
  }
  let total = u16le(tail, eocd + 10);
  let directorySize = u32le(tail, eocd + 12);
  let directoryOffset = u32le(tail, eocd + 16);
  if ((total === 0xffff || directorySize === 0xffffffff || directoryOffset === 0xffffffff) && eocd >= 20 && u32le(tail, eocd - 20) === 0x07064b50) {
    const recordOffset = u64le(tail, eocd - 12);
    const record = await source.read(recordOffset, 56);
    if (record.length < 56 || u32le(record, 0) !== 0x06064b50) {
      return null;
    }
    total = u64le(record, 32);
    directorySize = u64le(record, 40);
    directoryOffset = u64le(record, 48);
  }
  if (directoryOffset >= source.size) {
    return null;
  }
  const directory = await source.read(directoryOffset, Math.min(directorySize, maxCentralDirectory));
  const entries: ZipEntry[] = [];
  let offset = 0;
  while (offset + 46 <= directory.length && entries.length < Math.min(total, maxEntries)) {
    if (u32le(directory, offset) !== 0x02014b50) {
      return entries.length > 0 ? entries : null;
    }
    const flags = u16le(directory, offset + 8);
    const method = u16le(directory, offset + 10);
    const nameLength = u16le(directory, offset + 28);
    const extraLength = u16le(directory, offset + 30);
    const commentLength = u16le(directory, offset + 32);
    const nameBytes = directory.subarray(offset + 46, offset + 46 + nameLength);
    const name = (flags & 0x800) !== 0 ? new TextDecoder("utf-8").decode(nameBytes) : latin1(nameBytes);
    entries.push({ name: name.toLowerCase(), encrypted: (flags & 1) !== 0 || method === 99 });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function zipFindings(entries: ZipEntry[], extension: string | null): { kind: FileKind; findings: FileFinding[]; inside: string[] } {
  const names = entries.map((entry) => entry.name);
  const has = (name: string) => names.includes(name);
  if (has("[content_types].xml")) {
    const macros = names.some((name) => name.endsWith("vbaproject.bin")) || ["docm", "dotm", "xlsm", "xltm", "xlam", "pptm", "potm", "ppam"].includes(extension ?? "");
    return { kind: "office_document", findings: macros ? ["office_macros"] : [], inside: [] };
  }
  if (has("androidmanifest.xml") && names.some((name) => name.endsWith(".dex"))) {
    return { kind: "android_app", findings: [], inside: [] };
  }
  if (has("meta-inf/manifest.mf") || names.some((name) => name.endsWith(".class"))) {
    return { kind: "java_archive", findings: minecraftFiles.some(has) ? ["minecraft_mod"] : [], inside: [] };
  }
  const findings = new Set<FileFinding>();
  const inside: string[] = [];
  for (const entry of entries) {
    const base = entry.name.split("/").pop() ?? "";
    const entryExtension = extensionOf(base);
    if (entry.encrypted) {
      findings.add("archive_encrypted");
    }
    if (entryExtension && programExtensions.has(entryExtension) && !archiveExtensions.has(entryExtension)) {
      findings.add("archive_has_program");
      inside.push(base);
    }
    if (nameFindings(base, entryExtension).includes("double_extension")) {
      findings.add("archive_double_extension");
    }
    if (entryExtension && archiveExtensions.has(entryExtension)) {
      findings.add("archive_nested");
    }
  }
  return { kind: "archive", findings: [...findings], inside: inside.slice(0, 5) };
}

function textKind(text: string, extension: string | null): FileKind | null {
  const start = text.replace(/^\ufeff/, "").trimStart().slice(0, 4096).toLowerCase();
  if (start.includes("<hta:application")) {
    return "script";
  }
  if (/^<(?:!doctype html|html|head|body|script|meta|iframe|form)\b/.test(start)) {
    return "web_page";
  }
  if (/^(?:<\?xml[^>]*>\s*)?(?:<!--(?:[^-]|-(?!->))*-->\s*)*(?:<!doctype svg[^>]*>\s*)?<svg\b/.test(start)) {
    return "svg_image";
  }
  if (extension && ["html", "htm", "xhtml", "shtml", "mht", "mhtml", "xht"].includes(extension)) {
    return "web_page";
  }
  if (extension === "svg") {
    return "svg_image";
  }
  return null;
}

function pdfFindings(text: string): FileFinding[] {
  const found = new Set<FileFinding>();
  for (const match of text.matchAll(/\/([A-Za-z0-9#]{2,40})/g)) {
    const name = match[1]!.replace(/#([0-9a-fA-F]{2})/g, (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16))).toLowerCase();
    const finding = pdfNames[name];
    if (finding) {
      found.add(finding);
    }
  }
  return [...found];
}

function markupFindings(kind: FileKind, text: string): FileFinding[] {
  const lower = text.toLowerCase();
  const findings: FileFinding[] = [];
  if (kind === "web_page") {
    if (/<form[\s>]/.test(lower) && /type\s*=\s*["']?password/.test(lower)) {
      findings.push("html_password_form");
    }
    if ((/atob\s*\(/.test(lower) && /(?:new\s+blob\s*\(|mssaveoropenblob|createobjecturl)/.test(lower)) || (/\sdownload\s*=/.test(lower) && /data:application\/(?:octet-stream|x-msdownload|zip|x-zip)/.test(lower))) {
      findings.push("html_smuggling");
    }
  }
  if (kind === "svg_image" && (/<script[\s>]/.test(lower) || /\son[a-z]+\s*=/.test(lower) || /javascript:/.test(lower) || (/<foreignobject[\s>]/.test(lower) && /<(?:iframe|form|input)[\s>]/.test(lower)))) {
    findings.push("svg_script");
  }
  return findings;
}

function scriptFindings(text: string): FileFinding[] {
  const lower = text.toLowerCase();
  return downloadPatterns.some((pattern) => pattern.test(lower)) ? ["script_downloads"] : [];
}

function shortcutFindings(bytes: Uint8Array): FileFinding[] {
  const text = `${latin1(bytes)}\n${new TextDecoder("utf-16le").decode(bytes)}`.toLowerCase();
  return shortcutCommands.some((command) => text.includes(command)) ? ["shortcut_runs_command"] : [];
}

const vbaProjectMarker = [..."_VBA_PROJECT"].map((char) => `${char}\0`).join("");

async function fingerprints(source: Blob): Promise<{ sha256: string; sha1: string }> {
  const bytes = await source.arrayBuffer();
  const hex = (digest: ArrayBuffer) => [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  const [sha256, sha1] = await Promise.all([crypto.subtle.digest("SHA-256", bytes), crypto.subtle.digest("SHA-1", bytes)]);
  return { sha256: hex(sha256), sha1: hex(sha1) };
}

export async function inspectSource(name: string, source: ByteSource): Promise<Omit<FileInspection, "sha256">> {
  const extension = extensionOf(name);
  const findings = new Set<FileFinding>(nameFindings(name, extension));
  const head = await source.read(0, Math.min(source.size, headBytes));
  const scan = async () => (head.length >= source.size ? head : await source.read(0, Math.min(source.size, maxScanBytes)));
  let kind: FileKind = "other";
  let inside: string[] = [];
  const pe = peInfo(head);
  if (pe) {
    kind = pe.library ? "windows_library" : "windows_program";
    if (pe.signed) {
      findings.add("program_signed");
    }
  } else if (matches(head, [0x4c, 0x00, 0x00, 0x00, 0x01, 0x14, 0x02, 0x00])) {
    kind = "windows_shortcut";
    for (const finding of shortcutFindings(await scan())) {
      findings.add(finding);
    }
  } else if (matches(head, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) {
    kind = extension === "msi" || extension === "msp" ? "windows_installer" : "office_document";
    if (kind === "office_document" && latin1(await scan()).includes(vbaProjectMarker)) {
      findings.add("office_macros");
    }
  } else if (matches(head, [0x7f, 0x45, 0x4c, 0x46])) {
    kind = "linux_program";
  } else if ([[0xfe, 0xed, 0xfa, 0xce], [0xfe, 0xed, 0xfa, 0xcf], [0xce, 0xfa, 0xed, 0xfe], [0xcf, 0xfa, 0xed, 0xfe], [0xca, 0xfe, 0xba, 0xbe]].some((signature) => matches(head, signature))) {
    kind = extension === "class" ? "java_archive" : "macos_program";
  } else if (matches(head, [0x50, 0x4b, 0x03, 0x04]) || matches(head, [0x50, 0x4b, 0x05, 0x06])) {
    const entries = await zipEntries(source);
    if (entries) {
      const zip = zipFindings(entries, extension);
      kind = zip.kind;
      inside = zip.inside;
      for (const finding of zip.findings) {
        findings.add(finding);
      }
    } else {
      kind = "archive";
      findings.add("archive_unreadable");
    }
  } else if (
    ascii(head, 0, 6) === "Rar!\x1a\x07" ||
    matches(head, [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]) ||
    matches(head, [0x1f, 0x8b]) ||
    matches(head, [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00]) ||
    ascii(head, 0, 3) === "BZh" ||
    ascii(head, 0, 4) === "MSCF" ||
    ascii(head, 257, 5) === "ustar"
  ) {
    kind = "archive";
    findings.add("archive_unreadable");
  } else if (["CD001", "BEA01", "NSR02", "NSR03"].includes(ascii(head, 0x8001, 5)) || ascii(head, 0, 8) === "vhdxfile" || ascii(head, 0, 8) === "conectix") {
    kind = "disk_image";
  } else if (latin1(head.subarray(0, 1024)).includes("%PDF-")) {
    kind = "pdf";
    for (const finding of pdfFindings(latin1(await scan()))) {
      findings.add(finding);
    }
  } else if (ascii(head, 0, 5) === "{\\rtf") {
    kind = "office_document";
  } else if (
    matches(head, [0x89, 0x50, 0x4e, 0x47]) ||
    matches(head, [0xff, 0xd8, 0xff]) ||
    ascii(head, 0, 4) === "GIF8" ||
    (ascii(head, 0, 4) === "RIFF" && ascii(head, 8, 4) === "WEBP") ||
    ascii(head, 0, 2) === "BM" ||
    matches(head, [0x00, 0x00, 0x01, 0x00])
  ) {
    kind = "image";
  } else {
    const text = latin1(head);
    const markup = textKind(text, extension);
    if (markup) {
      kind = markup;
      const body = latin1(await scan());
      for (const finding of [...markupFindings(markup, body), ...(markup === "script" ? scriptFindings(body) : [])]) {
        findings.add(finding);
      }
    } else if (extension && scriptExtensions.has(extension)) {
      kind = "script";
      for (const finding of scriptFindings(latin1(await scan()))) {
        findings.add(finding);
      }
    } else if (extension && shortcutExtensions.has(extension)) {
      kind = "windows_shortcut";
      for (const finding of shortcutFindings(await scan())) {
        findings.add(finding);
      }
    } else if (extension === "dmg" && source.size >= 512 && ascii(await source.read(source.size - 512, 4), 0, 4) === "koly") {
      kind = "macos_program";
    } else if (extension && ["iso", "img", "vhd", "vhdx"].includes(extension)) {
      kind = "disk_image";
    }
  }
  const disguised = ["windows_program", "windows_library", "windows_installer", "windows_shortcut", "script", "android_app", "java_archive", "macos_program", "linux_program", "disk_image"].includes(kind);
  if (disguised && extension && decoyExtensions.has(extension)) {
    findings.add("extension_mismatch");
  }
  return {
    size: source.size,
    kind,
    ...(extension && fileExtensionPattern.test(extension) ? { extension } : {}),
    findings: [...findings],
    insideArchive: inside,
  };
}

export async function inspectFile(file: File): Promise<FileInspection> {
  const inspection = await inspectSource(file.name, blobSource(file));
  if (file.size > maxHashBytes) {
    return { ...inspection, findings: [...inspection.findings, "too_large_to_hash"] };
  }
  return { ...inspection, ...(await fingerprints(file)) };
}
