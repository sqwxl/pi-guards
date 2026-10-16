/**
 * Approval modes shared by the guard extensions.
 *
 * PARANOID asks before every tool call except file reads, CAREFUL asks before
 * writes, YOLO asks before nothing. Extensions exchange the active mode over
 * `pi.events` (event `guards:mode`): Pi loads every extension with its own
 * module cache, so module state is not shared between extensions.
 */

export type Mode = "paranoid" | "careful" | "yolo";

export const MODES: readonly Mode[] = ["paranoid", "careful", "yolo"];

/** Event name that carries the active mode to the other extensions. */
export const MODE_EVENT = "guards:mode";

export const MODE_LABEL: Record<Mode, string> = {
	paranoid: "PARANOID",
	careful: "CAREFUL",
	yolo: "YOLO",
};

/** Status bar colors, resolved through the theme's semantic tokens. */
export const MODE_COLOR: Record<Mode, "success" | "warning" | "error"> = {
	paranoid: "success",
	careful: "warning",
	yolo: "error",
};

export const MODE_HINT: Record<Mode, string> = {
	paranoid: "ask before every tool call except reads",
	careful: "ask before writes",
	yolo: "no approvals",
};

/** Tools that only read. PARANOID never prompts for these. */
export const READ_ONLY_TOOLS: ReadonlySet<string> = new Set(["read", "ls", "grep", "find"]);

/** Tools that change files. CAREFUL prompts for these. */
export const WRITE_TOOLS: ReadonlySet<string> = new Set(["write", "edit", "edit_lines"]);

export function isMode(value: string): value is Mode {
	return (MODES as readonly string[]).includes(value);
}

export function nextMode(mode: Mode): Mode {
	return MODES[(MODES.indexOf(mode) + 1) % MODES.length];
}

export function needsApproval(mode: Mode, toolName: string): boolean {
	if (mode === "yolo") {
		return false;
	}
	if (mode === "paranoid") {
		return !READ_ONLY_TOOLS.has(toolName);
	}
	return WRITE_TOOLS.has(toolName);
}
