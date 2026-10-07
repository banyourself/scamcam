import { crc32 } from "node:zlib";
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const source = "extension";
const manifest = JSON.parse(readFileSync(join(source, "manifest.json"), "utf8"));
const outDir = process.argv[2] ?? "dist/client/downloads";
const name = `scamcam-extension-${manifest.version}.zip`;

function files(dir) {
  return readdirSync(dir)
    .sort()
    .flatMap((entry) => {
      const path = join(dir, entry);
      return statSync(path).isDirectory() ? files(path) : [path];
    });
}

const fixedTime = 0x0000;
const fixedDate = (2026 - 1980) << 9 | 10 << 5 | 7;
const locals = [];
const centrals = [];
let offset = 0;
for (const path of files(source)) {
  const data = readFileSync(path);
  const fileName = Buffer.from(relative(source, path).replaceAll("\\", "/"), "utf8");
  const sum = crc32(data) >>> 0;
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0x0800, 6);
  local.writeUInt16LE(0, 8);
  local.writeUInt16LE(fixedTime, 10);
  local.writeUInt16LE(fixedDate, 12);
  local.writeUInt32LE(sum, 14);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(fileName.length, 26);
  local.writeUInt16LE(0, 28);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0x0800, 8);
  central.writeUInt16LE(0, 10);
  central.writeUInt16LE(fixedTime, 12);
  central.writeUInt16LE(fixedDate, 14);
  central.writeUInt32LE(sum, 16);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(fileName.length, 28);
  central.writeUInt32LE(offset, 42);
  locals.push(local, fileName, data);
  centrals.push(central, fileName);
  offset += local.length + fileName.length + data.length;
}
const directory = Buffer.concat(centrals);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(centrals.length / 2, 8);
end.writeUInt16LE(centrals.length / 2, 10);
end.writeUInt32LE(directory.length, 12);
end.writeUInt32LE(offset, 16);
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, name), Buffer.concat([...locals, directory, end]));
console.log(`packed ${name}`);
