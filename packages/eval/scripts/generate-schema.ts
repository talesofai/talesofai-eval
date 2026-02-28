import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { zodToJsonSchema } from "zod-to-json-schema";
import { evalCaseSchemaRaw } from "../src/loader/yaml.ts";

const schemaPath = resolve(process.cwd(), "eval-case.schema.json");
const jsonSchema = zodToJsonSchema(evalCaseSchemaRaw, "EvalCase");

writeFileSync(schemaPath, JSON.stringify(jsonSchema, null, 2), "utf8");
