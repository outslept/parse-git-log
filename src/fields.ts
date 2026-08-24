export type FieldType = new (value: string) => Date | string;

export interface FieldConfigObject {
  [key: string]: string | FieldType | FieldConfigObject | undefined;
}

export interface MappedField {
  path: string[];
  key: string;
  type?: FieldType;
}

export const config: FieldConfigObject = {
  commit: {
    long: "H",
    short: "h",
  },
  tree: {
    long: "T",
    short: "t",
  },
  author: {
    name: "an",
    email: "ae",
    date: {
      key: "ai",
      type: Date,
    },
  },
  committer: {
    name: "cn",
    email: "ce",
    date: {
      key: "ci",
      type: Date,
    },
  },
  subject: "s",
  body: "b",
};

export function map(obj: FieldConfigObject = config, currentPath: string[] = []): MappedField[] {
  const fields: MappedField[] = [];

  for (const [key, value] of Object.entries(obj)) {
    const path = [...currentPath, key];

    if (typeof value === "string") {
      if (key === "key") {
        fields.push({
          path: currentPath,
          key: value,
          type: typeof obj.type === "function" ? (obj.type as FieldType) : undefined,
        });
      } else {
        fields.push({ path, key: value });
      }
    } else if (value && typeof value === "object") {
      fields.push(...map(value as FieldConfigObject, path));
    }
  }

  return fields;
}
