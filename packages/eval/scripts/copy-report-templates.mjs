import { cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const sourceDir = resolve("src/reporter/templates");
const targetDir = resolve("dist/reporter/templates");

if (!existsSync(sourceDir)) {
  throw new Error(`missing source templates dir: ${sourceDir}`);
}

mkdirSync(dirname(targetDir), { recursive: true });
cpSync(sourceDir, targetDir, { recursive: true });
