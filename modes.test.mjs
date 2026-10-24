import {
  MODE_COLOR,
  MODE_ENTRY,
  MODE_HINT,
  MODE_LABEL,
  MODES,
  contrastShade,
  isMode,
  lastMode,
  loosen,
  needsApproval,
  nextMode,
  singleLine,
  relativeLuminance,
} from "./modes.ts";

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

check(
  "cycle order",
  MODES.map((mode) => nextMode(mode)),
  ["careful", "yolo", "paranoid"],
);
check(
  "loosen order",
  MODES.map((mode) => loosen(mode)),
  ["careful", "yolo", "yolo"],
);
check(
  "labels",
  MODES.map((mode) => MODE_LABEL[mode]),
  ["PARANOID", "CAREFUL", "YOLO"],
);
check(
  "colors",
  MODES.map((mode) => MODE_COLOR[mode]),
  ["success", "warning", "error"],
);
check(
  "has a hint for every mode",
  MODES.every((mode) => Boolean(MODE_HINT[mode])),
  true,
);
check("accepts mode names", MODES.map(isMode), [true, true, true]);
check("rejects other names", ["ask", "auto", "PARANOID", ""].map(isMode), [
  false,
  false,
  false,
  false,
]);

check("prompt text keeps words", singleLine("cat > f"), "cat > f");
check("prompt text drops newlines", singleLine("a\nb"), "a b");
check("prompt text drops tabs", singleLine("a\t\tb"), "a b");
check("prompt text drops escapes", singleLine("a\x1b[31mb"), "a [31mb");
check("prompt text drops NUL", singleLine("a\x00b"), "a b");
check("prompt text drops C1", singleLine("a\x9bb"), "a b");
check("prompt text trims", singleLine("  a  "), "a");
check("prompt text keeps unicode", singleLine("café"), "café");

const custom = (data) => ({ type: "custom", customType: MODE_ENTRY, data });
check("no stored mode", lastMode([]), undefined);
check(
  "ignores other entries",
  lastMode([
    { type: "message" },
    { ...custom({ mode: "yolo" }), customType: "other" },
  ]),
  undefined,
);
check("restores the stored mode", lastMode([custom({ mode: "yolo" })]), "yolo");
check(
  "last entry wins",
  lastMode([custom({ mode: "yolo" }), custom({ mode: "paranoid" })]),
  "paranoid",
);
check(
  "skips unknown modes",
  lastMode([custom({ mode: "yolo" }), custom({ mode: "ask" })]),
  "yolo",
);

for (const tool of ["read", "ls", "grep", "find"]) {
  check(`paranoid reads ${tool}`, needsApproval("paranoid", tool), false);
}
for (const tool of [
  "bash",
  "powershell",
  "edit",
  "write",
  "edit_lines",
  "subagent",
  "mcp__tools",
]) {
  check(`paranoid asks for ${tool}`, needsApproval("paranoid", tool), true);
}
for (const tool of ["write", "edit", "edit_lines"]) {
  check(`careful asks for ${tool}`, needsApproval("careful", tool), true);
}
for (const tool of [
  "read",
  "ls",
  "grep",
  "find",
  "bash",
  "powershell",
  "subagent",
  "mcp__tools",
]) {
  check(`careful allows ${tool}`, needsApproval("careful", tool), false);
}
for (const tool of [
  "read",
  "write",
  "edit",
  "edit_lines",
  "bash",
  "powershell",
  "mcp__tools",
]) {
  check(`yolo allows ${tool}`, needsApproval("yolo", tool), false);
}

check("luminance of white", relativeLuminance(255, 255, 255), 1);
check("luminance of black", relativeLuminance(0, 0, 0), 0);
check("shade on white background", contrastShade(255, 255, 255), 0);
check("shade on black background", contrastShade(0, 0, 0), 255);
check("shade on dark grey", contrastShade(40, 40, 40), 255);
// gruvbox semantic colors: bright enough for dark text
check("shade on gruvbox green", contrastShade(184, 187, 38), 0);
check("shade on gruvbox orange", contrastShade(254, 128, 25), 0);
check("shade on gruvbox red", contrastShade(251, 73, 52), 0);

console.log(failed === 0 ? `ALL OK (${checks} checks)` : `${failed} FAILURES`);
process.exit(failed === 0 ? 0 : 1);
