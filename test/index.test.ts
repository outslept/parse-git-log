import { execFileSync } from "child_process";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { expect, test } from "vite-plus/test";
import { map } from "../src/fields.js";
import { fields, parseLogStream } from "../src/index.js";

function createTempRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "parse-git-"));
  const git = (...args: string[]) =>
    execFileSync(
      "git",
      ["-c", "user.name=Jane Doe", "-c", "user.email=jane@example.com", ...args],
      {
        cwd: dir,
        stdio: "ignore",
      },
    );

  git("init");
  writeFileSync(join(dir, "a.txt"), "1");
  git("add", ".");
  git("commit", "-m", "first commit\n\nbody line 1\nbody line 2");

  writeFileSync(join(dir, "a.txt"), "2");
  git("commit", "-am", "second: привет");

  return dir;
}

function cleanDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}

test("map flattens default and custom field configs", () => {
  const mapped = map();
  expect(mapped).toContainEqual({ path: ["commit", "long"], key: "H", type: undefined });
  expect(mapped).toContainEqual({ path: ["author", "date"], key: "ai", type: Date });
  expect(mapped).toContainEqual({ path: ["subject"], key: "s", type: undefined });

  const custom = map({
    hash: { key: "H" },
    ignored: undefined,
  });
  expect(custom).toEqual([{ path: ["hash"], key: "H", type: undefined }]);
});

test("parseLogStream parses commits and formats boolean, nullish, and camelCase flags", async () => {
  const cwd = createTempRepo();
  try {
    const commits = await Array.fromAsync(
      parseLogStream(
        {
          maxCount: 2,
          reverse: true,
          merges: false,
          since: undefined,
          until: null,
        },
        { cwd },
      ),
    );

    expect(commits).toHaveLength(2);
    expect(commits[0].subject).toBe("first commit");
    expect(commits[0].body.trim()).toBe("body line 1\nbody line 2");

    expect(commits[1]).toMatchObject({
      commit: { long: expect.stringMatching(/^[0-9a-f]{40}$/), short: expect.any(String) },
      tree: { long: expect.stringMatching(/^[0-9a-f]{40}$/), short: expect.any(String) },
      author: { name: "Jane Doe", email: "jane@example.com", date: expect.any(Date) },
      committer: { name: "Jane Doe", email: "jane@example.com", date: expect.any(Date) },
      subject: "second: привет",
      body: "",
    });
    expect(Number.isNaN(commits[1].author.date.getTime())).toBe(false);

    const empty = await Array.fromAsync(
      parseLogStream({ grep: "non-existent-commit-msg" }, { cwd }),
    );
    expect(empty).toEqual([]);
  } finally {
    cleanDir(cwd);
  }
});

test("parseLogStream respects mutated fields and overwrites scalar path prefixes", async () => {
  const cwd = createTempRepo();
  fields.rawBody = "B";
  fields.extra = { nested: "h" };
  try {
    const [latest] = await Array.fromAsync(parseLogStream({ maxCount: 1 }, { cwd }));
    expect(latest.rawBody.trim()).toBe("second: привет");
    expect(latest.extra.nested).toBe(latest.commit.short);
  } finally {
    delete fields.rawBody;
    delete fields.extra;
    cleanDir(cwd);
  }
});

test("parseLogStream emits error on non-zero git exit and on spawn failure", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "not-a-repo-"));
  try {
    await expect(Array.fromAsync(parseLogStream({}, { cwd }))).rejects.toThrow(/git log failed/);
  } finally {
    cleanDir(cwd);
  }

  await expect(
    Array.fromAsync(parseLogStream({}, { cwd: join(cwd, "missing-dir") })),
  ).rejects.toThrow();
});
