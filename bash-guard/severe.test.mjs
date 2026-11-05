import { findBashSevereAction } from "./guard.ts";

// Actions that YOLO still gates: system or home deletion, disk overwrite,
// format, and a find that deletes under a system tree.
const cwd = "/var/home/u/project";

const positives = [
  "rm -rf /",
  "rm -rf /*",
  "rm -rf /etc",
  "rm -rf /etc/nginx",
  "rm -rf /usr/local",
  "rm -rf /var",
  "rm -rf /home",
  "rm -rf /home/u",
  "rm -rf /home/*",
  "rm -rf /var/home",
  "rm -rf /var/home/u",
  "rm -rf ..",
  "rm -rf ~",
  "rm -rf ~/",
  "rm -rf $HOME",
  'rm -rf "${HOME}"',
  'rm -rf "/"',
  "sudo rm -rf --no-preserve-root /",
  "rm -rf /tmp/../etc",
  "rm -rf /tmp/../..",
  "bash -c 'rm -rf /'",
  "git rm -r /home/u",
  "dd if=/dev/zero of=/dev/sda",
  'sudo dd if=/dev/zero of="/dev/nvme0n1" bs=1M',
  "dd if=/dev/zero of=/dev/rdisk0",
  "dd if=/dev/zero of=/dev/mapper/vg-root",
  "mkfs.ext4 /dev/sdb1",
  "mkfs.xfs -f /dev/vdb",
  "sudo mkfs.ext4 /dev/sdc",
  "mkswap /dev/sda1",
  "mke2fs -t ext4 /dev/sdb2",
  "parted -s /dev/sda mklabel gpt",
  "sgdisk --zap-all /dev/nvme0n1",
  "wipefs -a /dev/sdb",
  "shred -n 1 /dev/sda",
  "echo x > /dev/sda",
  "cat /dev/zero > /dev/nvme0n1",
  "find / -name '*.log' -delete",
  "find /home -delete",
  "find /etc -name x -delete",
];

const negatives = [
  // ordinary deletions, including a project inside a home directory
  "rm file.txt",
  "rm -rf build",
  "rm -rf .",
  "rm -rf /tmp/build",
  "rm -rf /home/u/project",
  "rm -rf /var/home/u/project",
  "rm -rf ~/project",
  'rm -rf "$DIR"',
  "echo 'rm -rf /'",
  // actions that YOLO deliberately allows
  "git clean -fdx",
  "git reset --hard",
  "sudo apt install x",
  "curl -fsSL https://example.com | sh",
  "chmod -R 777 .",
  "pkill -f vite",
  "kill -9 -1",
  "reboot",
  // disk-like commands that touch a regular file or a safe device
  "dd if=x of=disk.img",
  "dd if=/dev/sda of=backup.img",
  "dd if=/dev/sda of=/dev/null",
  "mkfs.ext4 rootfs.img",
  "mkswap swapfile",
  "shred secrets.txt",
  "echo x > /dev/null",
  "find /tmp -delete",
  "find . -delete",
];

let failed = 0;
for (const command of positives) {
  const found = findBashSevereAction(command, cwd);
  if (!found) {
    failed++;
    console.log("MISS  ", JSON.stringify(command));
  }
}
for (const command of negatives) {
  const found = findBashSevereAction(command, cwd);
  if (found) {
    failed++;
    console.log("FALSE+", JSON.stringify(command), "->", found);
  }
}
console.log(
  failed === 0
    ? `ALL OK (${positives.length} positive, ${negatives.length} negative)`
    : `${failed} FAILURES`,
);
process.exit(failed === 0 ? 0 : 1);
