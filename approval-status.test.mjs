import {
  APPROVAL_LABEL,
  beginHerdrBlocked,
  beginStandardBlocked,
} from "./extensions/approval-status.ts";

let failed = 0;
let checks = 0;

function check(name, actual, expected) {
  checks++;
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    failed++;
    console.log(
      "FAIL  ",
      name,
      "->",
      JSON.stringify(actual),
      "expected",
      JSON.stringify(expected),
    );
  }
}

function fakePi() {
  const events = [];
  return {
    events,
    pi: {
      events: {
        emit(channel, data) {
          events.push({ channel, data });
        },
      },
    },
  };
}

function fakeTerminal() {
  const statuses = [];
  return {
    statuses,
    terminal: {
      setProgramStatus(status) {
        statuses.push(status);
      },
    },
  };
}

process.env.HERDR_ENV = "1";
{
  const { events, pi } = fakePi();
  const release = beginHerdrBlocked(pi);
  check("herdr blocks with the default label", events, [
    {
      channel: "herdr:blocked",
      data: { active: true, label: APPROVAL_LABEL, scope: "root" },
    },
  ]);
  release();
  check("herdr clears", events.at(-1), {
    channel: "herdr:blocked",
    data: { active: false },
  });
  const count = events.length;
  release();
  check("herdr release is idempotent", events.length, count);
}

delete process.env.HERDR_ENV;
{
  const { events, pi } = fakePi();
  const release = beginHerdrBlocked(pi, "outside");
  release();
  check("herdr is silent outside Herdr", events, []);
}

{
  const release = beginStandardBlocked({}, "unsupported", () => ({
    state: "idle",
    app: "pi",
  }));
  release();
  check("missing terminal program-status method is a no-op", true, true);
}

{
  const { statuses, terminal } = fakeTerminal();
  let restores = 0;
  const releaseFirst = beginStandardBlocked(terminal, "Write to file?", () => {
    restores++;
    return { state: "working", app: "pi", message: "session" };
  });
  check("standard blocks with kind permission", statuses, [
    {
      state: "blocked",
      app: "pi",
      kind: "permission",
      message: "Write to file?",
    },
  ]);
  check("standard restore waits for release", restores, 0);

  const releaseSecond = beginStandardBlocked(terminal, "Run tool?", () => {
    restores++;
    return { state: "idle", app: "pi" };
  });
  check("nested approval keeps the record blocked", statuses.at(-1), {
    state: "blocked",
    app: "pi",
    kind: "permission",
    message: "Run tool?",
  });

  releaseFirst();
  check(
    "releasing one approval keeps the record blocked",
    statuses.at(-1).state,
    "blocked",
  );
  check("releasing one approval does not restore", restores, 0);

  releaseSecond();
  check("releasing the last approval restores", statuses.at(-1), {
    state: "idle",
    app: "pi",
  });
  check("restore runs once", restores, 1);

  const count = statuses.length;
  releaseSecond();
  check("standard release is idempotent", statuses.length, count);
  check("idempotent release does not restore again", restores, 1);
}

console.log(failed === 0 ? `ALL OK (${checks} checks)` : `${failed} FAILURES`);
process.exit(failed === 0 ? 0 : 1);
