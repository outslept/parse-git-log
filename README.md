# git-log-stream

Parse `git log` output into structured JavaScript objects using Node.js streams.

## Usage

```ts
const stream = parseLogStream({
  maxCount: 5,
  noMerges: true,
});

for await (const commit of stream) {
  console.log(commit.commit.short, commit.subject);
  console.log("Author:", commit.author.name, commit.author.date);
}
```

## API

### `parseLogStream(config?, options?)`

Spawns `git log` and returns a Node.js `Readable` object stream.

- `config` — Git arguments in camelCase. For example, `{ maxCount: 10, author: "alice" }`. Boolean values toggle Git flags.
- `options` — Node.js `SpawnOptions`, such as `{ cwd: "/path/to/repo" }`.

## Output

Each item emitted by the stream has the following shape:

```ts
{
  commit: {
    long: string;
    short: string;
  }
  tree: {
    long: string;
    short: string;
  }
  author: {
    name: string;
    email: string;
    date: Date;
  }
  committer: {
    name: string;
    email: string;
    date: Date;
  }
  subject: string;
  body: string;
}
```
