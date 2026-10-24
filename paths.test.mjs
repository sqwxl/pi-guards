import { isScratchPath } from "./paths.ts";

let failed = 0;
let checks = 0;

function check(name, actual, expected) {
	checks++;
	if (JSON.stringify(actual) !== JSON.stringify(expected)) {
		failed++;
		console.log("FAIL  ", name, "->", JSON.stringify(actual), "expected", JSON.stringify(expected));
	}
}

check("absolute temp path", isScratchPath("/tmp/x", "/home/u"), true);
check("temp root itself", isScratchPath("/tmp", "/home/u"), true);
check("macOS temp", isScratchPath("/var/folders/ab/cd/T/x", "/home/u"), true);
check("private temp", isScratchPath("/private/tmp/x", "/home/u"), true);
check("relative path under temp cwd", isScratchPath("x", "/tmp"), true);
check("relative escape", isScratchPath("../../etc/passwd", "/tmp/scratch"), false);
check("dot-dot escape", isScratchPath("/tmp/../home/u/.bashrc", "/home/u"), false);
check("normalized escape", isScratchPath("/tmp/scratch/../../home/u/.bashrc", "/home/u"), false);
check("prefix lookalike", isScratchPath("/tmpfoo/x", "/home/u"), false);
check("other absolute path", isScratchPath("/etc/passwd", "/home/u"), false);
check("project path", isScratchPath("src/main.rs", "/home/u/project"), false);

console.log(failed === 0 ? `ALL OK (${checks} checks)` : `${failed} FAILURES`);
process.exit(failed === 0 ? 0 : 1);
