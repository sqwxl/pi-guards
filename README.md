# pi-guards

Pi extensions that approve or block tool calls.

## Install

```sh
pi install npm:pi-guards
```

From git instead:

```sh
pi install git:github.com/sqwxl/pi-guards
```

Pi installs the `unbash` dependency.

## Approval modes

`confirm-writes` starts a new session in CAREFUL. The mode you set is stored in the session, so a resumed session keeps it; a fork copies the branch and keeps it too. Press shift+tab to cycle, or use `/edits`. Shift+tab works only when `app.thinking.cycle` is unbound in `keybindings.json`. The second option in the approval prompt accepts the call and loosens the mode one step (PARANOID → CAREFUL → YOLO); shift+tab in the dialog takes that option, message included, unless you are typing a message.

The prompt opens as an overlay above the editor and shows that call's payload. A batch renders every call preview before the first approval, and the transcript follows its newest block, so the call being approved is off screen. The overlay leaves the transcript's layout alone and owns PgUp/PgDn, which the fullscreen viewport would otherwise use to scroll the transcript.

| Mode       | Asks before                                                                                            |
| ---------- | ------------------------------------------------------------------------------------------------------ |
| `PARANOID` | Every tool call except file reads (`read`, `ls`, `grep`, `find`)                                       |
| `CAREFUL`  | File writes (`write`, `edit`, `edit_lines`), kills, deletions, and the dangerous-command patterns      |
| `YOLO`     | Only system or home deletion, disk writes, and `find / -delete`; everything else runs without a prompt |

The status bar shows the active mode on a green, orange, or red background. Start a session in YOLO with `--auto-edits`. YOLO approves writes, bash file edits, ordinary deletions, process kills, and broad dangerous commands such as `git reset --hard` without a prompt. `permission-gate` still asks before commands that can destroy a system tree or a disk, and blocks them when there is no dialog. Print and JSON modes have no dialog, so a call that needs approval is blocked in every mode: unattended runs need `--auto-edits` and a command set that the guards accept.

## Status reporting

While an approval waits, the guards report the session as blocked. Herdr's Pi integration listens for the `herdr:blocked` event and turns it into a blocked pane, tab, and workspace. The event is emitted only inside Herdr.

The custom write prompt also reports `blocked` with `kind=permission` through the Program Status Protocol (OSC 7501), so terminals and dashboards that support it see the wait. `permission-gate` uses Pi's selector, which Pi reports itself. OSC 7501 is the portable path; the Herdr event is a compatibility bridge until Herdr consumes OSC 7501. Set `PI_PROGRAM_STATUS=1` when the terminal consumes OSC 7501 but does not answer the support probe.

## Limits

These guards are advisory. They are heuristic checks in the Pi process, not a sandbox, and they do not stop a determined command. Use an operating-system or container boundary when you need real isolation.

- CAREFUL approves writes under `/tmp`, `/private/tmp`, and `/var/folders` without a prompt. The check resolves the path, so `..` cannot leave those roots. Symlinks are not resolved: a link inside a temporary directory can point outside it, and a write or deletion through that link skips approval.
- `permission-gate` detects bash file writes with `unbash` and a set of known commands. Redirections from commands it does not model, in-place editors it does not know, and obfuscated commands can pass without a prompt.
- Deletions (`rm`, `unlink`, `rmdir`, `git rm`) ask for approval in CAREFUL unless every target is inside a scratch root. The scratch roots themselves are not exempt. In YOLO only deletion of a system tree or a home directory asks: `rm -rf /`, `rm -rf /etc`, `rm -rf ~`, `rm -rf /home/u`, `rm -rf /home/*`. Ordinary deletions such as `rm -rf build` or `rm -rf /tmp/build` run without a prompt.
- Any command that stops a process asks for approval in CAREFUL. YOLO does not check process kills. `kill -0` and `kill -l` do not stop a process and never ask.
- The write gate covers `write`, `edit`, and `edit_lines`. Other tools that can change files, such as MCP tools or custom tools, are not gated in CAREFUL.
- CAREFUL checks destructive commands as text patterns. They also match a command that only mentions a destructive shape in an argument, such as `rg 'git reset --hard' docs/`. Expect a prompt, not silence. YOLO uses the parser instead and asks only for disk writes (`dd` or a redirect to a block device, `mkfs`, `parted`, `sgdisk`, `wipefs`, `shred` on a device) and `find` with `-delete` under a system tree.
- The approval prompt repeats the payload of the call it asks about: the edit diff, the written content, or the full command. A long payload scrolls with PgUp/PgDn, Home/End, or the wheel in fullscreen. The subject line above it stays cut at 160 characters. Print and JSON modes use the built-in selector, which shows only that subject line.
- The `powershell` tool is not analyzed. PARANOID asks for it; CAREFUL does not. On native Windows, keep the `bash` tool when you need the write gate.
- Control characters in tool arguments are replaced with spaces before display. They never reach the terminal through the dialog.
- OSC 7501 has one root status record per pane. The custom overlay sets `blocked` and restores `working` (or `idle`) when it closes. If another Pi prompt is open at the same time, the last report owns the label until Pi reports a settled state.

## Extensions

| Extension                       | Behavior                                                                                                                                                                                                                                                   |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `extensions/confirm-writes.ts`  | Owns the approval mode. Asks before writes, and in PARANOID before every other tool call.                                                                                                                                                                  |
| `extensions/permission-gate.ts` | Asks before destructive bash commands in CAREFUL: kills, deletions outside the scratch roots, and the dangerous-command patterns. Refuses bash commands that edit files in place. In YOLO asks only before system or disk destruction. Silent in PARANOID. |
| `extensions/thinking-step.ts`   | Show the reasoning step while the model works.                                                                                                                                                                                                             |

`extensions/approval-status.ts` is shared by the two guards and carries the status bridges. It is not loaded as an extension.

## bash-guard

`bash-guard/guard.ts` parses bash commands with `unbash`. It finds file writes, deletions, process kills, and severe disk or system destruction. `extensions/permission-gate.ts` and the Claude Code hooks in `~/.claude/hooks/` import it.

## Tests

```sh
npm install
npm test
```

## Development

`npm install` points `core.hooksPath` at `.githooks`, so every clone gets the pre-commit hook. The hook runs `lint-staged`, which formats the staged files with Prettier and re-stages them. It stashes unstaged changes first, so a partially staged file commits only what you staged.

```sh
npm run format   # format the whole repository
```

The project uses the Prettier defaults. `.prettierignore` excludes the lock file.
