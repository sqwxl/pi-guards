# pi-guards

Pi extensions that approve or block tool calls.

## Install

```sh
pi install git:github.com/sqwxl/pi-guards
```

Pi clones the repository and installs the `unbash` dependency.

## Approval modes

`confirm-writes` starts every session in PARANOID. Press shift+tab to cycle, or use `/edits`.

| Mode | Asks before |
|---|---|
| `PARANOID` | Every tool call except file reads (`read`, `ls`, `grep`, `find`) |
| `CAREFUL` | File writes (`write`, `edit`, `edit_lines`) |
| `YOLO` | Nothing |

The status bar shows the active mode in green, orange, or red. Start a session in YOLO with `--auto-edits`. Print and JSON modes have no dialog, so a call that needs approval is blocked: unattended runs need `--auto-edits`.

## Extensions

| Extension | Behavior |
|---|---|
| `extensions/confirm-writes.ts` | Owns the approval mode. Asks before writes, and in PARANOID before every other tool call. |
| `extensions/permission-gate.ts` | Asks before privileged or destructive bash commands. Refuses bash commands that edit files in place. Silent in PARANOID. |
| `extensions/thinking-step.ts` | Show the reasoning step while the model works. |

## bash-guard

`bash-guard/guard.ts` parses bash commands with `unbash`. It finds file writes and mass kills. `extensions/permission-gate.ts` and the Claude Code hooks in `~/.claude/hooks/` import it.

## Tests

```sh
npm install
npm test
```
