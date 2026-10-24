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
 * The prompt shows the payload of the call it asks about, because a batch renders
 * every call preview before the first approval and the transcript follows its
 * end: the pending call is the earliest block, which is off screen. Edits show
 * the diff the chat would render, writes the highlighted content, bash the full
 * command. A payload longer than the prompt scrolls with PgUp/PgDn, Home/End, or
 * the wheel while the choices stay pinned. The prompt is an overlay: the editor
 * dock would squeeze the transcript to one row, and the fullscreen viewport
 * consumes PgUp/PgDn before a dock component sees them.
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
  EditToolDetails,
  EditToolInput,
  ExtensionAPI,
  ExtensionContext,
  ExtensionToolContext,
  Theme,
} from "@earendil-works/pi-coding-agent";
import {
  createEditToolDefinition,
  getLanguageFromPath,
  highlightCode,
  isToolCallEventType,
  renderDiff,
} from "@earendil-works/pi-coding-agent";
import {
  Editor,
  Key,
  type TUI,
  type TuiMouseEvent,
  type TuiMouseEventResult,
  colorToRgb,
  matchesKey,
  rgbColor,
  truncateToWidth,
  wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
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

/** Shape of the renderer's layout boxes; only the fields the prompt reads. */
type LayoutBoxShape = { rect: { y: number }; children: LayoutBoxShape[] };

/** Rows the prompt reserves for its frame, the subject, the choices and the hint. */
const PROMPT_CHROME_ROWS = 12;
/** Smallest payload window worth showing. */
const PREVIEW_MIN_ROWS = 4;
/**
 * Rows between the editor's bottom border and the terminal bottom, read from the
 * layout frame the renderer used. The dock is the last child of the root, and the
 * footer is the last child of the dock, so the footer's top row is where the
 * prompt must end.
 */
function footerRows(tui: TUI, rows: number): number | undefined {
  const frame = (tui as TUI & { currentLayout?: { root?: LayoutBoxShape } })
    .currentLayout;
  const dock = frame?.root?.children.at(-1);
  const footer = dock?.children.at(-1);
  if (!footer) {
    return undefined;
  }
  return Math.max(0, rows - footer.rect.y);
}

/** Rows the prompt may occupy: everything above the editor's bottom border. */
function promptHeight(rows: number, footer: number | undefined): number {
  return Math.max(PROMPT_CHROME_ROWS + PREVIEW_MIN_ROWS, rows - (footer ?? 0));
}

/** Rows of payload the prompt shows at once. */
function previewHeight(rows: number, footer: number | undefined): number {
  return Math.max(
    PREVIEW_MIN_ROWS,
    promptHeight(rows, footer) - PROMPT_CHROME_ROWS,
  );
}

/** The built-in edit tool with writes disabled: reports whether the call could apply, without touching the file. */
const dryRunEdit = createEditToolDefinition(process.cwd(), {
  operations: {
    readFile,
    writeFile: async () => {},
    access: (path) => access(path, constants.R_OK | constants.W_OK),
  },
});

/** Either the error the real `edit` call would fail with, or the diff it would apply. */
type DryRun = { failure: string } | { diff: string };

async function editDryRun(
  input: EditToolInput,
  ctx: ExtensionContext,
): Promise<DryRun> {
  // `execute` reads only `cwd`; the tool-running fields have no job in a dry run.
  const toolContext: ExtensionToolContext = {
    ...ctx,
    tools: [],
    executeTool: async () => {
      throw new Error("dry run does not execute tools");
    },
  };
  try {
    const result = await dryRunEdit.execute(
      "dry-run",
      input,
      undefined,
      undefined,
      toolContext,
    );
    const details = result.details as EditToolDetails | undefined;
    return { diff: details?.diff ?? "" };
  } catch (error) {
    return { failure: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Payload lines for the prompt, in the form the chat renders them: the edit diff,
 * the highlighted write content, or the full command. Nothing is truncated here;
 * the prompt wraps and windows these lines.
 */
function payloadLines(
  toolName: string,
  input: unknown,
  diff: string,
  theme: Theme,
): string[] {
  if (diff) {
    return renderDiff(diff).split("\n");
  }
  const record =
    typeof input === "object" && input !== null
      ? (input as Record<string, unknown>)
      : {};
  if (toolName === "write") {
    return highlightCode(
      String(record.content ?? ""),
      getLanguageFromPath(String(record.path ?? "")),
    );
  }
  if (toolName === "bash") {
    return [
      theme.fg("toolTitle", theme.bold(`$ ${String(record.command ?? "")}`)),
    ];
  }
  // `edit_lines` and other replacement-shaped inputs have no computed diff to show.
  const edits = Array.isArray(record.edits) ? record.edits : [record];
  const lines: string[] = [];
  for (const edit of edits) {
    const fields =
      typeof edit === "object" && edit !== null
        ? (edit as Record<string, unknown>)
        : {};
    for (const line of String(fields.oldText ?? "").split("\n")) {
      lines.push(theme.fg("toolDiffRemoved", `- ${line}`));
    }
    for (const line of String(fields.newText ?? "").split("\n")) {
      lines.push(theme.fg("toolDiffAdded", `+ ${line}`));
    }
  }
  return lines;
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
  payload: string[],
  relaxLabel: () => string,
): Promise<Verdict | undefined> {
  const options = (): ReadonlyArray<{
    id: Verdict["choice"];
    label: string;
  }> => [
    { id: "yes", label: "Yes" },
    { id: "relax", label: relaxLabel() },
    { id: "no", label: "No" },
  ];

  if (ctx.mode !== "tui") {
    const labels = options().map((option) => option.label);
    const choice = await ctx.ui.select(`${title}\n\n  ${subject}`, labels);
    const index = choice === undefined ? -1 : labels.indexOf(choice);
    return index === -1
      ? undefined
      : { choice: options()[index].id, message: "" };
  }

  let terminalRows = (): number => 0;
  let terminalColumns = (): number => 0;
  let terminalFooter = (): number | undefined => undefined;

  return ctx.ui.custom<Verdict | undefined>(
    (tui, theme, keybindings, done) => {
      const footer = footerRows(tui, tui.terminal.rows);
      terminalRows = () => tui.terminal.rows;
      terminalColumns = () => tui.terminal.columns;
      terminalFooter = () => footer;
      let selected = 0;
      let editing = false;
      let scroll = 0;
      let scrollRange = 0;
      let windowRows = PREVIEW_MIN_ROWS;
      let cached: string[] | undefined;
      let cachedKey = "";
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
      editor.onSubmit = (value) =>
        settle({ choice: options()[selected].id, message: value.trim() });
      // The session input listener sees Shift+Tab before this dialog does.
      // A message is being typed: Shift+Tab must not approve the call under it.
      relaxPrompt = () => {
        if (!editing) {
          settle({ choice: "relax", message: editor.getText().trim() });
        }
      };

      function refresh(): void {
        cached = undefined;
        cachedKey = "";
        tui.requestRender();
      }

      function setScroll(next: number): void {
        scroll = Math.max(0, Math.min(scrollRange, next));
        refresh();
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
        if (scrollRange > 0) {
          if (matchesKey(data, Key.pageUp)) {
            setScroll(scroll - windowRows);
            return;
          }
          if (matchesKey(data, Key.pageDown)) {
            setScroll(scroll + windowRows);
            return;
          }
          if (matchesKey(data, Key.home)) {
            setScroll(0);
            return;
          }
          if (matchesKey(data, Key.end)) {
            setScroll(scrollRange);
            return;
          }
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
        const lineWidth = Math.max(1, width);
        const rows = terminalRows();
        const editorLines = editing
          ? editor.render(Math.max(1, lineWidth - 2))
          : [];
        // Editing replaces the hint with a label, the editor and its hint.
        const editingRows = editing ? editorLines.length + 1 : 0;
        windowRows = Math.max(
          1,
          previewHeight(rows, terminalFooter()) - editingRows,
        );
        const wrapped = payload.flatMap((line) =>
          line === "" ? [""] : wrapTextWithAnsi(line, lineWidth),
        );
        scrollRange = Math.max(0, wrapped.length - windowRows);
        scroll = Math.min(scroll, scrollRange);

        const key = `${lineWidth}:${rows}:${scroll}:${selected}:${editing}`;
        if (cached && cachedKey === key) {
          return cached;
        }

        const lines = [
          theme.fg("error", "─".repeat(lineWidth)),
          truncateToWidth(theme.fg("text", ` ${title}`), lineWidth, ""),
          truncateToWidth(theme.fg("muted", ` ${subject}`), lineWidth, ""),
          "",
        ];
        if (payload.length > 0) {
          lines.push(...wrapped.slice(scroll, scroll + windowRows));
          const last = Math.min(scroll + windowRows, wrapped.length);
          lines.push(
            truncateToWidth(
              scrollRange > 0
                ? theme.fg(
                    "dim",
                    ` lines ${scroll + 1}-${last} of ${wrapped.length}`,
                  )
                : "",
              lineWidth,
              "",
            ),
          );
          lines.push("");
        }
        const choices = options();
        for (let index = 0; index < choices.length; index++) {
          const prefix = index === selected ? theme.fg("accent", " > ") : "   ";
          const color = index === selected ? "accent" : "text";
          const label = `${index + 1}. ${choices[index].label}`;
          lines.push(
            truncateToWidth(
              `${prefix}${theme.fg(color, label)}`,
              lineWidth,
              "",
            ),
          );
        }
        lines.push("");
        if (editing) {
          lines.push(theme.fg("muted", " Message:"));
          for (const line of editorLines) {
            lines.push(` ${line}`);
          }
          lines.push(
            truncateToWidth(
              theme.fg("dim", " Enter to submit • Esc to go back"),
              lineWidth,
              "",
            ),
          );
        } else {
          const toolsKey = keybindings.getKeys("app.tools.expand")[0];
          const scrollHint = scrollRange > 0 ? " • PgUp/PgDn scroll" : "";
          const hint = ` ↑↓ choose • Tab message • Shift+Tab relax • Enter confirm • Esc cancel${toolsKey ? ` • ${toolsKey} output` : ""}${scrollHint}`;
          lines.push(truncateToWidth(theme.fg("dim", hint), lineWidth, ""));
        }
        lines.push(theme.fg("error", "─".repeat(lineWidth)));
        cached = lines;
        cachedKey = key;
        return lines;
      }

      function handleMouse(
        event: TuiMouseEvent,
      ): TuiMouseEventResult | undefined {
        if (event.type !== "wheel" || !event.wheelDelta || scrollRange === 0) {
          return undefined;
        }
        setScroll(scroll + event.wheelDelta);
        return { handled: true };
      }

      return {
        render,
        handleInput,
        handleMouse,
        invalidate: () => {
          cached = undefined;
          cachedKey = "";
        },
      };
    },
    {
      overlay: true,
      overlayOptions: () => ({
        width: terminalColumns(),
        maxHeight: promptHeight(terminalRows(), terminalFooter()),
        anchor: "bottom-center",
        margin: { bottom: terminalFooter() ?? 0 },
      }),
    },
  );
}

export default function (pi: ExtensionAPI) {
  let mode: Mode = DEFAULT_MODE;
  let removeInputListener: (() => void) | undefined;
  const approvalNotes = new Map<
    string,
    { toolName: string; message: string }
  >();

  function updateStatus(ctx: ExtensionContext): void {
    const theme = ctx.ui.theme;
    const background = theme.colors[MODE_COLOR[mode]];
    const { r, g, b } = colorToRgb(background);
    const shade = contrastShade(r, g, b);
    ctx.ui.setStatus(
      "confirm-writes",
      theme.style(MODE_LABEL[mode], {
        bg: background,
        fg: rgbColor(shade, shade, shade),
      }),
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
    description:
      "Show or set the approval mode: /edits paranoid | careful | yolo",
    handler: async (args, ctx) => {
      const next = args.trim().toLowerCase();
      if (isMode(next)) {
        setMode(next, ctx);
        return;
      }
      ctx.ui.notify(
        `${MODE_LABEL[mode]}: ${MODE_HINT[mode]} (use /edits paranoid | careful | yolo)`,
        "info",
      );
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
    mode =
      pi.getFlag("auto-edits") === true
        ? "yolo"
        : (lastMode(ctx.sessionManager.getBranch()) ?? DEFAULT_MODE);
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
        {
          type: "text",
          text: `\nThe user approved this ${note.toolName} and added: ${note.message}`,
        },
      ],
    };
  });

  pi.on("tool_call", async (event, ctx) => {
    const { toolName } = event;
    if (!needsApproval(mode, toolName)) {
      return undefined;
    }

    const isWrite = WRITE_TOOLS.has(toolName);
    const path =
      isWrite && "path" in event.input ? String(event.input.path ?? "") : "";
    // A write without a path fails inside the tool; prompting for it is noise.
    if (isWrite && !path) {
      return undefined;
    }
    // Temp paths are scaffolding: CAREFUL writes there without prompting.
    if (mode === "careful" && isWrite && isScratchPath(path, ctx.cwd)) {
      return undefined;
    }

    let diff = "";
    if (isToolCallEventType("edit", event)) {
      const dry = await editDryRun(event.input, ctx);
      if ("failure" in dry) {
        return { block: true, reason: dry.failure };
      }
      diff = dry.diff;
    }

    const edits = isToolCallEventType("edit", event)
      ? event.input.edits.length
      : 0;
    const title = isWrite
      ? `Write to file?${edits > 1 ? ` (${edits} edits)` : ""}`
      : "Run tool?";
    const subject = isWrite
      ? `${toolName}  ${singleLine(path)}`
      : `${toolName}  ${callSubject(event.input)}`;
    const relaxLabel = () =>
      loosen(mode) === "yolo"
        ? "Yes, allow everything this session"
        : "Yes, allow all writes this session";

    if (!ctx.hasUI) {
      return {
        block: true,
        reason: `${subject} needs approval, but no UI is available`,
      };
    }

    const decline = `The user declined this ${toolName} call (${subject}). This is a deliberate rejection, not an error. Do not retry it unchanged.`;
    const verdict = await askApproval(
      ctx,
      title,
      subject,
      payloadLines(toolName, event.input, diff, ctx.ui.theme),
      relaxLabel,
    );
    if (!verdict) {
      return {
        block: true,
        terminate: true,
        reason: `${decline} Wait for the user's next instruction.`,
      };
    }

    const { choice, message } = verdict;
    if (choice === "relax") {
      setMode(loosen(mode), ctx);
    }
    if (choice !== "no") {
      if (message) {
        approvalNotes.set(event.toolCallId, {
          toolName: event.toolName,
          message,
        });
      }
      return undefined;
    }

    return {
      block: true,
      terminate: !message,
      reason: message
        ? `${decline} The user added: ${message}`
        : `${decline} Wait for the user's next instruction.`,
    };
  });
}
