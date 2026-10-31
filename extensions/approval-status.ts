/**
 * Approval status bridges.
 *
 * Herdr's Pi integration listens for `herdr:blocked` and reports the pane as
 * blocked. Terminals and dashboards that implement the Program Status Protocol
 * (OSC 7501) take the standard report instead.
 *
 * Pi core already reports select, confirm, input and editor prompts as blocked.
 * It leaves custom overlays out, because `ctx.ui.custom` also hosts non-blocking
 * UI. The custom approval overlay is a blocking prompt, so it reports up to
 * Pi's root program-status record itself.
 *
 * Pi owns that root record. While an approval waits, the agent is in a tool
 * call, so the state Pi would report after release is working; if the run has
 * already settled, it is idle. A later settled event replaces either one.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { ProgramStatus, Terminal } from "@earendil-works/pi-tui";

export const APPROVAL_LABEL = "approval needed";

/**
 * Tell Herdr's Pi integration that an approval waits. The integration counts
 * active blockers, so each returned release must run once; the release is
 * idempotent. Outside Herdr this does nothing.
 */
export function beginHerdrBlocked(
  pi: ExtensionAPI,
  label = APPROVAL_LABEL,
): () => void {
  if (process.env.HERDR_ENV !== "1") {
    return () => {};
  }

  pi.events.emit("herdr:blocked", { active: true, label, scope: "root" });
  let released = false;
  return () => {
    if (released) {
      return;
    }
    released = true;
    pi.events.emit("herdr:blocked", { active: false });
  };
}

let standardCount = 0;
let standardTerminal: Terminal | undefined;

/**
 * Report a blocking custom prompt to OSC 7501 terminals until release.
 * Nested approvals keep the record blocked until the last release. The restore
 * callback runs at release time, not at start, so it sees the settled state.
 */
export function beginStandardBlocked(
  terminal: Terminal,
  message: string,
  restore: () => ProgramStatus,
): () => void {
  // Older Pi releases expose no program-status method on the terminal.
  if (typeof terminal.setProgramStatus !== "function") {
    return () => {};
  }

  standardCount += 1;
  standardTerminal = terminal;
  terminal.setProgramStatus({
    state: "blocked",
    app: "pi",
    kind: "permission",
    message,
  });

  let released = false;
  return () => {
    if (released) {
      return;
    }
    released = true;
    standardCount = Math.max(0, standardCount - 1);
    if (standardCount === 0) {
      standardTerminal?.setProgramStatus(restore());
      standardTerminal = undefined;
    }
  };
}
