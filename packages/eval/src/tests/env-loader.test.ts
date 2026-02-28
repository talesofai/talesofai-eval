import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { autoLoadEnvFiles } from "../cli/env-loader.ts";

describe("autoLoadEnvFiles", () => {
  afterEach(() => {
    delete process.env["AGENT_EVAL_DISABLE_ENV_AUTOLOAD"];
    delete process.env["AGENT_EVAL_TEST_KEY"];
    delete process.env["AGENT_EVAL_EXISTING_KEY"];
    delete process.env["AGENT_EVAL_ROOT_ONLY_KEY"];
  });

  it("loads .env.local/.env from cwd and parent dirs", () => {
    const root = mkdtempSync(join(tmpdir(), "agent-eval-env-"));
    const nested = join(root, "packages", "eval");
    mkdirSync(nested, { recursive: true });

    writeFileSync(join(root, ".env.local"), "AGENT_EVAL_ROOT_ONLY_KEY=root\n");
    writeFileSync(join(root, ".env"), "AGENT_EVAL_TEST_KEY=from-root\n");
    writeFileSync(join(nested, ".env.local"), "AGENT_EVAL_TEST_KEY=from-cwd\n");

    autoLoadEnvFiles(nested);

    assert.equal(process.env["AGENT_EVAL_TEST_KEY"], "from-cwd");
    assert.equal(process.env["AGENT_EVAL_ROOT_ONLY_KEY"], "root");
  });

  it("does not override existing env", () => {
    const root = mkdtempSync(join(tmpdir(), "agent-eval-env-"));
    writeFileSync(join(root, ".env.local"), "AGENT_EVAL_EXISTING_KEY=file\n");

    process.env["AGENT_EVAL_EXISTING_KEY"] = "existing";
    autoLoadEnvFiles(root);

    assert.equal(process.env["AGENT_EVAL_EXISTING_KEY"], "existing");
  });

  it("can be disabled by AGENT_EVAL_DISABLE_ENV_AUTOLOAD=1", () => {
    const root = mkdtempSync(join(tmpdir(), "agent-eval-env-"));
    writeFileSync(join(root, ".env.local"), "AGENT_EVAL_TEST_KEY=file\n");

    process.env["AGENT_EVAL_DISABLE_ENV_AUTOLOAD"] = "1";
    autoLoadEnvFiles(root);

    assert.equal(process.env["AGENT_EVAL_TEST_KEY"], undefined);
  });
});
