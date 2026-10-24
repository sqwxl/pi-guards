/**
 * Confirm Writes Extension
 *
 * Requires user approval before the agent writes or edits a file. Mirrors the
 * Claude Code permissions in ~/.claude/settings.json: ask on Edit/Write, allow
 * under temp directories, no prompt for anything else.
 *
 * A doomed `edit` call is answered with its error before any prompt. The call
 * is replayed through a dry-run twin of the built-in edit tool (same matching,
 * writes disabled), so the model can retry instead of the user approving an
 * edit that cannot apply. The block has no `terminate`: the model gets the
 * error as the tool result and continues.
 *
 * `edit_lines` is gated as well. Hashline editing is currently disabled with
 * PI_HARNESS_HASHLINES_ENABLED=false, but that env var is a runtime toggle: if it
 * is ever re-enabled (or lost, when pi starts from a shell that lacks it) an
 * ungated edit_lines would silently bypass the write approval below.
 *
 * Declining blocks the call with `terminate: true`. Pi records the block reason
 * as the tool result, so the model learns on its next turn that the edit was
 * rejected, and the run ends without the model spending a turn responding.
 * Do not call `ctx.abort()` here: an aborted signal replaces the block reason
 * with "Operation aborted", which loses the rejection.
 *
 * The prompt mirrors Claude Code: three choices, with Tab opening an inline
 * editor so any answer can carry a message. Ctrl+O toggles tool output while the
 * prompt is open, matching Pi's built-in selector. A message is attached to the tool
 * result the model reads next: on an approval it is appended to the executed
 * tool's result, on a rejection it is added to the block reason with
 * `terminate` omitted so the model can act on it in the same run.
 *
 * Three modes. CAREFUL (the default) prompts for writes, PARANOID prompts for
 * every tool call except file reads, YOLO writes without prompting. Cycle with
 * shift+tab or switch with /edits. In an approval dialog shift+tab takes the
 * relax option: it approves the call and loosens the mode one step
 * (PARANOID → CAREFUL → YOLO). `--auto-edits` starts a session in YOLO. The
 * mode is stored as a `guards-mode` session entry, so a resumed session keeps
 * the last mode; a session without one starts in CAREFUL. YOLO disables only
 * these write approvals: `permission-gate` still checks destructive bash. The
 * active mode is published on `pi.events`, so `permission-gate` can stay silent
 * when PARANOID already asks about a bash call. shift+tab requires
 * `app.thinking.cycle` to be unbound in keybindings.json. Pi dispatches
 * registered shortcuts only through the main editor, so a terminal input
 * listener handles shift+tab while a dialog owns keyboard focus.
 */

import type {
	EditToolInput,
	ExtensionAPI,
	ExtensionContext,
	ExtensionToolContext,
} from "@earendil-works/pi-coding-agent";
import { createEditToolDefinition, isToolCallEventType } from "@earendil-works/pi-coding-agent";
import { Editor, Key, colorToRgb, matchesKey, rgbColor, truncateToWidth } from "@earendil-works/pi-tui";
import { constants } from "node:fs";
import { access, readFile } from "node:fs/promises";

import {
	DEFAULT_MODE,
	MODE_COLOR,
	MODE_ENTRY,
	MODE_EVENT,
	MODE_HINT,
	MODE_LABEL,
	WRITE_TOOLS,
	contrastShade,
	isMode,
	lastMode,
	loosen,
	needsApproval,
	nextMode,
	singleLine,
	type Mode,
} from "../modes.ts";
import { isScratchPath } from "../paths.ts";

const MODE_SHORTCUT = "shift+tab";

/** The built-in edit tool with writes disabled: reports whether the call could apply, without touching the file. */
const dryRunEdit = createEditToolDefinition(process.cwd(), {
	operations: {
		readFile,
		writeFile: async () => {},
		access: (path) => access(path, constants.R_OK | constants.W_OK),
	},
});

/** The error the real `edit` call would fail with, or undefined when it would apply. */
async function editFailure(input: EditToolInput, ctx: ExtensionContext): Promise<string | undefined> {
	// `execute` reads only `cwd`; the tool-running fields have no job in a dry run.
	const toolContext: ExtensionToolContext = {
		...ctx,
		tools: [],
		executeTool: async () => {
			throw new Error("dry run does not execute tools");
		},
	};
	try {
		await dryRunEdit.execute("dry-run", input, undefined, undefined, toolContext);
		return undefined;
	} catch (error) {
		return error instanceof Error ? error.message : String(error);
	}
}

type Verdict = { choice: "yes" | "relax" | "no"; message: string };

/** One-line description of a tool call for the prompt and the rejection reason. */
function callSubject(input: unknown): string {
	const raw =
		typeof input === "object" && input !== null && "command" in input
			? String((input as { command: unknown }).command)
			: (JSON.stringify(input) ?? "");
	const flat = singleLine(raw);
	return flat.length > 160 ? `${flat.slice(0, 159)}…` : flat;
}

/** Takes the relax option of the open approval prompt; set only while a dialog is open. */
let relaxPrompt: (() => void) | undefined;

/**
 * Ask for a decision with an optional message. Tab opens the inline editor;
 * Enter submits the highlighted choice together with the message. Shift+Tab
 * takes the relax option through `relaxPrompt`. Outside the TUI the built-in
 * selector is used and the message is omitted.
 */
async function askApproval(
	ctx: ExtensionContext,
	title: string,
	subject: string,
	relaxLabel: () => string,
): Promise<Verdict | undefined> {
	const options = (): ReadonlyArray<{ id: Verdict["choice"]; label: string }> => [
		{ id: "yes", label: "Yes" },
		{ id: "relax", label: relaxLabel() },
		{ id: "no", label: "No" },
	];

	if (ctx.mode !== "tui") {
		const labels = options().map((option) => option.label);
		const choice = await ctx.ui.select(`${title}\n\n  ${subject}`, labels);
		const index = choice === undefined ? -1 : labels.indexOf(choice);
		return index === -1 ? undefined : { choice: options()[index].id, message: "" };
	}

	return ctx.ui.custom<Verdict | undefined>((tui, theme, keybindings, done) => {
		let selected = 0;
		let editing = false;
		let cached: string[] | undefined;
		let settled = false;

		function settle(verdict: Verdict | undefined): void {
			if (settled) {
				return;
			}
			settled = true;
			relaxPrompt = undefined;
			done(verdict);
		}

		const editor = new Editor(tui, {
			borderColor: (text) => theme.fg("accent", text),
			selectList: {
				selectedPrefix: (text) => theme.fg("accent", text),
				selectedText: (text) => theme.fg("accent", text),
				description: (text) => theme.fg("muted", text),
				scrollInfo: (text) => theme.fg("dim", text),
				noMatch: (text) => theme.fg("warning", text),
			},
		});
		editor.onSubmit = (value) => settle({ choice: options()[selected].id, message: value.trim() });
		// The session input listener sees Shift+Tab before this dialog does.
		// A message is being typed: Shift+Tab must not approve the call under it.
		relaxPrompt = () => {
			if (!editing) {
				settle({ choice: "relax", message: editor.getText().trim() });
			}
		};

		function refresh(): void {
			cached = undefined;
			tui.requestRender();
		}

		function handleInput(data: string): void {
			if (keybindings.matches(data, "app.tools.expand")) {
				ctx.ui.setToolsExpanded(!ctx.ui.getToolsExpanded());
				refresh();
				return;
			}

			if (editing) {
				if (matchesKey(data, Key.escape)) {
					editing = false;
					editor.focused = false;
					refresh();
					return;
				}
				editor.handleInput(data);
				refresh();
				return;
			}

			const picked = data.length === 1 ? Number(data) : Number.NaN;
			if (picked >= 1 && picked <= options().length) {
				settle({ choice: options()[picked - 1].id, message: "" });
				return;
			}
			if (keybindings.matches(data, "tui.select.up")) {
				selected = Math.max(0, selected - 1);
				refresh();
				return;
			}
			if (keybindings.matches(data, "tui.select.down")) {
				selected = Math.min(options().length - 1, selected + 1);
				refresh();
				return;
			}
			if (matchesKey(data, Key.tab)) {
				editing = true;
				editor.focused = true;
				refresh();
				return;
			}
			if (keybindings.matches(data, "tui.select.confirm")) {
				settle({ choice: options()[selected].id, message: "" });
				return;
			}
			if (keybindings.matches(data, "tui.select.cancel")) {
				settle(undefined);
			}
		}

		function render(width: number): string[] {
			if (cached) {
				return cached;
			}
			const lineWidth = Math.max(1, width);
			const lines = [
				theme.fg("accent", "─".repeat(lineWidth)),
				truncateToWidth(theme.fg("text", ` ${title}`), lineWidth, ""),
				truncateToWidth(theme.fg("muted", ` ${subject}`), lineWidth, ""),
				"",
			];
			const rows = options();
			for (let index = 0; index < rows.length; index++) {
				const prefix = index === selected ? theme.fg("accent", " > ") : "   ";
				const color = index === selected ? "accent" : "text";
				const label = `${index + 1}. ${rows[index].label}`;
				lines.push(truncateToWidth(`${prefix}${theme.fg(color, label)}`, lineWidth, ""));
			}
			lines.push("");
			if (editing) {
				lines.push(theme.fg("muted", " Message:"));
				for (const line of editor.render(Math.max(1, lineWidth - 2))) {
					lines.push(` ${line}`);
				}
				lines.push(truncateToWidth(theme.fg("dim", " Enter to submit • Esc to go back"), lineWidth, ""));
			} else {
				const toolsKey = keybindings.getKeys("app.tools.expand")[0];
				const hint = ` ↑↓ choose • Tab message • Shift+Tab relax • Enter confirm • Esc cancel${toolsKey ? ` • ${toolsKey} output` : ""}`;
				lines.push(truncateToWidth(theme.fg("dim", hint), lineWidth, ""));
			}
			lines.push(theme.fg("accent", "─".repeat(lineWidth)));
			cached = lines;
			return lines;
		}

		return {
			render,
			invalidate: () => {
				cached = undefined;
			},
			handleInput,
		};
	});
}

export default function (pi: ExtensionAPI) {
	let mode: Mode = DEFAULT_MODE;
	let removeInputListener: (() => void) | undefined;
	const approvalNotes = new Map<string, { toolName: string; message: string }>();

	function updateStatus(ctx: ExtensionContext): void {
		const theme = ctx.ui.theme;
		const background = theme.colors[MODE_COLOR[mode]];
		const { r, g, b } = colorToRgb(background);
		const shade = contrastShade(r, g, b);
		ctx.ui.setStatus(
			"confirm-writes",
			theme.style(MODE_LABEL[mode], { bg: background, fg: rgbColor(shade, shade, shade) }),
		);
	}

	function setMode(next: Mode, ctx: ExtensionContext): void {
		mode = next;
		pi.appendEntry(MODE_ENTRY, { mode });
		pi.events.emit(MODE_EVENT, { mode });
		updateStatus(ctx);
		ctx.ui.notify(`${MODE_LABEL[next]}: ${MODE_HINT[next]}`, "info");
	}

	function cycleMode(ctx: ExtensionContext): void {
		setMode(nextMode(mode), ctx);
	}

	pi.registerFlag("auto-edits", {
		description: "Start the session in YOLO mode, without write approvals",
		type: "boolean",
		default: false,
	});

	pi.registerCommand("edits", {
		description: "Show or set the approval mode: /edits paranoid | careful | yolo",
		handler: async (args, ctx) => {
			const next = args.trim().toLowerCase();
			if (isMode(next)) {
				setMode(next, ctx);
				return;
			}
			ctx.ui.notify(`${MODE_LABEL[mode]}: ${MODE_HINT[mode]} (use /edits paranoid | careful | yolo)`, "info");
		},
	});

	pi.registerShortcut(MODE_SHORTCUT, {
		description: "Cycle the approval mode",
		handler: async (ctx) => {
			cycleMode(ctx);
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		relaxPrompt = undefined;
		mode = pi.getFlag("auto-edits") === true ? "yolo" : (lastMode(ctx.sessionManager.getBranch()) ?? DEFAULT_MODE);
		pi.events.emit(MODE_EVENT, { mode });
		approvalNotes.clear();
		updateStatus(ctx);

		removeInputListener?.();
		removeInputListener = ctx.ui.onTerminalInput((data) => {
			if (!matchesKey(data, MODE_SHORTCUT)) {
				return undefined;
			}
			// While an approval dialog is open, Shift+Tab takes its relax option.
			if (relaxPrompt) {
				relaxPrompt();
				return { consume: true };
			}
			cycleMode(ctx);
			return { consume: true };
		});
	});

	pi.on("session_shutdown", async () => {
		relaxPrompt = undefined;
		approvalNotes.clear();
		removeInputListener?.();
		removeInputListener = undefined;
	});

	pi.on("tool_result", async (event) => {
		const note = approvalNotes.get(event.toolCallId);
		if (!note) {
			return undefined;
		}
		approvalNotes.delete(event.toolCallId);
		return {
			content: [
				...event.content,
				{ type: "text", text: `\nThe user approved this ${note.toolName} and added: ${note.message}` },
			],
		};
	});

	pi.on("tool_call", async (event, ctx) => {
		const { toolName } = event;
		if (!needsApproval(mode, toolName)) {
			return undefined;
		}

		const isWrite = WRITE_TOOLS.has(toolName);
		const path = isWrite ? String(event.input.path ?? "") : "";
		// A write without a path fails inside the tool; prompting for it is noise.
		if (isWrite && !path) {
			return undefined;
		}
		// Temp paths are scaffolding: CAREFUL writes there without prompting.
		if (mode === "careful" && isWrite && isScratchPath(path, ctx.cwd)) {
			return undefined;
		}

		if (isToolCallEventType("edit", event)) {
			const failure = await editFailure(event.input, ctx);
			if (failure) {
				return { block: true, reason: failure };
			}
		}

		const title = isWrite ? "Write to file?" : "Run tool?";
		const subject = isWrite ? `${toolName}  ${singleLine(path)}` : `${toolName}  ${callSubject(event.input)}`;
		const relaxLabel = () =>
			loosen(mode) === "yolo" ? "Yes, allow everything this session" : "Yes, allow all writes this session";

		if (!ctx.hasUI) {
			return {
				block: true,
				reason: `${subject} needs approval, but no UI is available`,
			};
		}

		const decline = `The user declined this ${toolName} call (${subject}). This is a deliberate rejection, not an error. Do not retry it unchanged.`;
		const verdict = await askApproval(ctx, title, subject, relaxLabel);
		if (!verdict) {
			return { block: true, terminate: true, reason: `${decline} Wait for the user's next instruction.` };
		}

		const { choice, message } = verdict;
		if (choice === "relax") {
			setMode(loosen(mode), ctx);
		}
		if (choice !== "no") {
			if (message) {
				approvalNotes.set(event.toolCallId, { toolName: event.toolName, message });
			}
			return undefined;
		}

		return {
			block: true,
			terminate: !message,
			reason: message ? `${decline} The user added: ${message}` : `${decline} Wait for the user's next instruction.`,
		};
	});
}
