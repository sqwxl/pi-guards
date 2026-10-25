import { findKill } from "./guard.ts";

const massKills = [
  // pattern and broad lookup
  'pkill -f "src/main.ts" -U $(id -u) -n',
  "pkill -f vite",
  "killall Dock",
  "sudo killall -9 node",
  "/usr/bin/pkill node",
  "cd app && pkill -f server; npm start",
  "bash -c 'pkill -f vite'",
  "pgrep -f vite | xargs pkill",
  "pgrep -f vite | xargs kill",
  "pgrep -f vite | xargs kill -9",
  "pgrep -f x | xargs -I{} kill {}",
  "ps aux | grep node | awk '{print $2}' | xargs kill",
  "lsof -ti tcp:4778 | xargs kill",
  "lsof -ti tcp:4778 | xargs kill 2>/dev/null",
  "lsof -ti tcp:4778 -sTCP:LISTEN | xargs kill",
  "lsof -ti tcp:4778 -s TCP:LISTEN | xargs kill",
  "kill $(pgrep -f vite)",
  "kill -9 `pgrep node`",
  "kill $(lsof -t -i :3000)",
  "kill $(lsof -ti tcp:4778 -sTCP:LISTEN)",
  "kill -9 -1",
  "kill -- -1",
];

const targetedKills = [
  // explicit PID or a PID resolved at runtime
  "kill 1234",
  "kill -9 1234",
  "kill -TERM 1234 5678",
  "kill -1 1234",
  "kill -s TERM 1234",
  "sudo kill 1234",
  "kill $(cat server.pid)",
  'kill "$(cat /tmp/app.pid)"',
  "cat server.pid | xargs kill",
  "PID=$(pgrep -f vite); kill $PID",
];

const negatives = [
  "kill -l",
  "kill -l 9",
  "kill -0 1234",
  "kill -s 0 1234",
  "pgrep -lf node",
  "ps -p 1234 -o pid,command",
  "grep -n pkill notes.md",
  "rg -n 'killall|pkill' src",
  'git commit -m "stop using pkill"',
  'echo "never run kill -9 -1"',
  "docker kill web",
  "tmux kill-session -t scratch",
  "launchctl kickstart -k gui/501/com.example.service",
];

let failed = 0;
for (const command of massKills) {
  const found = findKill(command);
  if (!found) {
    failed++;
    console.log("MISS  ", JSON.stringify(command));
  } else if (!found.mass) {
    failed++;
    console.log("NOT MASS", JSON.stringify(command), "->", found.reason);
  }
}
for (const command of targetedKills) {
  const found = findKill(command);
  if (!found) {
    failed++;
    console.log("MISS  ", JSON.stringify(command));
  } else if (found.mass) {
    failed++;
    console.log("MASS  ", JSON.stringify(command), "->", found.reason);
  }
}
for (const command of negatives) {
  if (findKill(command)) {
    failed++;
    console.log("FALSE+", JSON.stringify(command), "->", findKill(command));
  }
}
console.log(
  failed === 0
    ? `ALL OK (${massKills.length} mass, ${targetedKills.length} targeted, ${negatives.length} negative)`
    : `${failed} FAILURES`,
);
process.exit(failed === 0 ? 0 : 1);
