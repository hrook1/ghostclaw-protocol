import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizePrivateGroupWrite,
  privatePrimaryGroup,
  trustedRuntimeFileOwner,
  writableByAnotherUser,
} from "./lib/file-security.mjs";

const privateAccount = {
  username: "ghostclaw",
  gid: 1000,
  passwd: "root:x:0:0:root:/root:/bin/bash\nghostclaw:x:1000:1000::/home/ghostclaw:/bin/bash\n",
  group: "ghostclaw:x:1000:\n",
};

test("a Linux user-private primary group has no other writer", () => {
  assert.equal(privatePrimaryGroup({ gid: 1000 }, privateAccount), true);
  assert.equal(privatePrimaryGroup({ gid: 1001 }, privateAccount), false);
});

test("a shared primary group is not private", () => {
  assert.equal(privatePrimaryGroup({ gid: 1000 }, {
    ...privateAccount,
    passwd: `${privateAccount.passwd}another:x:1001:1000::/home/another:/bin/bash\n`,
  }), false);
  assert.equal(privatePrimaryGroup({ gid: 1000 }, {
    ...privateAccount,
    group: "ghostclaw:x:1000:another\n",
  }), false);
});

test("world write permission is always unsafe", async () => {
  assert.equal(await writableByAnotherUser("/tmp/world-write", { mode: 0o702, gid: 1000 }), true);
});

test("Windows uses its access list instead of POSIX mode bits", async () => {
  assert.equal(await writableByAnotherUser("C:\\safe", { mode: 0o666 }, {
    platform: "win32",
    windowsAcl: async () => false,
  }), false);
  assert.equal(await writableByAnotherUser("C:\\unsafe", { mode: 0o600 }, {
    platform: "win32",
    windowsAcl: async () => true,
  }), true);
});

test("a safe Linux private-group file is normalized before use", async () => {
  const calls = [];
  const details = await normalizePrivateGroupWrite("/safe/prover", {
    uid: 1000,
    gid: 1000,
    mode: 0o100775,
  }, {
    platform: "linux",
    getuid: () => 1000,
    privateGroup: true,
    chmod: async (...args) => calls.push(args),
  });
  assert.equal(details.mode & 0o777, 0o755);
  assert.deepEqual(calls, [["/safe/prover", 0o755]]);
});

test("unsafe group and world permissions are never repaired", async () => {
  for (const input of [
    { mode: 0o100775, privateGroup: false },
    { mode: 0o100777, privateGroup: true },
  ]) {
    const calls = [];
    const details = await normalizePrivateGroupWrite("/unsafe/prover", {
      uid: 1000,
      gid: 1000,
      mode: input.mode,
    }, {
      platform: "linux",
      getuid: () => 1000,
      privateGroup: input.privateGroup,
      chmod: async (...args) => calls.push(args),
    });
    assert.equal(details.mode, input.mode);
    assert.deepEqual(calls, []);
  }
});

test("a Vercel task accepts one deployment-owned read-only path", async () => {
  const directory = {
    isDirectory: () => true,
    isSymbolicLink: () => false,
    uid: 0,
    mode: 0o755,
  };
  const options = {
    environment: { VERCEL: "1", LAMBDA_TASK_ROOT: "/var/task" },
    lstat: async () => directory,
  };
  assert.equal(await trustedRuntimeFileOwner(
    "/var/task/node_modules/@ghostclaw/prover/bin/ghostclaw-prover",
    { uid: 0, mode: 0o755 },
    options,
  ), true);
  const deployedOwner = {
    ...options,
    lstat: async () => ({ ...directory, uid: 1001 }),
  };
  assert.equal(await trustedRuntimeFileOwner(
    "/var/task/node_modules/@ghostclaw/prover/bin/ghostclaw-prover",
    { uid: 1001, mode: 0o755 },
    deployedOwner,
  ), true);
  assert.equal(await trustedRuntimeFileOwner(
    "/tmp/ghostclaw-prover",
    { uid: 0, mode: 0o755 },
    options,
  ), false);
  assert.equal(await trustedRuntimeFileOwner(
    "/var/task/node_modules/@ghostclaw/prover/bin/ghostclaw-prover",
    { uid: 0, mode: 0o775 },
    options,
  ), false);
  assert.equal(await trustedRuntimeFileOwner(
    "/var/task/node_modules/@ghostclaw/prover/bin/ghostclaw-prover",
    { uid: 1000, mode: 0o755 },
    options,
  ), false);
});

test("a Vercel task uses its loaded bundle when Lambda has no root variable", async () => {
  const directory = {
    isDirectory: () => true,
    isSymbolicLink: () => false,
    uid: 1001,
    mode: 0o755,
  };
  assert.equal(await trustedRuntimeFileOwner(
    "/var/task/node_modules/@ghostclaw/prover/bin/ghostclaw-prover",
    { uid: 1001, mode: 0o755 },
    {
      environment: { VERCEL: "1" },
      runtimeRoot: "/var/task",
      lstat: async () => directory,
    },
  ), true);
});

test("a writable, linked, or differently owned Vercel parent is rejected", async () => {
  const base = {
    isDirectory: () => true,
    isSymbolicLink: () => false,
    uid: 0,
    mode: 0o755,
  };
  for (const changed of [
    { ...base, mode: 0o775 },
    { ...base, isSymbolicLink: () => true },
    { ...base, uid: 1000 },
  ]) {
    assert.equal(await trustedRuntimeFileOwner(
      "/var/task/node_modules/@ghostclaw/prover/bin/ghostclaw-prover",
      { uid: 0, mode: 0o755 },
      {
        environment: { VERCEL: "1", LAMBDA_TASK_ROOT: "/var/task" },
        lstat: async (path) => path.endsWith("/bin") ? changed : base,
      },
    ), false);
  }
});
