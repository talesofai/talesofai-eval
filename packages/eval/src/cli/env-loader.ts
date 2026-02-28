import { config } from "dotenv";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";

function getSearchDirs(startDir: string): string[] {
  const dirs: string[] = [];
  let current = resolve(startDir);

  while (true) {
    dirs.push(current);
    const parent = dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }

  return dirs;
}

function makePath(dir: string, filename: string): string {
  return `${dir}/${filename}`;
}

export function autoLoadEnvFiles(cwd: string = process.cwd()): void {
  if (process.env["AGENT_EVAL_DISABLE_ENV_AUTOLOAD"] === "1") {
    return;
  }

  const dirs = getSearchDirs(cwd);
  // 从最近到最远加载，远处的配置不应覆盖近处的
  for (const dir of dirs) {
    const localEnvPath = makePath(dir, ".env.local");
    const envPath = makePath(dir, ".env");

    if (existsSync(localEnvPath)) {
      config({ path: localEnvPath, override: false });
    }
    if (existsSync(envPath)) {
      config({ path: envPath, override: false });
    }
  }
}
