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

| Mode       | Asks before                                                         |
| ---------- | ------------------------------------------------------------------- |
| `PARANOID` | Every tool call except file reads (`read`, `ls`, `grep`, `find`)    |
| `CAREFUL`  | File writes (`write`, `edit`, `edit_lines`)                         |
| `YOLO`     | No write approvals; `permission-gate` still checks destructive bash |

The status bar shows the active mode on a green, orange, or red background. Start a session in YOLO with `--auto-edits`. YOLO affects writes only: `permission-gate` still refuses bash file edits and asks before destructive commands. Print and JSON modes have no dialog, so a call that needs approval is blocked, in every mode: unattended runs need `--auto-edits` and a command set that the guards accept.

## Limits

These guards are advisory. They are heuristic checks in the Pi process, not a sandbox, and they do not stop a determined command. Use an operating-system or container boundary when you need real isolation.

- CAREFUL approves writes under `/tmp`, `/private/tmp`, and `/var/folders` without a prompt. The check resolves the path, so `..` cannot leave those roots. Symlinks are not resolved: a link inside a temporary directory can point outside it, and a write or deletion through that link skips approval.
- `permission-gate` detects bash file writes with `unbash` and a set of known commands. Redirections from commands it does not model, in-place editors it does not know, and obfuscated commands can pass without a prompt.
- Deletions (`rm`, `unlink`, `rmdir`, `git rm`) ask for approval in CAREFUL and YOLO unless every target is inside a scratch root. The scratch roots themselves are not exempt. `find -delete` and `shred` always ask.
- The write gate covers `write`, `edit`, and `edit_lines`. Other tools that can change files, such as MCP tools or custom tools, are not gated in CAREFUL.
- Destructive-command checks are text patterns. They also match a command that only mentions a destructive shape in an argument, such as `rg 'git reset --hard' docs/`. Expect a prompt, not silence.
- The approval prompt repeats the payload of the call it asks about: the edit diff, the written content, or the full command. A long payload scrolls with PgUp/PgDn, Home/End, or the wheel in fullscreen. The subject line above it stays cut at 160 characters. Print and JSON modes use the built-in selector, which shows only that subject line.
- The `powershell` tool is not analyzed. PARANOID asks for it; CAREFUL does not. On native Windows, keep the `bash` tool when you need the write gate.
- Control characters in tool arguments are replaced with spaces before display. They never reach the terminal through the dialog.

## Extensions

| Extension                       | Behavior                                                                                                                                                                                          |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `extensions/confirm-writes.ts`  | Owns the approval mode. Asks before writes, and in PARANOID before every other tool call.                                                                                                         |
| `extensions/permission-gate.ts` | Asks before privileged or destructive bash commands, including deletions outside the scratch roots. Refuses bash commands that edit files in place. Runs in CAREFUL and YOLO. Silent in PARANOID. |
| `extensions/thinking-step.ts`   | Show the reasoning step while the model works.                                                                                                                                                    |

## bash-guard

`bash-guard/guard.ts` parses bash commands with `unbash`. It finds file writes, deletions, and mass kills. `extensions/permission-gate.ts` and the Claude Code hooks in `~/.claude/hooks/` import it.

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
