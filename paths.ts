import { resolve, sep } from "node:path";

/** Roots where CAREFUL writes without approval. */
const SCRATCH_ROOTS = ["/tmp", "/private/tmp", "/var/folders"];

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
