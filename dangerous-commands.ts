/**
 * Raw-text checks for commands that destroy data or run remote code.
 *
 * `permission-gate` asks before running a matching command. The checks are
 * hints, not a parser: obfuscated commands can pass. The bash-guard parser
 * handles the file-write cases.
 */

const PATTERNS = [
	// rm that removes recursively or forcibly, whatever the target
	/\brm\s+(?:-[a-z]*[rf][a-z]*|--(?:recursive|force)\b)/i,
	// ... and rm aimed at a root, home, or every entry
	/\brm\s+(-[a-z]*[rf][a-z]*\s+)?(?:--recursive|--force|\/|~|\*)/i,
	// text from the network piped into a shell or an interpreter
	/\b(?:curl|wget)\b[^|\n]*\|\s*(?:sudo\s+)?(?:[\w./-]*\/)?(?:ba|z|da|k|a)?sh\b/i,
	/\b(?:curl|wget)\b[^|\n]*\|\s*(?:sudo\s+)?(?:[\w./-]*\/)?(?:python\d*|node|perl|ruby|php|deno|bun)\b/i,
	// the same through process substitution
	/\b(?:ba|z|da|k|a)?sh\s+(?:-\S+\s+)*<\(\s*(?:curl|wget)\b/i,
	// commands that discard local work
	/\bgit\s+clean\s+(?:-\S*f\S*|--force\b)/i,
	/\bgit\s+reset\b[^|\n]*--hard\b/i,
	/\bgit\s+(?:checkout|restore)\s+(?:--\s+)?\.(?:\s|$)/i,
	// mass deletion and overwrite
	/\bfind\b[^|\n]*\s-delete\b/i,
	/\bshred\b/i,
	/\bsudo\b/i, // privilege escalation
	/\b(chmod|chown)\b.*777/i, // world-writable perms
	/\b(dd|mkfs|fdisk|parted)\b/i, // raw disk operations
	/\b(shutdown|reboot|poweroff|halt)\b/i, // system state changes
	/>+\s*\/dev\/(sd[a-z]|disk)/i, // writing to block devices
];

/** Text with shell escapes and quotes removed, so `r\m` and `"/bin/rm"` match. */
function plain(command: string): string {
	return command.replace(/\\(?=[A-Za-z])/g, "").replace(/["']/g, "");
}

/** True when the command matches a known destructive shape. */
export function isDangerousCommand(command: string): boolean {
	const plainCommand = plain(command);
	return PATTERNS.some((pattern) => pattern.test(command) || pattern.test(plainCommand));
}
