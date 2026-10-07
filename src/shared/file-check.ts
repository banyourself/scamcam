export const fileKinds = [
  "windows_program",
  "windows_library",
  "windows_installer",
  "windows_shortcut",
  "script",
  "android_app",
  "java_archive",
  "macos_program",
  "linux_program",
  "disk_image",
  "browser_extension",
  "roblox_model",
  "minecraft_modpack",
  "archive",
  "office_document",
  "pdf",
  "web_page",
  "svg_image",
  "image",
  "other",
] as const;

export type FileKind = (typeof fileKinds)[number];

export const fileFindings = [
  "extension_mismatch",
  "double_extension",
  "padded_name",
  "direction_trick",
  "office_macros",
  "pdf_javascript",
  "pdf_launch",
  "pdf_embedded_file",
  "pdf_auto_action",
  "html_password_form",
  "html_smuggling",
  "svg_script",
  "archive_encrypted",
  "archive_has_program",
  "archive_double_extension",
  "archive_nested",
  "archive_unreadable",
  "program_signed",
  "shortcut_runs_command",
  "script_downloads",
  "minecraft_mod",
  "too_large_to_hash",
  "extension_all_sites",
  "extension_reads_cookies",
  "extension_powerful",
  "python_bundle",
  "shortcut_remote_file",
  "registry_startup",
  "roblox_backdoor",
  "jar_steals_logins",
  "jar_sends_to_chat",
  "jar_runs_downloaded_code",
  "jar_hides_from_analysis",
  "jar_runs_commands",
  "jar_reads_accounts",
  "jar_session_token",
  "jar_hidden_download",
  "jar_has_program",
  "jar_partly_read",
  "modpack_breaks_rules",
  "modpack_carries_mods",
] as const;

export type FileFinding = (typeof fileFindings)[number];

export const maxHashBytes = 100 * 1024 * 1024;
export const maxFileBytes = 4 * 1024 * 1024 * 1024;
export const fileExtensionPattern = /^[a-z0-9]{1,12}$/;
export const modIdPattern = /^[a-z0-9][a-z0-9_.-]{0,63}$/;
export const sha1Pattern = /^[0-9a-f]{40}$/;
export const maxPackJars = 50;

export const fileKindNames: Record<FileKind, string> = {
  windows_program: "Windows program",
  windows_library: "Windows code library",
  windows_installer: "Windows installer",
  windows_shortcut: "Windows shortcut",
  script: "Script",
  android_app: "Android app",
  java_archive: "Java program",
  macos_program: "Mac program or disk image",
  linux_program: "Linux program",
  disk_image: "Disk image",
  browser_extension: "Browser extension",
  roblox_model: "Roblox model or place",
  minecraft_modpack: "Minecraft modpack",
  archive: "Compressed archive",
  office_document: "Office document",
  pdf: "PDF document",
  web_page: "Web page",
  svg_image: "SVG image",
  image: "Image",
  other: "File",
};

export interface FileCheckRequest {
  sha256?: string;
  sha1?: string;
  size: number;
  kind: FileKind;
  extension?: string;
  findings: FileFinding[];
  modId?: string;
  packJars?: string[];
}

export function describeFile(request: FileCheckRequest): string {
  const extension = request.extension ? ` (.${request.extension})` : "";
  return `${fileKindNames[request.kind]}${extension}, ${formatBytes(request.size)}`;
}

export function formatBytes(size: number): string {
  if (size < 1024) {
    return `${size} bytes`;
  }
  const units = ["KB", "MB", "GB"];
  let value = size / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 ? Math.round(value) : Math.round(value * 10) / 10} ${units[unit]}`;
}
