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
 * `$HOME` cannot be resolved and never count. Paths inside a user's home are
 * ordinary data, including on systems that keep home under `/var/home`.
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
  const home = homePath(resolved);
  if (home === "root") {
    return true;
  }
  if (home === "inside") {
    return false;
  }
  const top = "/" + resolved.split("/")[1];
  return SYSTEM_ROOTS.has(top);
}

/** `root` for a home directory or its parent, `inside` for a path below one. */
function homePath(path: string): "root" | "inside" | undefined {
  if (path === "/home" || path === "/Users" || path === "/var/home") {
    return "root";
  }
  const match = /^\/(?:home|Users|var\/home)\/[^/]+(\/|$)/.exec(path);
  if (!match) {
    return undefined;
  }
  return match[1] === "/" ? "inside" : "root";
}
