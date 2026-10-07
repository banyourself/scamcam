import { fileKindNames, type FileCheckRequest, type FileFinding, type FileKind } from "../shared/file-check";
import { sourceNames, type Signal, type Strength } from "./signals";

interface SignalText {
  strength: Strength;
  direction?: Signal["direction"];
  title: string;
  detail: string;
}

export const runnableKinds: readonly FileKind[] = [
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
];

const kindTexts: Record<FileKind, SignalText> = {
  windows_program: {
    strength: "strong",
    title: "This is a Windows program",
    detail: "Running a program from a chat or email is the most common way gaming accounts and saved passwords get stolen, and \"can you test my game?\" is a well-known way to spread them. Only install software from the official store or developer.",
  },
  windows_library: {
    strength: "moderate",
    title: "This is a Windows code library",
    detail: "Code libraries (.dll files) are loaded by programs. People rarely need to receive one on its own, and they are used to sneak malware past checks.",
  },
  windows_installer: {
    strength: "strong",
    title: "This is a Windows installer",
    detail: "Installers can put anything on your computer. Only use installers from the official website of the software.",
  },
  windows_shortcut: {
    strength: "strong",
    title: "This is a Windows shortcut, not a document",
    detail: "Shortcut files can run hidden commands when they are opened. Real documents and photos are never sent as shortcuts.",
  },
  script: {
    strength: "strong",
    title: "This is a script that runs commands",
    detail: "Scripts run commands on your computer as soon as they are opened. There is almost never a good reason to get one from someone you do not know.",
  },
  android_app: {
    strength: "moderate",
    title: "This is an Android app",
    detail: "Apps from outside the Play Store skip Google's checks. Fake game mods and \"free Robux\" apps are a common way to steal accounts.",
  },
  java_archive: {
    strength: "moderate",
    title: "This is a Java program",
    detail: "Java programs (.jar files) can do anything other programs can, including stealing accounts and passwords.",
  },
  macos_program: {
    strength: "moderate",
    title: "This is a Mac program or disk image",
    detail: "Mac programs from chats can install password stealers. Only install apps from the App Store or the developer's official site.",
  },
  linux_program: {
    strength: "moderate",
    title: "This is a Linux program",
    detail: "Programs from people you do not know can take over the computer that runs them.",
  },
  disk_image: {
    strength: "moderate",
    title: "This is a disk image",
    detail: "Disk images (.iso, .img, .vhd) open like a folder and are used to slip programs past Windows security warnings.",
  },
  browser_extension: {
    strength: "strong",
    title: "This is a browser extension",
    detail: "Extensions installed from a file skip the Chrome Web Store's and Firefox Add-ons' checks. Fake extensions sent in chats are used to steal logged-in accounts and crypto wallets. Only install extensions from the official store.",
  },
  roblox_model: {
    strength: "weak",
    direction: "context",
    title: "This is a Roblox model or place",
    detail: "Models and places can carry scripts that run in your game. ScamCam looked for known backdoor tricks in the scripts it could read. Scripts in binary files are often compressed, and those could not be read.",
  },
  minecraft_modpack: {
    strength: "weak",
    direction: "context",
    title: "This is a Minecraft modpack",
    detail: "ScamCam read the pack's list of mods and looked inside the mods it carries, on your device. Launchers download the rest when the pack is installed.",
  },
  archive: { strength: "weak", direction: "context", title: "This is a compressed archive", detail: "ScamCam read the names of the files inside on your device without unpacking them." },
  office_document: { strength: "weak", direction: "context", title: "This is an Office document", detail: "Office documents are usually safe to view, unless they contain macros or ask you to enable content." },
  pdf: { strength: "weak", direction: "context", title: "This is a PDF document", detail: "ScamCam looked for code and automatic actions inside the PDF." },
  web_page: {
    strength: "moderate",
    title: "This is a web page saved as a file",
    detail: "Web pages sent as attachments can show a fake login page that works offline, where browser and email protections may not see it.",
  },
  svg_image: { strength: "weak", direction: "context", title: "This is an SVG image", detail: "SVG images are text files that can contain code. ScamCam looked for it." },
  image: { strength: "weak", direction: "context", title: "This is an ordinary image", detail: "Ordinary pictures do not run code when opened." },
  other: { strength: "weak", direction: "context", title: "ScamCam did not recognize this kind of file", detail: "It is not a program, script, document, or archive that ScamCam knows how to look inside." },
};

function findingText(finding: FileFinding, request: FileCheckRequest): SignalText {
  const kind = fileKindNames[request.kind].toLowerCase();
  const shown = request.extension ? `.${request.extension}` : "a harmless type";
  switch (finding) {
    case "extension_mismatch":
      return { strength: "critical", title: "Disguised as a document, picture, or video", detail: `The name ends in ${shown}, but the file is really a ${kind}. Files that lie about what they are are made to trick people into running them.` };
    case "double_extension":
      return { strength: "strong", title: "Hides its real type behind a fake ending", detail: "Names like photo.jpg.exe show a harmless ending first. Only the last ending counts, and here it is one that runs code." };
    case "padded_name":
      return { strength: "strong", title: "Pushes its real ending out of view with spaces", detail: "Long runs of spaces before the last ending hide what the file really is when the name is cut off." };
    case "direction_trick":
      return { strength: "strong", title: "Uses an invisible character to flip part of the name", detail: "A text direction character makes the real ending display backwards, so a program can look like a picture or document." };
    case "office_macros":
      return { strength: "strong", title: "Contains macros", detail: "Macros are small programs inside Office documents. Documents that ask you to enable editing or content are a common way to install malware." };
    case "pdf_javascript":
      return { strength: "moderate", title: "Contains JavaScript", detail: "Most PDFs do not need code. JavaScript in a PDF can attack the reader app or send you to a fake page." };
    case "pdf_launch":
      return { strength: "strong", title: "Can try to start a program", detail: "This PDF has a Launch action, which asks the reader app to run a program or command." };
    case "pdf_embedded_file":
      return { strength: "moderate", title: "Has another file hidden inside", detail: "PDFs can carry attached files, and attackers hide programs that way." };
    case "pdf_auto_action":
      return { strength: "weak", title: "Does something as soon as it opens", detail: "Many ordinary PDFs do this to open at a page, but it can also start code or a link automatically." };
    case "html_password_form":
      return { strength: "strong", title: "Contains a login form", detail: "This page asks for a password. A login page sent as a file is almost always a phishing page." };
    case "html_smuggling":
      return { strength: "strong", title: "Builds a hidden download", detail: "The page assembles a file inside your browser and downloads it, a trick called HTML smuggling that gets malware past email filters." };
    case "svg_script":
      return { strength: "strong", title: "Contains code that runs when opened", detail: "This image contains code, for example to send you to a fake login page as soon as it is opened in a browser." };
    case "archive_encrypted":
      return { strength: "moderate", title: "Locked with a password", detail: "Password-protected archives hide their contents from virus scanners. Malware is often sent with the password written in the message." };
    case "archive_has_program":
      return { strength: "strong", title: "Contains a program, script, or shortcut", detail: "At least one file inside can run code. Opening it from the archive is the same as running a program from a stranger." };
    case "archive_double_extension":
      return { strength: "strong", title: "Contains a file with a disguised ending", detail: "A file inside is named like photo.jpg.exe, which hides that it runs code." };
    case "archive_nested":
      return { strength: "weak", title: "Contains another archive", detail: "Archives inside archives are sometimes used to get past scanners." };
    case "archive_unreadable":
      return { strength: "weak", direction: "context", title: "ScamCam could not look inside", detail: "This kind of archive cannot be read in the browser, so the files inside were not checked." };
    case "program_signed":
      return { strength: "weak", direction: "context", title: "Has a digital signature", detail: "ScamCam cannot check who signed it. Signed programs can still be harmful, and stolen signing certificates are used by malware." };
    case "shortcut_runs_command":
      return { strength: "critical", title: "Runs a hidden command", detail: "The shortcut starts PowerShell, the command prompt, or another tool that can download and run malware." };
    case "script_downloads":
      return { strength: "critical", title: "Downloads and runs more code", detail: "The script fetches something from the internet and runs it, which is how most malware droppers work." };
    case "minecraft_mod":
      return { strength: "weak", direction: "context", title: "This looks like a Minecraft mod or plugin", detail: "Mods can carry malware, as the fractureiser attack showed in 2023. Only download mods from CurseForge, Modrinth, or the creator's official page." };
    case "too_large_to_hash":
      return { strength: "weak", direction: "context", title: "Too large to fingerprint on your device", detail: "Files over 100 MB are not fingerprinted, so malware lists could not be checked. Some malware is padded to a huge size for exactly this reason." };
    case "extension_all_sites":
      return { strength: "moderate", title: "Can read and change every website you visit", detail: "The extension asks for access to all sites, so it could see and change everything you do in your browser, including logins." };
    case "extension_reads_cookies":
      return { strength: "strong", title: "Can read your login cookies", detail: "Cookies keep you logged in. An extension that reads them can hand your Discord, Roblox, Steam, or other accounts to someone else without your password." };
    case "extension_powerful":
      return { strength: "moderate", title: "Asks for unusually powerful permissions", detail: "It asks to control other extensions, run programs on your computer, route your traffic, read your clipboard, or debug pages. Few honest extensions need that." };
    case "python_bundle":
      return { strength: "moderate", title: "Built from a Python script with PyInstaller", detail: "Many Discord token grabbers and game account stealers are Python scripts packed into a program this way. Some honest tools are packed this way too." };
    case "shortcut_remote_file":
      return { strength: "strong", title: "Opens a file or folder on another computer", detail: "This shortcut points to a network share or remote folder instead of a website. Attackers use these to run programs from their own servers and get past Windows security warnings." };
    case "registry_startup":
      return { strength: "strong", title: "Changes what starts with Windows or turns off protection", detail: "Opening this file would change settings that start programs automatically, take over how files open, or switch off Windows Defender. Malware uses these to stay on a computer." };
    case "roblox_backdoor":
      return { strength: "moderate", title: "Has a script that loads outside or hidden code", detail: "A script loads code by asset ID with require(), or runs hidden code with loadstring or getfenv. Some admin systems load this way, but free model backdoors use the same tricks to give someone else control of your game." };
    case "jar_steals_logins":
      return { strength: "critical", title: "Has code that goes after saved passwords and Discord logins", detail: "It names the folders where Discord, web browsers, Telegram, or crypto wallets keep their logins. Mods have no reason to look there. This is how account stealers work." };
    case "jar_sends_to_chat":
      return { strength: "strong", title: "Sends data to a Discord webhook or Telegram bot", detail: "It has a Discord webhook or Telegram bot address built in, sometimes hidden in encoded text. Stealers use these to deliver stolen logins to whoever made them." };
    case "jar_runs_downloaded_code":
      return { strength: "strong", title: "Downloads code and runs it", detail: "It loads more code from a hidden internet address while the game runs, the trick the fractureiser malware used in 2023 after it got into real mods." };
    case "jar_hides_from_analysis":
      return { strength: "strong", title: "Checks for security tools before it does anything", detail: "It looks for programs that researchers use to study malware, such as Wireshark or a virtual machine. Honest mods have no reason to hide from them." };
    case "jar_runs_commands":
      return { strength: "strong", title: "Can run hidden Windows commands", detail: "It can start hidden PowerShell commands, add itself to what starts with Windows, or turn off Windows Defender checks." };
    case "jar_reads_accounts":
      return { strength: "moderate", title: "Reads the accounts saved by Minecraft launchers", detail: "It looks for the files where launchers such as the official launcher, Lunar, or Prism keep signed-in accounts. A few account tools do this, and so do Minecraft account stealers." };
    case "jar_session_token":
      return { strength: "moderate", title: "Reads your Minecraft login token and can connect to the internet", detail: "The login token lets anyone play as you and change your account until it expires. A few account and login mods need it, but stealing it is the main goal of Minecraft account stealers." };
    case "jar_hidden_download":
      return { strength: "moderate", title: "Hides a web address or downloads from an unusual place", detail: "It has a web address hidden in encoded text or built from numbers, a link to a bare IP address, or a raw paste link. Malware uses these to fetch its next part." };
    case "jar_has_program":
      return { strength: "moderate", title: "Has a Windows program or script inside", detail: "Mods sometimes carry helper files, but a program hidden inside a mod can be started by its code." };
    case "jar_partly_read":
      return { strength: "weak", direction: "context", title: "Only part of the code could be read", detail: "The file is very large or parts of it are packed in a way ScamCam cannot read in the browser, so not every part was checked." };
    case "modpack_breaks_rules":
      return { strength: "strong", title: "Breaks Modrinth's safety rules for modpacks", detail: "It downloads files from sites other than Modrinth, GitHub, and GitLab, or tries to place files outside the game folder. Modrinth's own modpacks cannot do either." };
    case "modpack_carries_mods":
      return { strength: "weak", title: "Carries mods inside the pack", detail: "Most packs have the launcher download their mods from Modrinth or CurseForge. ScamCam fingerprinted the mods carried inside and looked at their code on your device." };
  }
}

function toSignal(id: string, text: SignalText): Signal {
  return { id, source: sourceNames.file, direction: text.direction ?? "raises", strength: text.strength, title: text.title, detail: text.detail };
}

export function fileSignals(request: FileCheckRequest): Signal[] {
  return [toSignal(`file-kind-${request.kind}`, kindTexts[request.kind]), ...[...new Set(request.findings)].map((finding) => toSignal(`file-${finding}`, findingText(finding, request)))];
}
