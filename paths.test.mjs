import { isCriticalPath, isInsideScratch, isScratchPath } from "./paths.ts";

let failed = 0;
let checks = 0;

function check(name, actual, expected) {
  checks++;
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    failed++;
    console.log(
      "FAIL  ",
      name,
      "->",
      JSON.stringify(actual),
      "expected",
      JSON.stringify(expected),
    );
  }
}

check("absolute temp path", isScratchPath("/tmp/x", "/home/u"), true);
check("temp root itself", isScratchPath("/tmp", "/home/u"), true);
check("macOS temp", isScratchPath("/var/folders/ab/cd/T/x", "/home/u"), true);
check("private temp", isScratchPath("/private/tmp/x", "/home/u"), true);
check("relative path under temp cwd", isScratchPath("x", "/tmp"), true);
check(
  "relative escape",
  isScratchPath("../../etc/passwd", "/tmp/scratch"),
  false,
);
check(
  "dot-dot escape",
  isScratchPath("/tmp/../home/u/.bashrc", "/home/u"),
  false,
);
check(
  "normalized escape",
  isScratchPath("/tmp/scratch/../../home/u/.bashrc", "/home/u"),
  false,
);
check("prefix lookalike", isScratchPath("/tmpfoo/x", "/home/u"), false);
check("other absolute path", isScratchPath("/etc/passwd", "/home/u"), false);
check("project path", isScratchPath("src/main.rs", "/home/u/project"), false);

check("strict: file under temp", isInsideScratch("/tmp/x", "/home/u"), true);
check("strict: temp root", isInsideScratch("/tmp", "/home/u"), false);
check("strict: escape", isInsideScratch("/tmp/../etc", "/home/u"), false);
check(
  "strict: relative under temp cwd",
  isInsideScratch("x", "/tmp/project"),
  true,
);
check(
  "strict: macOS temp",
  isInsideScratch("/var/folders/ab/T/x", "/home/u"),
  true,
);
check(
  "strict: project path",
  isInsideScratch("src/main.rs", "/home/u/project"),
  false,
);

const project = "/home/u/project";
check("critical: root", isCriticalPath("/", project), true);
check("critical: root glob", isCriticalPath("/*", project), true);
check("critical: system tree", isCriticalPath("/etc", project), true);
check("critical: system subtree", isCriticalPath("/etc/nginx", project), true);
check("critical: usr subtree", isCriticalPath("/usr/local/bin", project), true);
check("critical: escape", isCriticalPath("/tmp/../etc", project), true);
check("critical: dot-dot escape", isCriticalPath("/tmp/../..", project), true);
check("critical: home root", isCriticalPath("/home", project), true);
check("critical: home dir", isCriticalPath("/home/u", project), true);
check("critical: home glob", isCriticalPath("/home/*", project), true);
check("critical: macOS home", isCriticalPath("/Users/u", project), true);
check("critical: var home root", isCriticalPath("/var/home", project), true);
check("critical: var home dir", isCriticalPath("/var/home/u", project), true);
check(
  "critical: var home project",
  isCriticalPath("/var/home/u/project", project),
  false,
);
check("critical: tilde", isCriticalPath("~", project), true);
check("critical: tilde slash", isCriticalPath("~/", project), true);
check("critical: HOME", isCriticalPath("$HOME", project), true);
check("critical: braced HOME", isCriticalPath("${HOME}", project), true);
check("critical: project path", isCriticalPath("src/main.rs", project), false);
check(
  "critical: home project",
  isCriticalPath("/home/u/project", project),
  false,
);
check("critical: tilde project", isCriticalPath("~/project", project), false);
check("critical: temp", isCriticalPath("/tmp/build", project), false);
check("critical: unknown variable", isCriticalPath("$DIR", project), false);
check("critical: relative dot", isCriticalPath(".", project), false);

console.log(failed === 0 ? `ALL OK (${checks} checks)` : `${failed} FAILURES`);
process.exit(failed === 0 ? 0 : 1);
