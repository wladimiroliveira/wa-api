export type SchemaViolation = {
  model: string;
  field: string | null;
  rule: string;
  message: string;
};

type Block = { kind: "model" | "enum"; name: string; body: string };
type Field = { name: string; type: string; attributes: string };

const SCALAR_TYPES = new Set(["String", "Boolean", "Int", "BigInt", "Float", "Decimal", "DateTime", "Json", "Bytes"]);
const SNAKE_CASE = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;

function parseBlocks(source: string): Block[] {
  const blocks: Block[] = [];
  const blockPattern = /^(model|enum)\s+(\w+)\s*\{([\s\S]*?)^\}/gm;

  for (const match of source.matchAll(blockPattern)) {
    blocks.push({ kind: match[1] as Block["kind"], name: match[2], body: match[3] });
  }

  return blocks;
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
  const blocks = parseBlocks(source);
  const enumNames = new Set(blocks.filter((block) => block.kind === "enum").map((block) => block.name));

  for (const model of blocks.filter((block) => block.kind === "model")) {
    const report = (field: string | null, rule: string, message: string) => {
      violations.push({ model: model.name, field, rule, message });
    };

    const tableName = readQuotedArgument(model.body, /@@map\("([^"]+)"\)/);

    if (tableName === null) {
      report(null, "table-map", "model does not declare @@map");
    } else if (!SNAKE_CASE.test(tableName)) {
      report(null, "table-snake-case", `table "${tableName}" is not snake_case`);
    } else if (!tableName.endsWith("s")) {
      report(null, "table-plural", `table "${tableName}" is not plural`);
    }

    for (const [index] of model.body.matchAll(/@@index\([^\n]*\)/g)) {
      const indexName = readQuotedArgument(index, /map:\s*"([^"]+)"/);

      if (indexName === null) {
        report(null, "index-map", "@@index without an explicit map, whose generated name can be truncated");
      } else if (!indexName.startsWith("idx_")) {
        report(null, "index-prefix", `index "${indexName}" does not start with idx_`);
      }
    }

    const scalarFields = parseFields(model.body).filter(
      (field) => SCALAR_TYPES.has(field.type) || enumNames.has(field.type),
    );

    for (const field of scalarFields) {
      const column = readQuotedArgument(field.attributes, /@map\("([^"]+)"\)/) ?? field.name;
      const isPrimaryKey = /@id\b/.test(field.attributes);
      const isForeignKey = !isPrimaryKey && field.name.endsWith("Id");

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
