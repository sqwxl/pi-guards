import { resolve, sep } from "node:path";

/** Roots where CAREFUL writes without approval. */
const SCRATCH_ROOTS = ["/tmp", "/private/tmp", "/var/folders"];

/** Top-level roots whose deletion destroys the machine. `/home` and `/Users` are handled by user home. */
const SYSTEM_ROOTS = new Set([
  "/",
  "/bin",
  "/boot",
  "/dev",
  "/etc",
  "/lib",
  "/lib32",
  "/lib64",
  "/opt",
  "/proc",
  "/root",
  "/sbin",
  "/srv",
  "/sys",
  "/usr",
  "/var",
  "/Applications",
  "/Library",
  "/System",
]);

/**
 * True when `path` resolves inside a scratch root. The check uses the resolved
 * path, so `..` cannot leave the root. Symlinks are not resolved: a link inside
 * a scratch root can point outside it.
 */
export function isScratchPath(path: string, cwd: string): boolean {
  const resolved = resolve(cwd, path);
  return SCRATCH_ROOTS.some(
    (root) => resolved === root || resolved.startsWith(root + sep),
  );
}

/** Like `isScratchPath`, but the scratch roots themselves do not count. */
export function isInsideScratch(path: string, cwd: string): boolean {
  const resolved = resolve(cwd, path);
  return SCRATCH_ROOTS.some((root) => resolved.startsWith(root + sep));
}

/** Path without trailing slashes and trailing glob segments, so `/home/*` reads as `/home`. */
function staticPath(path: string): string {
  let value = path.replace(/\/+$/, "");
  while (/\/\*+$/.test(value)) {
    value = value.replace(/\/\*+$/, "");
  }
  if (value === "" && path.startsWith("/")) {
    return "/";
  }
  return value;
}

/**
 * True when deleting `path` would destroy a system tree or a user's home.
 * Glob suffixes count as their parent. Dynamic paths other than `~` and
 * `$HOME` cannot be resolved and never count.
 */
export function isCriticalPath(path: string, cwd: string): boolean {
  const value = staticPath(path);
  if (value === "~" || value === "$HOME" || value === "${HOME}") {
    return true;
  }
  if (/[$`]/.test(path)) {
    return false;
  }
  const resolved = resolve(cwd, value);
  if (resolved === "/home" || resolved === "/Users") {
    return true;
  }
  if (/^\/(?:home|Users)\/[^/]+$/.test(resolved)) {
    return true;
  }
  const top = "/" + resolved.split("/")[1];
  return SYSTEM_ROOTS.has(top);
}
