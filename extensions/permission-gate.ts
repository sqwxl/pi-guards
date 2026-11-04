/**
 * Permission Gate Extension
 *
 * Requires user approval before the LLM runs destructive commands via the
 * bash tool. Blocks by default when there's no UI (print/json modes).
 *
 * CAREFUL asks for every deletion outside a scratch root and for every process
 * kill. Commands that stop a process (`kill`, `pkill`, `killall`, also through
 * `sudo` or `xargs`) come from the same parser that finds file writes. It also
 * asks for the raw-text dangerous patterns: remote code, `sudo`, `git reset
 * --hard`, and raw disk tools.
 *
 * YOLO asks only for severe actions, in every tier: deletion of a system tree
 * or a home directory (`rm -rf /`, `rm -rf /etc`, `rm -rf ~`), disk writes
 * (`dd of=/dev/...`, `mkfs`, `parted`, `shred`, `> /dev/sda`), and `find /
 * -delete`. It does not gate bash file edits, ordinary deletions, process
 * kills, or the broad dangerous patterns.
 *
 * In CAREFUL, bash commands that write files are refused before they run.
 * In-place editors, interpreter programs that call write functions, and text
 * producers redirected into a file bypass the edit/write approval, so the model
 * is answered with a corrective reason and retries with the proper tool. The
 * command is parsed (unbash) and classified structurally: quoting, wrappers
 * (sudo, xargs, bash -c) and command substitutions are handled. Build tools,
 * formatters, and reads stay untouched.
 *
 * Declining blocks the call with `terminate: true`. Pi records the block reason
 * as the tool result, so the model learns on its next turn that the command was
 * rejected, and the run ends without the model spending a turn responding.
 * Do not call `ctx.abort()` here: an aborted signal replaces the block reason
 * with "Operation aborted", which loses the rejection.
 *
 * PARANOID mode belongs to `confirm-writes`, which asks before every bash call.
 * This extension tracks the mode over `pi.events` and stays silent in PARANOID:
 * the approval already covers the command, so the file-write refusal and the
 * dangerous-command prompt would only second-guess the user.
 *
 * Pi reports the selector as blocked through OSC 7501. This extension also
 * emits Herdr's blocked event around the wait, because Herdr's Pi integration
 * does not consume OSC 7501 yet.
 */

import type {
  ExtensionAPI,
  ExtensionContext,
  ToolCallEventResult,
} from "@earendil-works/pi-coding-agent";

import {
  findBashDeletion,
  findBashFileEdit,
  findBashSevereAction,
  findKill,
} from "../bash-guard/guard.ts";
import { isDangerousCommand } from "../dangerous-commands.ts";
import { MODE_EVENT, isMode, singleLine, type Mode } from "../modes.ts";
import { APPROVAL_LABEL, beginHerdrBlocked } from "./approval-status.ts";

export default function (pi: ExtensionAPI) {
  let mode: Mode = "paranoid";

  pi.events.on(MODE_EVENT, (data) => {
    const next = (data as { mode?: unknown } | undefined)?.mode;
    if (typeof next === "string" && isMode(next)) {
      mode = next;
    }
  });

  pi.on("tool_call", async (event, ctx) => {
    if (event.toolName !== "bash") return undefined;

    // PARANOID prompts for every bash call in confirm-writes; asking again here
    // would show two dialogs for one command.
    if (mode === "paranoid") return undefined;

    const command = event.input.command as string;
    const severe = findBashSevereAction(command, ctx.cwd);

    // YOLO asks for severe actions only.
    if (mode === "yolo") {
      return severe === undefined ? undefined : ask(command, severe, ctx);
    }

    const fileEdit = findBashFileEdit(command);
    if (fileEdit) {
      return {
        block: true,
        reason: `Blocked: ${fileEdit}. Use the edit or write tool instead. If a script is needed, create it with the write tool first.`,
      };
    }
    const kill = findKill(command);
    const deletion = findBashDeletion(command, ctx.cwd);
    const warning =
      severe ??
      kill?.reason ??
      deletion ??
      (isDangerousCommand(command) ? "Dangerous command" : undefined);
    if (warning === undefined) return undefined;
    return ask(command, warning, ctx);
  });

  async function ask(
    command: string,
    warning: string,
    ctx: ExtensionContext,
  ): Promise<ToolCallEventResult | undefined> {
    if (!ctx.hasUI) {
      return {
        block: true,
        reason: "Dangerous command blocked (no UI for confirmation)",
      };
    }

    const releaseHerdr = beginHerdrBlocked(pi, APPROVAL_LABEL);
    let choice: string | undefined;
    try {
      choice = await ctx.ui.select(
        `⚠️ ${warning}\n\n  ${singleLine(command)}\n\nAllow?`,
        ["Yes", "No"],
      );
    } finally {
      releaseHerdr();
    }
    if (choice !== "Yes") {
      return {
        block: true,
        terminate: true,
        reason:
          "The user declined to run this command. This is a deliberate rejection, not an error. Do not retry it unchanged. Wait for the user's next instruction.",
      };
    }
    return undefined;
  }
}
