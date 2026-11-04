import { spawn, type SpawnOptions } from "child_process";
import { Transform, type TransformCallback, pipeline, PassThrough, type Readable } from "stream";
import { StringDecoder } from "string_decoder";
import {
  config as fieldsConfig,
  map as fieldsMap,
  type MappedField,
  type FieldConfigObject,
} from "./fields.js";

const END = "\x1e";
const RECORD_SEP = "\x1e\n";
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
  const MAX_STDERR = 1024 * 10;

  child.stderr?.on("data", (chunk: Buffer) => {
    if (stderrData.length < MAX_STDERR) {
      stderrData += chunk.toString("utf8", 0, MAX_STDERR - stderrData.length);
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

function parseRecord(raw: string, fieldMap: MappedField[]): Record<string, ParsedValue> {
  const parsed: Record<string, ParsedValue> = {};
  let start = 0;

  for (let i = 0; i < fieldMap.length; i++) {
    const field = fieldMap[i];
    let value = "";
    if (start <= raw.length) {
      const next = raw.indexOf(FIELD, start);
      if (next === -1) {
        value = raw.slice(start);
        start = raw.length + 1;
      } else {
        value = raw.slice(start, next);
        start = next + 1;
      }
    }
    setPath(parsed, field.path, field.type ? new field.type(value) : value);
  }

  return parsed;
}

function createParser(fieldMap: MappedField[]): Transform {
  const decoder = new StringDecoder("utf8");
  let buffer = "";

  return new Transform({
    readableObjectMode: true,
    transform(chunk: Buffer, _enc, callback: TransformCallback) {
      buffer += decoder.write(chunk);
      let start = 0;
      let idx: number;
      while ((idx = buffer.indexOf(RECORD_SEP, start)) !== -1) {
        this.push(parseRecord(buffer.slice(start, idx), fieldMap));
        start = idx + RECORD_SEP.length;
      }
      if (start > 0) buffer = buffer.slice(start);
      callback();
    },
    flush(callback: TransformCallback) {
      buffer += decoder.end();
      if (buffer.trim()) {
        this.push(parseRecord(buffer, fieldMap));
      }
      callback();
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
  const parser = createParser(fieldMap);

  pipeline(spawnGit(args, options), parser, (err) => {
    if (err) parser.destroy(err);
  });

  return parser;
}

export const fields: FieldConfigObject = fieldsConfig;
