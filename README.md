# pi-guards

Pi extensions that approve or block destructive bash and file writes.

## Install

```sh
pi install git:github.com/sqwxl/pi-guards
```

Pi clones the repository and installs the `unbash` dependency.

## Extensions

| Extension | Behavior |
|---|---|
| `extensions/permission-gate.ts` | Ask before privileged or destructive bash commands. Refuse bash commands that edit files in place. |
| `extensions/confirm-writes.ts` | Ask before the `edit` and `write` tools change files. |
| `extensions/thinking-step.ts` | Show the reasoning step while the model works. |

## bash-guard

`bash-guard/guard.ts` parses bash commands with `unbash`. It finds file writes and mass kills. `extensions/permission-gate.ts` and the Claude Code hooks in `~/.claude/hooks/` import it.

## Tests

```sh
npm install
npm test
```
