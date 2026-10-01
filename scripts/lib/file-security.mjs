import { execFile } from "node:child_process";
import { chmod, lstat } from "node:fs/promises";
import { userInfo } from "node:os";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const privateGroupCache = new Map();
const bundledRuntimeRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

export function privatePrimaryGroup(details, account) {
  if (details.gid !== account.gid) return false;
  const passwdUsers = account.passwd
    .split("\n")
    .map((line) => line.split(":"))
    .filter((fields) => fields.length >= 4 && Number(fields[3]) === account.gid)
    .map((fields) => fields[0]);
  if (passwdUsers.length !== 1 || passwdUsers[0] !== account.username) return false;
  const group = account.group.trim().split(":");
  if (group.length < 4 || group[0] !== account.username || Number(group[2]) !== account.gid) {
    return false;
  }
  const members = group[3].split(",").map((member) => member.trim()).filter(Boolean);
  return members.every((member) => member === account.username);
}

async function currentPrivatePrimaryGroup(details) {
  if (
    process.platform !== "linux"
    || typeof process.getgid !== "function"
    || details.gid !== process.getgid()
  ) {
    return false;
  }
  if (!privateGroupCache.has(details.gid)) {
    privateGroupCache.set(details.gid, (async () => {
      try {
        const username = userInfo().username;
        const [{ stdout: passwd }, { stdout: group }] = await Promise.all([
          execFileAsync("getent", ["passwd"], { maxBuffer: 4 * 1024 * 1024, timeout: 2_000 }),
          execFileAsync("getent", ["group", String(details.gid)], {
            maxBuffer: 64 * 1024,
            timeout: 2_000,
          }),
        ]);
        return privatePrimaryGroup(details, {
          username,
          gid: process.getgid(),
          passwd,
          group,
        });
      } catch {
        return false;
      }
    })());
  }
  return privateGroupCache.get(details.gid);
}

export async function normalizePrivateGroupWrite(path, details, options = {}) {
  const platform = options.platform ?? process.platform;
  const getuid = options.getuid ?? process.getuid;
  if (
    platform !== "linux"
    || typeof getuid !== "function"
    || details.uid !== getuid()
    || (details.mode & 0o020) === 0
    || (details.mode & 0o002) !== 0
  ) {
    return details;
  }
  const privateGroup = options.privateGroup === undefined
    ? await currentPrivatePrimaryGroup(details)
    : await options.privateGroup;
  if (!privateGroup) return details;
  const nextMode = details.mode & ~0o020;
  await (options.chmod ?? chmod)(path, nextMode & 0o7777);
  return { ...details, mode: nextMode };
}

async function windowsFileWritableByAnotherUser(path) {
  const script = `
$ErrorActionPreference = "Stop"
$file = [System.IO.FileInfo]::new($env:GHOSTCLAW_ACL_TARGET)
$acl = [System.IO.FileSystemAclExtensions]::GetAccessControl($file)
$current = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$safe = @($current, "S-1-5-18", "S-1-5-32-544", "S-1-3-4")
$owner = $acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value
$unsafe = -not ($safe -contains $owner)
$writeMask = [int64](
  [System.Security.AccessControl.FileSystemRights]::WriteData -bor
  [System.Security.AccessControl.FileSystemRights]::AppendData -bor
  [System.Security.AccessControl.FileSystemRights]::WriteExtendedAttributes -bor
  [System.Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles -bor
  [System.Security.AccessControl.FileSystemRights]::WriteAttributes -bor
  [System.Security.AccessControl.FileSystemRights]::Delete -bor
  [System.Security.AccessControl.FileSystemRights]::ChangePermissions -bor
  [System.Security.AccessControl.FileSystemRights]::TakeOwnership
)
foreach ($rule in $acl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier])) {
  if ($unsafe) { break }
  if ($rule.AccessControlType -ne [System.Security.AccessControl.AccessControlType]::Allow) { continue }
  if (($rule.PropagationFlags -band [System.Security.AccessControl.PropagationFlags]::InheritOnly) -ne 0) { continue }
  $sid = $rule.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value
  if ($safe -contains $sid) { continue }
  if (([int64]$rule.FileSystemRights -band $writeMask) -ne 0) { $unsafe = $true }
}
[Console]::Out.Write($(if ($unsafe) { "true" } else { "false" }))
`;
  const args = [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-EncodedCommand",
    Buffer.from(script, "utf16le").toString("base64"),
  ];
  let stdout;
  let missingShell;
  for (const command of ["pwsh.exe", "powershell.exe"]) {
    try {
      ({ stdout } = await execFileAsync(command, args, {
        env: { ...process.env, GHOSTCLAW_ACL_TARGET: path },
        maxBuffer: 4 * 1024,
        // Endpoint protection can delay a fresh shell. The ACL read remains
        // bounded and fails closed if either installed shell cannot inspect it.
        timeout: 30_000,
        windowsHide: true,
      }));
      break;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      missingShell = error;
    }
  }
  if (stdout === undefined) throw missingShell ?? new Error("Windows access control is unavailable.");
  const result = stdout.trim();
  if (result !== "true" && result !== "false") {
    throw new Error("Windows did not return a valid file access result.");
  }
  return result === "true";
}

export async function writableByAnotherUser(path, details, options = {}) {
  const platform = options.platform ?? process.platform;
  if (platform === "win32") {
    return (options.windowsAcl ?? windowsFileWritableByAnotherUser)(path);
  }
  if ((details.mode & 0o002) !== 0) return true;
  if ((details.mode & 0o020) === 0) return false;
  return !await currentPrivatePrimaryGroup(details);
}

async function trustedRuntimeFileOwnerResult(path, details, options = {}) {
  const environment = options.environment ?? process.env;
  if (environment.VERCEL !== "1") return { trusted: false, reason: "not-vercel" };
  const taskRootValue = String(
    environment.LAMBDA_TASK_ROOT ?? options.runtimeRoot ?? bundledRuntimeRoot,
  ).trim();
  if (!isAbsolute(taskRootValue)) return { trusted: false, reason: "task-root" };
  if ((details.mode & 0o022) !== 0) return { trusted: false, reason: "file-permissions" };
  const taskRoot = resolve(taskRootValue);
  const target = resolve(path);
  const child = relative(taskRoot, target);
  if (!child || child.startsWith("..") || isAbsolute(child)) {
    return { trusted: false, reason: "outside-task-root" };
  }

  const inspect = options.lstat ?? lstat;
  let rootDetails;
  try {
    rootDetails = await inspect(taskRoot);
  } catch {
    return { trusted: false, reason: "parent-read" };
  }
  if (!rootDetails.isDirectory() || rootDetails.isSymbolicLink()) {
    return { trusted: false, reason: "parent-type" };
  }
  if ((rootDetails.mode & 0o022) !== 0) {
    return { trusted: false, reason: "parent-permissions" };
  }
  const deploymentOwner = rootDetails.uid;
  if (details.uid !== deploymentOwner) return { trusted: false, reason: "file-owner" };

  let current = dirname(target);
  while (true) {
    let directory;
    try {
      directory = await inspect(current);
    } catch {
      return { trusted: false, reason: "parent-read" };
    }
    if (!directory.isDirectory() || directory.isSymbolicLink()) {
      return { trusted: false, reason: "parent-type" };
    }
    if (directory.uid !== deploymentOwner) return { trusted: false, reason: "parent-owner" };
    if ((directory.mode & 0o022) !== 0) return { trusted: false, reason: "parent-permissions" };
    if (current === taskRoot) return { trusted: true, reason: "vercel-task-root" };
    const parent = dirname(current);
    if (parent === current) return { trusted: false, reason: "outside-task-root" };
    current = parent;
  }
}

export async function trustedRuntimeFileOwner(path, details, options = {}) {
  return (await trustedRuntimeFileOwnerResult(path, details, options)).trusted;
}

export async function fileOwnerTrust(path, details) {
  if (typeof process.getuid !== "function" || details.uid === process.getuid()) {
    return { trusted: true, reason: "current-user" };
  }
  return trustedRuntimeFileOwnerResult(path, details);
}

export async function ownedByCurrentUserOrTrustedRuntime(path, details) {
  return (await fileOwnerTrust(path, details)).trusted;
}
