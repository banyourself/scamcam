import { describe, expect, it } from "vitest";
import { inspectSource, type ByteSource } from "../../src/client/lib/file-inspect";
import { classText } from "../../src/client/lib/jar-inspect";

const encoder = new TextEncoder();
const le16 = (value: number) => [value & 255, (value >>> 8) & 255];
const le32 = (value: number) => [value & 255, (value >>> 8) & 255, (value >>> 16) & 255, (value >>> 24) & 255];
const be16 = (value: number) => [(value >>> 8) & 255, value & 255];
const be32 = (value: number) => [(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255];

function concat(...parts: (Uint8Array | number[])[]): Uint8Array<ArrayBuffer> {
  const arrays = parts.map((part) => Uint8Array.from(part));
  const result = new Uint8Array(arrays.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of arrays) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function source(bytes: Uint8Array): ByteSource {
  return { size: bytes.length, read: async (offset, length) => bytes.slice(offset, offset + length) };
}

async function deflateRaw(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function zip(files: { name: string; content: string | Uint8Array; store?: boolean }[]): Promise<Uint8Array<ArrayBuffer>> {
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const file of files) {
    const name = encoder.encode(file.name);
    const raw = typeof file.content === "string" ? encoder.encode(file.content) : Uint8Array.from(file.content);
    const data = file.store ? raw : await deflateRaw(raw);
    const method = file.store ? 0 : 8;
    const local = concat([0x50, 0x4b, 0x03, 0x04], le16(20), le16(0x800), le16(method), le16(0), le16(0), le32(0), le32(data.length), le32(raw.length), le16(name.length), le16(0), name, data);
    centrals.push(
      concat([0x50, 0x4b, 0x01, 0x02], le16(20), le16(20), le16(0x800), le16(method), le16(0), le16(0), le32(0), le32(data.length), le32(raw.length), le16(name.length), le16(0), le16(0), le16(0), le16(0), le32(0), le32(offset), name),
    );
    locals.push(local);
    offset += local.length;
  }
  const directory = concat(...centrals);
  const end = concat([0x50, 0x4b, 0x05, 0x06], le16(0), le16(0), le16(files.length), le16(files.length), le32(directory.length), le32(offset), le16(0));
  return concat(...locals, directory, end);
}

function push(value: number): number[] {
  if (value >= -1 && value <= 5) {
    return [0x03 + value];
  }
  return value >= -128 && value <= 127 ? [0x10, value & 255] : [0x11, ...be16(value & 0xffff)];
}

function byteArrayCode(text: string): number[] {
  const bytes = [...encoder.encode(text)];
  return [...push(bytes.length), 0xbc, 0x08, ...bytes.flatMap((byte, index) => [0x59, ...push(index), ...push(byte > 127 ? byte - 256 : byte), 0x54]), 0x57];
}

function classFile(constants: string[], literals: string[] = []): Uint8Array<ArrayBuffer> {
  const pool = [...constants, "Code", "run", "()V"];
  const entries = pool.flatMap((text) => {
    const bytes = [...encoder.encode(text)];
    return [1, ...be16(bytes.length), ...bytes];
  });
  const code = [...literals.flatMap(byteArrayCode), 0xb1];
  const codeIndex = constants.length + 1;
  const method = literals.length > 0 ? [0, 0, ...be16(codeIndex + 1), ...be16(codeIndex + 2), 0, 1, ...be16(codeIndex), ...be32(12 + code.length), 0, 4, 0, 1, ...be32(code.length), ...code, 0, 0, 0, 0] : [];
  return concat([0xca, 0xfe, 0xba, 0xbe, 0, 0, 0, 52], be16(pool.length + 1), entries, [0, 0x21, 0, 0, 0, 0, 0, 0, 0, 0], be16(literals.length > 0 ? 1 : 0), method, [0, 0]);
}

async function inspect(name: string, bytes: Uint8Array) {
  return inspectSource(name, source(bytes));
}

const webhook = `https://discord.com/api/webhooks/123456789012345678/${"aB3_x-".repeat(12)}`;
const fabric = (id: string) => ({ name: "fabric.mod.json", content: JSON.stringify({ schemaVersion: 1, id, version: "1.0.0" }) });
const manifest = { name: "META-INF/MANIFEST.MF", content: "Manifest-Version: 1.0" };

describe("Minecraft mod checks on the visitor's device", () => {
  it("reads strings from class files, including ones hidden in byte arrays and base64", () => {
    const text = classText(classFile(["java/net/URL", btoa("https://hidden.example/next")], ["85.217.144.130"]));
    expect(text?.constants).toContain("java/net/URL");
    expect(text?.hidden).toEqual(["https://hidden.example/next", "85.217.144.130"]);
    expect(classText(Uint8Array.from([0xca, 0xfe, 0xba, 0xbe, 0, 0]))).toBeNull();
  });

  it("finds nothing alarming in an ordinary mod and reads its mod ID", async () => {
    const jar = await zip([
      { name: "META-INF/MANIFEST.MF", content: "Manifest-Version: 1.0\n" },
      fabric("sodium"),
      { name: "net/caffeinemc/Sodium.class", content: classFile(["java/net/URLConnection", "https://api.modrinth.com/v2/project/sodium/version", "Rendering chunks", "Login Data screen"]) },
    ]);
    expect(await inspect("sodium.jar", jar)).toMatchObject({ kind: "java_archive", findings: ["minecraft_mod"], modId: "sodium" });
  });

  it("catches a session stealer that posts to a Discord webhook", async () => {
    const jar = await zip([
      { name: "mcmod.info", content: JSON.stringify([{ modid: "SkyblockPlus", name: "Skyblock Plus" }]) },
      { name: "a/b/Rat.class", content: classFile(["func_148254_d", "java/net/HttpURLConnection", webhook]) },
    ]);
    const result = await inspect("SkyblockPlus.jar", jar);
    expect(result.modId).toBe("skyblockplus");
    expect(result.findings.sort()).toEqual(["jar_sends_to_chat", "jar_session_token", "minecraft_mod"]);
  });

  it("knows the login token in Fabric and Mojang names, and needs a network call too", async () => {
    const fabricToken = await zip([fabric("helper"), { name: "a/A.class", content: classFile(["net/minecraft/class_320", "method_1674", "java/net/URLConnection"]) }]);
    expect((await inspect("helper.jar", fabricToken)).findings).toContain("jar_session_token");
    const mojang = await zip([fabric("helper"), { name: "a/A.class", content: classFile(["net/minecraft/client/User", "getAccessToken", "okhttp3/OkHttpClient"]) }]);
    expect((await inspect("helper.jar", mojang)).findings).toContain("jar_session_token");
    const offline = await zip([fabric("helper"), { name: "a/A.class", content: classFile(["net/minecraft/client/User", "getAccessToken"]) }]);
    expect((await inspect("helper.jar", offline)).findings).toEqual(["minecraft_mod"]);
    const split = await zip([fabric("helper"), { name: "a/A.class", content: classFile(["net/minecraft/client/User", "java/net/URLConnection"]) }, { name: "a/B.class", content: classFile(["getAccessToken"]) }]);
    expect((await inspect("helper.jar", split)).findings).toEqual(["minecraft_mod"]);
  });

  it("finds a webhook hidden in base64 and an address built from a byte array", async () => {
    const hidden = await zip([fabric("cool"), { name: "a/A.class", content: classFile([btoa("https://discordapp.com/api/webhooks/1/x")]) }]);
    expect((await inspect("cool.jar", hidden)).findings.sort()).toEqual(["jar_hidden_download", "jar_sends_to_chat", "minecraft_mod"]);
    const fractureiser = await zip([fabric("dungeonz"), { name: "net/dungeonz/DungeonzMain.class", content: classFile(["java/net/URLClassLoader", "java/net/URL", "(Ljava/lang/String;Ljava/lang/String;ILjava/lang/String;)V"], ["http", "85.217.144.130", "/dl"]) }]);
    expect((await inspect("dungeonz.jar", fractureiser)).findings.sort()).toEqual(["jar_hidden_download", "jar_runs_downloaded_code", "minecraft_mod"]);
  });

  it("catches code that goes after Discord, browser, Telegram, and wallet logins", async () => {
    for (const constants of [
      ["\\discord\\Local Storage\\leveldb"],
      ["Local Storage", "leveldb"],
      ["Login Data", "\\Google\\Chrome\\User Data\\"],
      ["/Default/Network/Cookies"],
      ["os_crypt", "encrypted_key"],
      ["logins.json", "key4.db"],
      ["Telegram Desktop", "tdata"],
      ["nkbihfbeogaeaoehlefnkodbefgpgknn"],
    ]) {
      const jar = await zip([fabric("x"), { name: "a/A.class", content: classFile(constants) }]);
      expect((await inspect("x.jar", jar)).findings, constants.join(" + ")).toContain("jar_steals_logins");
    }
    const harmless = await zip([fabric("x"), { name: "a/A.class", content: classFile(["Login Data", "Invalid login data", "leveldb", "cookies", "tdata"]) }]);
    expect((await inspect("x.jar", harmless)).findings).toEqual(["minecraft_mod"]);
  });

  it("catches anti-analysis checks, hidden commands, launcher account files, and programs inside", async () => {
    const evasive = await zip([fabric("x"), { name: "a/A.class", content: classFile(["tasklist", "Wireshark.exe", "HTTPDebuggerUI.exe"]) }]);
    expect((await inspect("x.jar", evasive)).findings).toContain("jar_hides_from_analysis");
    const oneTool = await zip([fabric("x"), { name: "a/A.class", content: classFile(["wireshark"]) }]);
    expect((await inspect("x.jar", oneTool)).findings).toEqual(["minecraft_mod"]);
    const commands = await zip([fabric("x"), { name: "a/A.class", content: classFile(["java/lang/ProcessBuilder", "powershell -WindowStyle Hidden -Command Add-MpPreference -ExclusionPath C:\\"]) }]);
    expect((await inspect("x.jar", commands)).findings).toContain("jar_runs_commands");
    const accounts = await zip([fabric("x"), { name: "a/A.class", content: classFile([".minecraft/launcher_accounts_microsoft_store.json"]) }]);
    expect((await inspect("x.jar", accounts)).findings).toContain("jar_reads_accounts");
    const program = await zip([fabric("x"), manifest, { name: "assets/x/update.exe", content: "MZ" }]);
    expect((await inspect("x.jar", program)).findings).toContain("jar_has_program");
    const paste = await zip([fabric("x"), { name: "a/A.class", content: classFile([btoa("https://pastebin.com/raw/AbCdEf12")]) }]);
    expect((await inspect("x.jar", paste)).findings).toContain("jar_hidden_download");
    const ip = await zip([fabric("x"), { name: "a/A.class", content: classFile(["http://147.45.79.104/download"]) }]);
    expect((await inspect("x.jar", ip)).findings).toContain("jar_hidden_download");
    const local = await zip([fabric("x"), { name: "a/A.class", content: classFile(["http://127.0.0.1:25565/status"]) }]);
    expect((await inspect("x.jar", local)).findings).toEqual(["minecraft_mod"]);
  });

  it("leaves alone the patterns honest popular mods use", async () => {
    const skull = btoa(JSON.stringify({ textures: { SKIN: { url: "http://textures.minecraft.net/texture/9a815398e7da89b1bc08f646cafc8e7b" } } }));
    for (const constants of [
      [skull],
      ["https://pastebin.com/raw/"],
      ["java/lang/ProcessBuilder", "powershell.exe", "-NoProfile", "-EncodedCommand"],
      ["java/lang/ProcessBuilder", "Invoke-Expression $__gsmtc_script"],
      ["java/lang/Runtime", "maxMemory", "rundll32 url.dll,FileProtocolHandler"],
      ["net/minecraft/client/User", "getName", "java/net/HttpURLConnection"],
    ]) {
      const jar = await zip([fabric("x"), { name: "a/A.class", content: classFile(constants) }]);
      expect((await inspect("x.jar", jar)).findings, constants.join(" + ")).toEqual(["minecraft_mod"]);
    }
  });

  it("recognizes container mods and mods with very many files", async () => {
    const inner = await zip([{ name: "a/A.class", content: classFile([webhook]) }]);
    const container = await zip([{ name: "META-INF/MANIFEST.MF", content: "Manifest-Version: 1.0\r\nFMLModType: LIBRARY\r\n" }, { name: "payload-1234.jar", content: inner }]);
    expect((await inspect("container.jar", container)).findings.sort()).toEqual(["jar_sends_to_chat", "minecraft_mod"]);
    const many = Array.from({ length: 5200 }, (_, index) => ({ name: `assets/x/${index}.txt`, content: "x", store: true }));
    const big = await zip([manifest, ...many, fabric("bigmod")]);
    expect((await inspect("big.jar", big)).modId).toBe("bigmod");
  }, 60_000);

  it("looks inside jars bundled in a mod, and checks a lone class file", async () => {
    const inner = await zip([{ name: "a/A.class", content: classFile([webhook]) }]);
    const outer = await zip([fabric("bundle"), manifest, { name: "META-INF/jars/inner.jar", content: inner, store: true }]);
    expect((await inspect("bundle.jar", outer)).findings).toContain("jar_sends_to_chat");
    expect(await inspect("Rat.class", classFile([webhook]))).toMatchObject({ kind: "java_archive", findings: ["jar_sends_to_chat"] });
  });

  it("says when part of a mod could not be read", async () => {
    const jar = await zip([fabric("x"), { name: "a/A.class", content: Uint8Array.from([0xca, 0xfe, 0xba, 0xbe, 0, 0, 0, 52, 0, 9, 99]) }]);
    expect((await inspect("x.jar", jar)).findings).toContain("jar_partly_read");
  });

  it.each([
    ["META-INF/neoforge.mods.toml", 'modLoader="javafml"\n[[mods]]\nmodId="create"\nversion="6.0.0"', "create"],
    ["META-INF/mods.toml", '[[mods]]\n    modId = "jei"', "jei"],
    ["quilt.mod.json", JSON.stringify({ quilt_loader: { id: "qsl" } }), "qsl"],
    ["plugin.yml", "name: LuckPerms\nversion: 5.4\nmain: me.lucko.Main", "luckperms"],
  ])("reads the mod ID from %s", async (file, content, id) => {
    const jar = await zip([{ name: file, content }, { name: "a/A.class", content: classFile(["x"]) }]);
    expect((await inspect("mod.jar", jar)).modId).toBe(id);
  });

  it("does not send an ID that is not a plain mod name", async () => {
    const jar = await zip([{ name: "fabric.mod.json", content: JSON.stringify({ id: "My Mod <script>" }) }, { name: "a/A.class", content: classFile(["x"]) }]);
    expect((await inspect("mod.jar", jar)).modId).toBeUndefined();
  });
});

describe("Minecraft modpacks", () => {
  const github = "e".repeat(40);
  const index = (files: unknown[]) => ({ name: "modrinth.index.json", content: JSON.stringify({ formatVersion: 1, game: "minecraft", name: "Pack", files }) });
  const modrinthFile = { path: "mods/sodium.jar", hashes: { sha1: "a".repeat(40) }, downloads: ["https://cdn.modrinth.com/data/AANobbMI/versions/x/sodium.jar"] };

  it("checks a clean Modrinth pack without sending anything extra", async () => {
    const pack = await zip([index([modrinthFile]), { name: "overrides/config/sodium.json", content: "{}" }]);
    const result = await inspect("pack.mrpack", pack);
    expect(result).toMatchObject({ kind: "minecraft_modpack", findings: [] });
    expect(result.packJars).toBeUndefined();
  });

  it("flags outside downloads, carried mods, and what those mods do", async () => {
    const carried = await zip([fabric("extra"), { name: "a/A.class", content: classFile([webhook]) }]);
    const pack = await zip([
      index([modrinthFile, { path: "mods/fix.jar", hashes: { sha1: github }, downloads: ["https://github.com/a/b/releases/download/1/fix.jar"] }, { path: "mods/evil.jar", hashes: { sha1: "f".repeat(40) }, downloads: ["https://evil.example/evil.jar"] }]),
      { name: "overrides/mods/extra.jar", content: carried, store: true },
    ]);
    const result = await inspect("pack.mrpack", pack);
    expect(result.kind).toBe("minecraft_modpack");
    expect(result.findings.sort()).toEqual(["jar_sends_to_chat", "modpack_breaks_rules", "modpack_carries_mods"]);
    const carriedSha1 = [...new Uint8Array(await crypto.subtle.digest("SHA-1", carried))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    expect(result.packJars?.sort()).toEqual([github, "f".repeat(40), carriedSha1].sort());
    expect(result.insideArchive).toEqual(["extra.jar"]);
  });

  it("flags files that would land outside the game folder", async () => {
    const pack = await zip([index([{ ...modrinthFile, path: "../../AppData/Roaming/Microsoft/Windows/Start Menu/Programs/Startup/run.jar" }])]);
    expect((await inspect("pack.mrpack", pack)).findings).toEqual(["modpack_breaks_rules"]);
  });

  it("recognizes CurseForge packs and the programs hidden in them", async () => {
    const pack = await zip([
      { name: "manifest.json", content: JSON.stringify({ manifestType: "minecraftModpack", overrides: "overrides", files: [{ projectID: 1, fileID: 2 }] }) },
      { name: "overrides/mods/a.jar", content: await zip([fabric("a"), { name: "a/A.class", content: classFile(["x"]) }]), store: true },
      { name: "overrides/tools/setup.exe", content: "MZ" },
      { name: "overrides/startserver.bat", content: "java -jar server.jar" },
    ]);
    const result = await inspect("pack.zip", pack);
    expect(result.kind).toBe("minecraft_modpack");
    expect(result.findings.sort()).toEqual(["archive_has_program", "modpack_carries_mods"]);
    expect(result.insideArchive).toEqual(["a.jar", "setup.exe"]);
    expect(result.packJars).toHaveLength(1);
  });

  it("reads a large mod quickly", async () => {
    const files = Array.from({ length: 3000 }, (_, index) => ({ name: `a/C${index}.class`, content: classFile([`net/example/C${index}`, "java/lang/Object", `Some text ${index}`]) }));
    const jar = await zip([fabric("big"), ...files]);
    const started = Date.now();
    const result = await inspect("big.jar", jar);
    expect(result.findings).toEqual(["minecraft_mod"]);
    expect(Date.now() - started).toBeLessThan(15_000);
  }, 60_000);
});
