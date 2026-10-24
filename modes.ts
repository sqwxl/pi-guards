/**
 * Approval modes shared by the guard extensions.
 *
 * PARANOID asks before every tool call except file reads, CAREFUL asks before
 * writes, YOLO asks before no write. Extensions exchange the active mode over
 * `pi.events` (event `guards:mode`): Pi loads every extension with its own
 * module cache, so module state is not shared between extensions.
 *
 * The mode covers only the tool approvals in this package. `permission-gate`
 * keeps refusing bash file edits and asking before destructive commands in
 * every mode except PARANOID, where `confirm-writes` already asks.
 */

import type { SessionEntry } from "@earendil-works/pi-coding-agent";

export type Mode = "paranoid" | "careful" | "yolo";

export const MODES: readonly Mode[] = ["paranoid", "careful", "yolo"];

/** Mode at session start, unless `--auto-edits` asks for YOLO or the session stored one. */
export const DEFAULT_MODE: Mode = "careful";

/** Event name that carries the active mode to the other extensions. */
export const MODE_EVENT = "guards:mode";

/** Custom session entry that stores the mode, so a resumed session keeps it. */
export const MODE_ENTRY = "guards-mode";

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
	yolo: "no write approvals",
};

/** Tools that only read. PARANOID never prompts for these. */
export const READ_ONLY_TOOLS: ReadonlySet<string> = new Set(["read", "ls", "grep", "find"]);

/** Tools that change files. CAREFUL prompts for these. */
export const WRITE_TOOLS: ReadonlySet<string> = new Set(["write", "edit", "edit_lines"]);

export function isMode(value: string): value is Mode {
	return (MODES as readonly string[]).includes(value);
}

/** One-line form of model-supplied text for prompts: no control characters. */
export function singleLine(value: string): string {
	return value.replace(/[\s\x00-\x1f\x7f-\x9f]+/g, " ").trim();
}

/** Last mode stored in a session branch, or undefined when the branch has none. */
export function lastMode(entries: readonly SessionEntry[]): Mode | undefined {
	let found: Mode | undefined;
	for (const entry of entries) {
		if (entry.type !== "custom" || entry.customType !== MODE_ENTRY) {
			continue;
		}
		const stored = (entry.data as { mode?: unknown } | undefined)?.mode;
		if (typeof stored === "string" && isMode(stored)) {
			found = stored;
		}
	}
	return found;
}

export function nextMode(mode: Mode): Mode {
	return MODES[(MODES.indexOf(mode) + 1) % MODES.length];
}

/** One step looser: paranoid → careful → yolo. YOLO stays YOLO. */
export function loosen(mode: Mode): Mode {
	return MODES[Math.min(MODES.indexOf(mode) + 1, MODES.length - 1)];
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

/** WCAG relative luminance of an 8-bit sRGB color, in 0..1. */
export function relativeLuminance(r: number, g: number, b: number): number {
	const channel = (value: number) => {
		const srgb = value / 255;
		return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
	};
	return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** Text shade that contrasts with the background: 0 for black, 255 for white. */
export function contrastShade(r: number, g: number, b: number): 0 | 255 {
	// Black and white contrast equally at L = 0.179; below it, white reads better.
	return relativeLuminance(r, g, b) > 0.179 ? 0 : 255;
}
