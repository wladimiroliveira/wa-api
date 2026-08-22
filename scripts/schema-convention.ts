export type SchemaViolation = {
  model: string;
  field: string | null;
  rule: string;
  message: string;
};

type Block = { kind: "model" | "enum"; name: string; body: string };
type Field = { name: string; type: string; attributes: string };
type Call = { keyword: string; text: string };

const SCALAR_TYPES = new Set(["String", "Boolean", "Int", "BigInt", "Float", "Decimal", "DateTime", "Json", "Bytes"]);
const SNAKE_CASE = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;

function stripComments(source: string): string {
  let result = "";
  let quoted = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];

    if (quoted) {
      result += char;
      if (char === '"' || char === "\n") quoted = false;
      continue;
    }

    if (char === '"') {
      quoted = true;
      result += char;
      continue;
    }

    if (char === "/" && source[index + 1] === "/") {
      while (index < source.length && source[index] !== "\n") index += 1;
      result += "\n";
      continue;
    }

    result += char;
  }

  return result;
}

function parseBlocks(source: string): Block[] {
  const blocks: Block[] = [];
  const blockPattern = /^[ \t]*(model|enum)\s+(\w+)\s*\{([\s\S]*?)^[ \t]*\}/gm;

  for (const match of source.matchAll(blockPattern)) {
    blocks.push({ kind: match[1] as Block["kind"], name: match[2], body: match[3] });
  }

  return blocks;
}

// Reads every call that `opener` starts, up to its matching closing parenthesis, so a
// hand-wrapped declaration spanning several lines is still seen as one declaration.
function parseCalls(source: string, opener: RegExp): Call[] {
  const calls: Call[] = [];

  for (const match of source.matchAll(opener)) {
    const start = match.index + match[0].length;
    let depth = 1;
    let quoted = false;
    let index = start;

    for (; index < source.length && depth > 0; index += 1) {
      const char = source[index];

      if (quoted) {
        if (char === '"') quoted = false;
        continue;
      }

      if (char === '"') quoted = true;
      else if (char === "(") depth += 1;
      else if (char === ")") depth -= 1;
    }

    if (depth === 0) {
      calls.push({ keyword: match[1] ?? match[0], text: source.slice(match.index, index) });
    }
  }

  return calls;
}

function parseFields(body: string): Field[] {
  const fields: Field[] = [];

  for (const rawLine of body.split("\n")) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("//") || line.startsWith("@@")) continue;

    const match = /^(\w+)\s+(\w+)(?:\[\])?\??\s*(.*)$/.exec(line);
    if (match === null) continue;

    fields.push({ name: match[1], type: match[2], attributes: match[3] });
  }

  return fields;
}

function readQuotedArgument(source: string, pattern: RegExp): string | null {
  const match = pattern.exec(source);
  return match === null ? null : match[1];
}

export function findSchemaConventionViolations(source: string): SchemaViolation[] {
  const violations: SchemaViolation[] = [];
  const blocks = parseBlocks(stripComments(source));
  const enumNames = new Set(blocks.filter((block) => block.kind === "enum").map((block) => block.name));

  for (const model of blocks.filter((block) => block.kind === "model")) {
    const report = (field: string | null, rule: string, message: string) => {
      violations.push({ model: model.name, field, rule, message });
    };

    const tableName = readQuotedArgument(model.body, /@@map\(\s*"([^"]+)"\s*\)/);

    if (tableName === null) {
      report(null, "table-map", "model does not declare @@map");
    } else if (!SNAKE_CASE.test(tableName)) {
      report(null, "table-snake-case", `table "${tableName}" is not snake_case`);
    } else if (!tableName.endsWith("s")) {
      report(null, "table-plural", `table "${tableName}" is not plural`);
    }

    for (const { keyword, text: constraint } of parseCalls(model.body, /@@(index|unique)\s*\(/g)) {
      const isIndex = keyword === "index";
      const prefix = isIndex ? "idx_" : "uq_";
      const mapRule = isIndex ? "index-map" : "unique-map";
      const prefixRule = isIndex ? "index-prefix" : "unique-prefix";
      const label = isIndex ? "@@index" : "@@unique";
      const constraintName = readQuotedArgument(constraint, /map:\s*"([^"]+)"/);

      if (constraintName === null) {
        report(null, mapRule, `${label} without an explicit map, whose generated name can be truncated`);
      } else if (!constraintName.startsWith(prefix)) {
        const kind = isIndex ? "index" : "unique constraint";
        report(null, prefixRule, `${kind} "${constraintName}" does not start with ${prefix}`);
      }
    }

    const scalarFields = parseFields(model.body).filter(
      (field) => SCALAR_TYPES.has(field.type) || enumNames.has(field.type),
    );

    for (const field of scalarFields) {
      const column = readQuotedArgument(field.attributes, /@map\("([^"]+)"\)/) ?? field.name;
      const isPrimaryKey = /@id\b/.test(field.attributes);
      const isForeignKey = !isPrimaryKey && (field.name.endsWith("Id") || column.endsWith("_id"));

      if (!SNAKE_CASE.test(column)) {
        report(field.name, "column-snake-case", `column "${column}" is not snake_case`);
      }

      if (field.type === "String" && (isPrimaryKey || isForeignKey) && !/@db\.Uuid\b/.test(field.attributes)) {
        report(field.name, "uuid-native-type", "identifier without @db.Uuid becomes TEXT instead of UUID");
      }

      if (isForeignKey && !column.endsWith("_id")) {
        report(field.name, "foreign-key-suffix", `foreign key column "${column}" does not end with _id`);
      }

      if (field.type === "Decimal" && !/@db\.Decimal\(\d+,\s*\d+\)/.test(field.attributes)) {
        report(field.name, "decimal-precision", "Decimal without @db.Decimal(p, s) becomes numeric(65,30)");
      }

      if (field.type === "DateTime") {
        if (!/@db\.Timestamptz\(3\)/.test(field.attributes)) {
          report(field.name, "timestamptz", "DateTime without @db.Timestamptz(3)");
        }

        if (!field.name.endsWith("At")) {
          report(field.name, "datetime-suffix", `DateTime field "${field.name}" does not end with At`);
        }
      }

      if (field.type === "Boolean" && !/^(is|has)[A-Z]/.test(field.name)) {
        report(field.name, "boolean-prefix", `Boolean field "${field.name}" starts with neither is nor has`);
      }
    }
  }

  return violations;
}
