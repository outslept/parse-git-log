import { execFileSync } from "child_process";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { test, expect } from "vite-plus/test";
import { map } from "../src/fields.js";
import { parseLogStream, fields } from "../src/index.js";

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

test("map flattens default fields config with Date types", () => {
  const mapped = map();
  expect(mapped).toContainEqual({ path: ["commit", "long"], key: "H", type: undefined });
  expect(mapped).toContainEqual({ path: ["author", "date"], key: "ai", type: Date });
  expect(mapped).toContainEqual({ path: ["subject"], key: "s", type: undefined });
});

test("parseLogStream parses commits and passes camelCase flags to git", async () => {
  const cwd = createTempRepo();
  try {
    const commits = await Array.fromAsync(parseLogStream({ maxCount: 2 }, { cwd }));

    expect(commits).toHaveLength(2);
    expect(commits[0]).toMatchObject({
      commit: { long: expect.stringMatching(/^[0-9a-f]{40}$/), short: expect.any(String) },
      tree: { long: expect.stringMatching(/^[0-9a-f]{40}$/), short: expect.any(String) },
      author: { name: "Jane Doe", email: "jane@example.com", date: expect.any(Date) },
      committer: { name: "Jane Doe", email: "jane@example.com", date: expect.any(Date) },
      subject: "second: привет",
      body: "",
    });
    expect(commits[1].subject).toBe("first commit");
    expect(commits[1].body.trim()).toBe("body line 1\nbody line 2");

    const single = await Array.fromAsync(parseLogStream({ maxCount: 1 }, { cwd }));
    expect(single).toHaveLength(1);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("parseLogStream respects mutated fields export", async () => {
  const cwd = createTempRepo();
  fields.rawBody = "B";
  try {
    const [latest] = await Array.fromAsync(parseLogStream({ maxCount: 1 }, { cwd }));
    expect(latest.rawBody.trim()).toBe("second: привет");
  } finally {
    delete fields.rawBody;
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("parseLogStream emits error when git fails", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "not-a-repo-"));
  try {
    await expect(Array.fromAsync(parseLogStream({}, { cwd }))).rejects.toThrow(/git log failed/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
