import { findBashDeletion } from "./guard.ts";

// Deletions outside the scratch roots need approval; deletions inside them do not.
const cwd = "/home/u/project";

const positives = [
	"rm file.txt",
	"rm -rf build",
	"rm -rf /",
	"rm -rf /tmp",
	"rm /tmp/../etc/passwd",
	"rm -rf /tmp/scratch/../../home/u/x",
	"unlink notes.txt",
	"rmdir dir",
	"sudo rm -rf /home/u/x",
	"git rm file.txt",
	"rm $HOME/.bashrc",
	"xargs rm",
	"rm -rf .",
	"bash -c 'rm /home/u/x'",
	"$(rm /home/u/x)",
];

const negatives = [
	"npm install",
	"echo 'rm -rf /'",
	"rm /tmp/x",
	"rm -rf /tmp/build",
	"rm -- /tmp/x",
	"rm /tmp/a /tmp/b",
	"unlink /tmp/x",
	"rmdir /private/tmp/x",
	"rm -rf /var/folders/ab/cd/T/x",
	"sudo rm -rf /tmp/x",
	"bash -c 'rm /tmp/x'",
	"git rm /tmp/x",
];

let failed = 0;
for (const command of positives) {
	const found = findBashDeletion(command, cwd);
	if (!found) {
		failed++;
		console.log("MISS  ", JSON.stringify(command));
	}
}
for (const command of negatives) {
	const found = findBashDeletion(command, cwd);
	if (found) {
		failed++;
		console.log("FALSE+", JSON.stringify(command), "->", found);
	}
}
console.log(failed === 0 ? `ALL OK (${positives.length} positive, ${negatives.length} negative)` : `${failed} FAILURES`);
process.exit(failed === 0 ? 0 : 1);
