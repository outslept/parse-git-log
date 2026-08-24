import { spawn, type SpawnOptions } from "child_process";
import { Transform, type TransformCallback, pipeline, PassThrough, type Readable } from "stream";
import {
  config as fieldsConfig,
  map as fieldsMap,
  type MappedField,
  type FieldConfigObject,
} from "./fields.js";

const END = "\x1e";
const FIELD = "\x1f";

function camelToKebab(str: string): string {
  return str.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
}

type CliArgValue = string | number | boolean | null | undefined;

function formatArgs(obj: Readonly<Record<string, CliArgValue>>): string[] {
  return Object.entries(obj).flatMap(([key, value]) => {
    const formattedKey = camelToKebab(key);
    if (value === true) return [`--${formattedKey}`];
    if (value === false || value === undefined || value === null) return [];
    return [`--${formattedKey}=${value}`];
  });
}

function spawnGit(args: string[], options: SpawnOptions = {}): Readable {
  const child = spawn("git", args, options);
  const stdout = new PassThrough();
  let stderrData = "";
  const MAX_STDERR = 1024 * 10; // todo: evaluate if i even need this

  child.stderr?.on("data", (chunk) => {
    const chunkStr = chunk.toString("utf8");
    if (stderrData.length < MAX_STDERR) {
      stderrData += chunkStr.slice(0, MAX_STDERR - stderrData.length);
    }
  });

  child.stdout?.pipe(stdout, { end: false });

  child.on("error", (err) => stdout.destroy(err));
  child.on("close", (code) => {
    if (code !== 0) {
      stdout.destroy(new Error(`git log failed:\n\n${stderrData}`));
    } else {
      stdout.end();
    }
  });

  return stdout;
}

function createSplitter(delimiter: string): Transform {
  let buffer = "";
  return new Transform({
    transform(chunk: Buffer, enc, callback: TransformCallback) {
      buffer += chunk.toString("utf8");
      let idx;
      while ((idx = buffer.indexOf(delimiter)) !== -1) {
        this.push(buffer.slice(0, idx));
        buffer = buffer.slice(idx + delimiter.length);
      }
      callback();
    },
    flush(callback: TransformCallback) {
      if (buffer.trim()) {
        this.push(buffer);
      }
      callback();
    },
  });
}

interface ParsedObject {
  [key: string]: ParsedValue;
}

type ParsedValue = string | Date | ParsedObject;

function setPath(obj: Record<string, ParsedValue>, path: string[], value: ParsedValue): void {
  let current: Record<string, ParsedValue> = obj;
  for (let i = 0; i < path.length - 1; i++) {
    const segment = path[i];
    const next = current[segment];
    if (next === undefined || typeof next !== "object") {
      const newObj: ParsedObject = {};
      current[segment] = newObj;
      current = newObj;
    } else {
      current = next as ParsedObject;
    }
  }
  current[path[path.length - 1]] = value;
}

function createParser(fieldMap: MappedField[]): Transform {
  return new Transform({
    objectMode: true,
    transform(chunk: Buffer, enc, callback: TransformCallback) {
      const fieldValues = chunk.toString("utf8").split(FIELD);
      const parsed: Record<string, ParsedValue> = {};

      fieldMap.forEach((field, index) => {
        const value = fieldValues[index] ?? "";
        const finalValue: ParsedValue = field.type ? new field.type(value) : value;
        setPath(parsed, field.path, finalValue);
      });

      callback(null, parsed);
    },
  });
}

export function parseLogStream(
  config: Readonly<Record<string, CliArgValue>> = {},
  options: SpawnOptions = {},
): Readable {
  const fieldMap = fieldsMap();
  const format = fieldMap.map((f) => `%${f.key}`).join(FIELD) + END;
  const args = ["log", ...formatArgs({ ...config, format })];

  const output = new PassThrough({ objectMode: true });

  pipeline(
    spawnGit(args, options),
    createSplitter(END + "\n"),
    createParser(fieldMap),
    output,
    (err) => {
      if (err) output.destroy(err);
    },
  );

  return output;
}

export const fields: FieldConfigObject = fieldsConfig;
