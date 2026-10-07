import { fileExtensionPattern, maxHashBytes, maxPackJars, sha1Pattern, type FileCheckRequest, type FileFinding, type FileKind } from "../../shared/file-check";
import { addClass, addEntryName, classText, jarFindings, modIdFrom, modInfoFiles, newJarScan, parsedJson, type JarScan } from "./jar-inspect";

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
const maxEntries = 20_000;

const decoyExtensions = new Set([
  "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt", "rtf", "csv", "jpg", "jpeg", "png", "gif", "bmp", "webp", "heic",
  "mp4", "mov", "avi", "mkv", "mp3", "wav", "zip", "rar", "html", "htm",
]);
const scriptExtensions = new Set(["bat", "cmd", "ps1", "psm1", "psd1", "vbs", "vbe", "js", "jse", "wsf", "wsh", "hta", "sh", "bash", "command", "py", "pyw", "reg", "msc", "chm", "inf"]);
const shortcutExtensions = new Set(["lnk", "url", "scf", "appref-ms", "library-ms", "search-ms", "searchconnector-ms", "settingcontent-ms"]);
const programExtensions = new Set([
  "exe", "scr", "com", "pif", "cpl", "msi", "msix", "msixbundle", "appx", "appinstaller", "dll", "sys", "xll", "jar", "apk", "xapk", "iso", "img", "vhd", "vhdx",
  "dmg", "pkg", "app", "crx", "xpi", ...scriptExtensions, ...shortcutExtensions,
]);
const extensionPackages = new Set(["crx", "xpi"]);
const maxManifestBytes = 256 * 1024;
const allSitesPattern = /^(?:<all_urls>|(?:\*|https?|wss?):\/\/\*\/.*)$/;
const powerfulPermissions = new Set(["debugger", "nativemessaging", "management", "proxy", "clipboardread"]);
const pyinstallerCookie = "MEI\x0c\x0b\x0a\x0b\x0e";
const remoteTarget = /(?:^|\n)\s*(?:url|iconfile)\s*=\s*(?:file:|\\\\|search-ms:|search:)|\\\\[a-z0-9._-]+(?:@ssl)?(?:@\d{1,5})?\\|davwwwroot|crumb=location:|<url>\s*(?:https?:|\\\\)/;
const registryKeys = [
  /\\currentversion\\run(?:once|services|servicesonce)?\]/,
  /\\currentversion\\winlogon\]/,
  /\\currentversion\\policies\\system\]/,
  /\\image file execution options\\/,
  /\\windows defender\b/,
  /\\shell\\open\\command\]/,
  /\\currentcontrolset\\services\\/,
];
const robloxBackdoor = [/\brequire\s*\(\s*\d{5,}\s*\)/, /\bloadstring\s*\(/, /\bgetfenv\s*\(/];
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
const maxJarBytes = 64 * 1024 * 1024;
const maxNestedJarBytes = 64 * 1024 * 1024;
const maxClassBytes = 2 * 1024 * 1024;
const maxJarClasses = 12_000;
const maxJarInflated = 160 * 1024 * 1024;
const maxIndexBytes = 4 * 1024 * 1024;
const maxIndexFiles = 5000;
const packHosts = new Set(["cdn.modrinth.com", "github.com", "raw.githubusercontent.com", "gitlab.com"]);
const packPrograms = new Set(["exe", "scr", "com", "pif", "cpl", "msi", "msix", "appx", "hta", "lnk", "url", "vbs", "vbe", "ps1", "wsf", "jse", "reg"]);

interface JarBudget {
  classes: number;
  bytes: number;
}

export function blobSource(blob: Blob): ByteSource {
  return {
    size: blob.size,
    read: async (offset, length) => new Uint8Array(await blob.slice(offset, offset + length).arrayBuffer()),
  };
}

function memorySource(bytes: Uint8Array): ByteSource {
  return { size: bytes.length, read: async (offset, length) => bytes.subarray(offset, offset + length) };
}

function hex(digest: ArrayBuffer): string {
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
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
  method: number;
  compressedSize: number;
  localOffset: number;
}

async function zipEntries(source: ByteSource, base = 0): Promise<ZipEntry[] | null> {
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
    const recordOffset = base + u64le(tail, eocd - 12);
    const record = await source.read(recordOffset, 56);
    if (record.length < 56 || u32le(record, 0) !== 0x06064b50) {
      return null;
    }
    total = u64le(record, 32);
    directorySize = u64le(record, 40);
    directoryOffset = u64le(record, 48);
  }
  if (base + directoryOffset >= source.size) {
    return null;
  }
  const directory = await source.read(base + directoryOffset, Math.min(directorySize, maxCentralDirectory));
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
    entries.push({
      name: name.toLowerCase(),
      encrypted: (flags & 1) !== 0 || method === 99,
      method,
      compressedSize: u32le(directory, offset + 20),
      localOffset: u32le(directory, offset + 42),
    });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

async function inflate(data: Uint8Array<ArrayBuffer>, maxBytes: number): Promise<Uint8Array | null> {
  if (typeof DecompressionStream === "undefined") {
    return null;
  }
  try {
    const reader = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw")).getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return null;
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return bytes;
  } catch {
    return null;
  }
}

async function readZipBytes(source: ByteSource, entry: ZipEntry, base: number, maxBytes: number): Promise<Uint8Array | null> {
  if (entry.encrypted || entry.compressedSize > maxBytes || (entry.method !== 0 && entry.method !== 8)) {
    return null;
  }
  const header = await source.read(base + entry.localOffset, 30);
  if (header.length < 30 || u32le(header, 0) !== 0x04034b50) {
    return null;
  }
  const data = await source.read(base + entry.localOffset + 30 + u16le(header, 26) + u16le(header, 28), entry.compressedSize);
  if (data.length < entry.compressedSize) {
    return null;
  }
  return entry.method === 0 ? data : inflate(data.slice(), maxBytes);
}

async function readZipText(source: ByteSource, entry: ZipEntry, base: number): Promise<string | null> {
  const bytes = await readZipBytes(source, entry, base, maxManifestBytes);
  return bytes ? new TextDecoder("utf-8").decode(bytes) : null;
}

async function scanJar(source: ByteSource, entries: ZipEntry[], scan: JarScan, budget: JarBudget, nested: boolean): Promise<void> {
  for (const entry of entries) {
    addEntryName(scan, extensionOf(entry.name.split("/").pop() ?? ""));
    if (entry.name.endsWith(".class")) {
      if (budget.classes >= maxJarClasses || budget.bytes >= maxJarInflated) {
        scan.partial = true;
        continue;
      }
      const bytes = await readZipBytes(source, entry, 0, maxClassBytes);
      const text = bytes ? classText(bytes) : null;
      if (!bytes || !text) {
        scan.partial = true;
        continue;
      }
      budget.classes += 1;
      budget.bytes += bytes.length;
      addClass(scan, text);
    } else if (nested && entry.name.endsWith(".jar")) {
      const bytes = budget.bytes < maxJarInflated ? await readZipBytes(source, entry, 0, maxNestedJarBytes) : null;
      const inner = bytes ? memorySource(bytes) : null;
      const innerEntries = inner ? await zipEntries(inner) : null;
      if (!bytes || !inner || !innerEntries) {
        scan.partial = true;
        continue;
      }
      budget.bytes += bytes.length;
      await scanJar(inner, innerEntries, scan, budget, false);
    }
  }
}

async function modIdOf(source: ByteSource, entries: ZipEntry[]): Promise<string | undefined> {
  for (const file of modInfoFiles) {
    const entry = entries.find((candidate) => candidate.name === file);
    const text = entry ? await readZipText(source, entry, 0) : null;
    const id = text ? modIdFrom(file, text) : null;
    if (id) {
      return id;
    }
  }
  return undefined;
}

async function forgeManifest(source: ByteSource, entries: ZipEntry[]): Promise<boolean> {
  const entry = entries.find((candidate) => candidate.name === "meta-inf/manifest.mf");
  const text = entry ? await readZipText(source, entry, 0) : null;
  return text !== null && /^FMLModType:/m.test(text);
}

async function jarDetails(source: ByteSource, entries: ZipEntry[]): Promise<{ findings: FileFinding[]; modId: string | undefined }> {
  const scan = newJarScan();
  const memory = source.size > maxJarBytes ? source : memorySource(await source.read(0, source.size));
  if (memory === source) {
    scan.partial = true;
  } else {
    await scanJar(memory, entries, scan, { classes: 0, bytes: 0 }, true);
  }
  const findings = jarFindings(scan);
  return { findings: (await forgeManifest(memory, entries)) ? ["minecraft_mod", ...findings] : findings, modId: await modIdOf(memory, entries) };
}

function indexBreaksRules(text: string, packJars: Set<string>): boolean {
  const index = parsedJson(text) as { files?: unknown } | null;
  const files = Array.isArray(index?.files) ? index.files.slice(0, maxIndexFiles) : [];
  let breaks = false;
  for (const file of files as { path?: unknown; downloads?: unknown; hashes?: { sha1?: unknown } }[]) {
    const path = typeof file?.path === "string" ? file.path : "";
    if (path.includes("..") || path.startsWith("/") || path.includes("\\") || /^[a-z]:/i.test(path)) {
      breaks = true;
    }
    const downloads = Array.isArray(file?.downloads) ? file.downloads.filter((link): link is string => typeof link === "string") : [];
    let fromModrinth = downloads.length > 0;
    for (const link of downloads) {
      let url: URL | null = null;
      try {
        url = new URL(link);
      } catch {
        url = null;
      }
      if (!url || url.protocol !== "https:" || !packHosts.has(url.hostname)) {
        breaks = true;
      }
      if (url?.hostname !== "cdn.modrinth.com") {
        fromModrinth = false;
      }
    }
    const sha1 = typeof file?.hashes?.sha1 === "string" ? file.hashes.sha1.toLowerCase() : "";
    if (!fromModrinth && path.toLowerCase().endsWith(".jar") && sha1Pattern.test(sha1)) {
      packJars.add(sha1);
    }
  }
  return breaks;
}

async function modpackOf(source: ByteSource, entries: ZipEntry[]): Promise<{ findings: FileFinding[]; inside: string[]; packJars: string[] } | null> {
  const packJars = new Set<string>();
  const findings = new Set<FileFinding>();
  const scan = newJarScan();
  const index = entries.find((entry) => entry.name === "modrinth.index.json");
  if (index) {
    const bytes = await readZipBytes(source, index, 0, maxIndexBytes);
    if (!bytes) {
      scan.partial = true;
    } else if (indexBreaksRules(new TextDecoder("utf-8").decode(bytes), packJars)) {
      findings.add("modpack_breaks_rules");
    }
  } else {
    const manifest = entries.find((entry) => entry.name === "manifest.json");
    const text = manifest ? await readZipText(source, manifest, 0) : null;
    if ((parsedJson(text ?? "") as { manifestType?: unknown } | null)?.manifestType !== "minecraftModpack") {
      return null;
    }
  }
  const inside: string[] = [];
  const budget: JarBudget = { classes: 0, bytes: 0 };
  let carried = 0;
  for (const entry of entries) {
    const base = entry.name.split("/").pop() ?? "";
    const extension = extensionOf(base);
    if (entry.encrypted) {
      findings.add("archive_encrypted");
    }
    if (nameFindings(base, extension).includes("double_extension")) {
      findings.add("archive_double_extension");
    }
    if (extension === "jar") {
      findings.add("modpack_carries_mods");
      inside.push(base);
      const bytes = carried < maxPackJars && budget.bytes < maxJarInflated ? await readZipBytes(source, entry, 0, maxNestedJarBytes) : null;
      const jar = bytes ? memorySource(bytes) : null;
      const jarEntries = jar ? await zipEntries(jar) : null;
      if (!bytes || !jar || !jarEntries) {
        scan.partial = true;
        continue;
      }
      carried += 1;
      budget.bytes += bytes.length;
      packJars.add(hex(await crypto.subtle.digest("SHA-1", bytes.slice())));
      await scanJar(jar, jarEntries, scan, budget, true);
    } else if (extension && packPrograms.has(extension)) {
      findings.add("archive_has_program");
      inside.push(base);
    }
  }
  for (const finding of jarFindings(scan)) {
    findings.add(finding);
  }
  return { findings: [...findings], inside: inside.slice(0, 5), packJars: [...packJars].slice(0, maxPackJars) };
}

function manifestFindings(text: string): FileFinding[] | null {
  let manifest: unknown;
  try {
    manifest = JSON.parse(text.replace(/^\ufeff/, ""));
  } catch {
    return null;
  }
  if (typeof manifest !== "object" || manifest === null || typeof (manifest as { manifest_version?: unknown }).manifest_version !== "number") {
    return null;
  }
  const record = manifest as Record<string, unknown>;
  const strings = (value: unknown) => (Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").map((item) => item.toLowerCase()) : []);
  const scripts = Array.isArray(record.content_scripts) ? record.content_scripts.flatMap((script: unknown) => strings((script as { matches?: unknown } | null)?.matches)) : [];
  const permissions = [...strings(record.permissions), ...strings(record.optional_permissions), ...strings(record.host_permissions), ...strings(record.optional_host_permissions), ...scripts];
  const findings: FileFinding[] = [];
  if (permissions.some((permission) => allSitesPattern.test(permission))) {
    findings.push("extension_all_sites");
  }
  if (permissions.includes("cookies")) {
    findings.push("extension_reads_cookies");
  }
  if (permissions.some((permission) => powerfulPermissions.has(permission))) {
    findings.push("extension_powerful");
  }
  return findings;
}

async function extensionManifest(source: ByteSource, entries: ZipEntry[], base: number): Promise<FileFinding[] | null> {
  const entry = entries.find((candidate) => candidate.name === "manifest.json");
  const text = entry ? await readZipText(source, entry, base) : null;
  return text === null ? null : manifestFindings(text);
}

function zipFindings(entries: ZipEntry[], extension: string | null, skipExtension = false): { kind: FileKind; findings: FileFinding[]; inside: string[] } {
  const names = entries.map((entry) => entry.name);
  const has = (name: string) => names.includes(name);
  if (has("[content_types].xml") && !has("appxmanifest.xml") && !has("appxmetadata/appxbundlemanifest.xml")) {
    const macros = names.some((name) => name.endsWith("vbaproject.bin")) || ["docm", "dotm", "xlsm", "xltm", "xlam", "pptm", "potm", "ppam"].includes(extension ?? "");
    return { kind: "office_document", findings: macros ? ["office_macros"] : [], inside: [] };
  }
  if (has("appxmanifest.xml") || has("appxmetadata/appxbundlemanifest.xml")) {
    return { kind: "windows_installer", findings: [], inside: [] };
  }
  if (has("androidmanifest.xml") && names.some((name) => name.endsWith(".dex"))) {
    return { kind: "android_app", findings: [], inside: [] };
  }
  if (!skipExtension && has("manifest.json") && !names.some((name) => name.endsWith(".class"))) {
    return { kind: "browser_extension", findings: [], inside: [] };
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

function decodedText(bytes: Uint8Array): string {
  return bytes[0] === 0xff && bytes[1] === 0xfe ? new TextDecoder("utf-16le").decode(bytes) : latin1(bytes);
}

function textKind(text: string, extension: string | null): FileKind | null {
  const start = text.replace(/^\ufeff/, "").trimStart().slice(0, 4096).toLowerCase();
  if (start.includes("<hta:application") || start.startsWith("windows registry editor version") || start.startsWith("regedit4")) {
    return "script";
  }
  if (start.startsWith("[internetshortcut]")) {
    return "windows_shortcut";
  }
  if (/^(?:<\?xml[^>]*>\s*)?<roblox[\s>]/.test(start)) {
    return "roblox_model";
  }
  if (/^(?:<\?xml[^>]*>\s*)?<appinstaller[\s>]/.test(start)) {
    return "windows_installer";
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
  const findings: FileFinding[] = [];
  if (shortcutCommands.some((command) => text.includes(command))) {
    findings.push("shortcut_runs_command");
  }
  if (remoteTarget.test(text)) {
    findings.push("shortcut_remote_file");
  }
  return findings;
}

function registryFindings(text: string): FileFinding[] {
  const lower = text.toLowerCase();
  return registryKeys.some((key) => key.test(lower)) ? ["registry_startup"] : [];
}

function robloxFindings(text: string): FileFinding[] {
  return robloxBackdoor.some((pattern) => pattern.test(text)) ? ["roblox_backdoor"] : [];
}

const vbaProjectMarker = [..."_VBA_PROJECT"].map((char) => `${char}\0`).join("");

async function fingerprints(source: Blob): Promise<{ sha256: string; sha1: string }> {
  const bytes = await source.arrayBuffer();
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
  let modId: string | undefined;
  let packJars: string[] = [];
  const pe = peInfo(head);
  if (pe) {
    kind = pe.library ? "windows_library" : "windows_program";
    if (pe.signed) {
      findings.add("program_signed");
    }
    const tailStart = Math.max(0, source.size - tailBytes);
    if (latin1(await source.read(tailStart, source.size - tailStart)).includes(pyinstallerCookie)) {
      findings.add("python_bundle");
    }
  } else if (ascii(head, 0, 4) === "Cr24") {
    kind = "browser_extension";
    const version = u32le(head, 4);
    const base = version === 3 ? 12 + u32le(head, 8) : version === 2 ? 16 + u32le(head, 8) + u32le(head, 12) : -1;
    const entries = base > 0 && base < source.size ? await zipEntries(source, base) : null;
    for (const finding of (entries ? await extensionManifest(source, entries, base) : null) ?? []) {
      findings.add(finding);
    }
  } else if (ascii(head, 0, 8) === "<roblox!") {
    kind = "roblox_model";
    for (const finding of robloxFindings(latin1(await scan()))) {
      findings.add(finding);
    }
  } else if (ascii(head, 0, 4) === "ITSF") {
    kind = "script";
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
    const text = kind === "java_archive" && source.size <= maxClassBytes ? classText(await source.read(0, source.size)) : null;
    if (text) {
      const jarScan = newJarScan();
      addClass(jarScan, text);
      for (const finding of jarFindings(jarScan)) {
        findings.add(finding);
      }
    }
  } else if (matches(head, [0x50, 0x4b, 0x03, 0x04]) || matches(head, [0x50, 0x4b, 0x05, 0x06])) {
    const entries = await zipEntries(source);
    const pack = entries ? await modpackOf(source, entries) : null;
    if (pack) {
      kind = "minecraft_modpack";
      inside = pack.inside;
      packJars = pack.packJars;
      for (const finding of pack.findings) {
        findings.add(finding);
      }
    } else if (entries) {
      let zip = zipFindings(entries, extension);
      if (zip.kind === "browser_extension") {
        const permissions = await extensionManifest(source, entries, 0);
        if (permissions) {
          zip = { ...zip, findings: permissions };
        } else if (!extensionPackages.has(extension ?? "")) {
          zip = zipFindings(entries, extension, true);
        }
      }
      kind = zip.kind;
      inside = zip.inside;
      for (const finding of zip.findings) {
        findings.add(finding);
      }
      if (zip.kind === "java_archive") {
        const details = await jarDetails(source, entries);
        for (const finding of details.findings) {
          findings.add(finding);
        }
        modId = findings.has("minecraft_mod") ? details.modId : undefined;
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
    const text = decodedText(head);
    const markup = textKind(text, extension);
    if (markup) {
      kind = markup;
      const raw = await scan();
      const body = decodedText(raw);
      const extra =
        markup === "script"
          ? [...scriptFindings(body), ...registryFindings(body)]
          : markup === "windows_shortcut"
            ? shortcutFindings(raw)
            : markup === "roblox_model"
              ? robloxFindings(body)
              : [];
      for (const finding of [...markupFindings(markup, body), ...extra]) {
        findings.add(finding);
      }
    } else if (extension && scriptExtensions.has(extension)) {
      kind = "script";
      const body = decodedText(await scan());
      for (const finding of [...scriptFindings(body), ...(extension === "reg" ? registryFindings(body) : [])]) {
        findings.add(finding);
      }
    } else if (extension === "appinstaller") {
      kind = "windows_installer";
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
  const disguised =
    ["windows_program", "windows_library", "windows_installer", "windows_shortcut", "script", "android_app", "java_archive", "macos_program", "linux_program", "disk_image", "browser_extension"].includes(kind) &&
    !(kind === "browser_extension" && extension === "zip");
  if (disguised && extension && decoyExtensions.has(extension)) {
    findings.add("extension_mismatch");
  }
  return {
    size: source.size,
    kind,
    ...(extension && fileExtensionPattern.test(extension) ? { extension } : {}),
    findings: [...findings],
    ...(modId ? { modId } : {}),
    ...(packJars.length > 0 ? { packJars } : {}),
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
