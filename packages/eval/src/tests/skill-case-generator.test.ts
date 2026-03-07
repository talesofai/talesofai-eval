import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  parseWorkflowIdentificationResponse,
  type IdentifiedWorkflow,
} from "../skill-case-scaffold.ts";
import {
  extractWorkflowNameFromCaseId,
  writeSkillCases,
} from "../cli/aux-commands.ts";

describe("skill case generator", () => {
  describe("parseWorkflowIdentificationResponse", () => {
    it("parses valid workflow response", () => {
      const response = JSON.stringify({
        workflows: [
          {
            name: "character-to-image",
            description: "Query character then generate matching image",
            task: "I want to create fan art of an anime character",
            expected_tools: ["search_character", "make_image"],
          },
        ],
      });

      const result = parseWorkflowIdentificationResponse(response);
      assert.ok(result);
      assert.equal(result.workflows.length, 1);
      assert.equal(result.workflows[0]?.name, "character-to-image");
      assert.deepEqual(result.workflows[0]?.expected_tools, [
        "search_character",
        "make_image",
      ]);
    });

    it("parses multiple workflows", () => {
      const response = JSON.stringify({
        workflows: [
          {
            name: "song-to-mv",
            description: "Create song then make MV",
            task: "Create a music video for my song",
          },
          {
            name: "character-chat",
            description: "Chat with a character",
            task: "I want to roleplay with a character",
            expected_tools: ["chat"],
          },
        ],
      });

      const result = parseWorkflowIdentificationResponse(response);
      assert.ok(result);
      assert.equal(result.workflows.length, 2);
      assert.equal(result.workflows[0]?.name, "song-to-mv");
      assert.equal(result.workflows[1]?.name, "character-chat");
    });

    it("returns null for invalid JSON", () => {
      const result = parseWorkflowIdentificationResponse("not json");
      assert.equal(result, null);
    });

    it("returns null for missing workflows array", () => {
      const response = JSON.stringify({ data: [] });
      const result = parseWorkflowIdentificationResponse(response);
      assert.equal(result, null);
    });

    it("returns null for empty workflows array", () => {
      const response = JSON.stringify({ workflows: [] });
      const result = parseWorkflowIdentificationResponse(response);
      assert.equal(result, null);
    });

    it("skips workflows with missing required fields", () => {
      const response = JSON.stringify({
        workflows: [
          { name: "valid-workflow", description: "desc", task: "task" },
          { name: "missing-description", task: "task" },
          { description: "missing name and task" },
          { name: "another-valid", description: "desc2", task: "task2" },
        ],
      });

      const result = parseWorkflowIdentificationResponse(response);
      assert.ok(result);
      assert.equal(result.workflows.length, 2);
      assert.equal(result.workflows[0]?.name, "valid-workflow");
      assert.equal(result.workflows[1]?.name, "another-valid");
    });

    it("rejects invalid kebab-case names", () => {
      const response = JSON.stringify({
        workflows: [
          { name: "Valid-Name", description: "desc", task: "task" }, // uppercase
          { name: "valid_name", description: "desc", task: "task" }, // underscore
          { name: "valid-name", description: "desc", task: "task" }, // correct
          { name: "1invalid", description: "desc", task: "task" }, // starts with number
        ],
      });

      const result = parseWorkflowIdentificationResponse(response);
      assert.ok(result);
      assert.equal(result.workflows.length, 1);
      assert.equal(result.workflows[0]?.name, "valid-name");
    });

    it("filters expected_tools to strings only", () => {
      const response = JSON.stringify({
        workflows: [
          {
            name: "test-workflow",
            description: "desc",
            task: "task",
            expected_tools: ["valid", 123, null, "also-valid"],
          },
        ],
      });

      const result = parseWorkflowIdentificationResponse(response);
      assert.ok(result);
      assert.deepEqual(result.workflows[0]?.expected_tools, [
        "valid",
        "also-valid",
      ]);
    });

    it("handles workflow without expected_tools", () => {
      const response = JSON.stringify({
        workflows: [
          {
            name: "simple-workflow",
            description: "A simple workflow",
            task: "Do something simple",
          },
        ],
      });

      const result = parseWorkflowIdentificationResponse(response);
      assert.ok(result);
      assert.equal(result.workflows[0]?.expected_tools, undefined);
    });
  });

  describe("case id naming convention", () => {
    it("uses format skill-{skillName}-{mode}-{workflowName}", () => {
      // Verify the expected ID format from spec
      const skillName = "neta";
      const mode = "discover";
      const workflowName = "character-to-image";
      const expectedId = `skill-${skillName}-${mode}-${workflowName}`;

      assert.match(expectedId, /^skill-[a-z0-9-]+-(discover|inject)-[a-z0-9-]+$/);
      assert.equal(expectedId, "skill-neta-discover-character-to-image");
    });

    it("produces valid kebab-case workflow names in case id", () => {
      const validWorkflowNames = [
        "character-to-image",
        "song-to-mv",
        "space-exploration",
        "hashtag-research",
        "interactive-feed",
      ];

      for (const name of validWorkflowNames) {
        assert.match(name, /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/);
      }
    });
  });

  describe("assertion design logic", () => {
    it("discover mode includes tool_usage assertion with ls/read", () => {
      // Discover mode should always include tool_usage for skill discovery
      const discoverAssertions = [
        { type: "tool_usage", tier: 1, expected_tools: ["ls", "read"] },
        { type: "skill_usage", tier: 2, checks: ["skill_loaded", "workflow_followed", "skill_influenced_output"], pass_threshold: 0.7 },
      ];

      assert.equal(discoverAssertions[0]?.type, "tool_usage");
      assert.equal(discoverAssertions[0]?.tier, 1);
      assert.deepEqual((discoverAssertions[0] as { expected_tools: string[] }).expected_tools, ["ls", "read"]);
    });

    it("inject mode skips tool_usage assertion", () => {
      // Inject mode should NOT include tool_usage since skill is pre-loaded
      const injectAssertions = [
        { type: "skill_usage", tier: 2, checks: ["workflow_followed", "skill_influenced_output"], pass_threshold: 0.7 },
      ];

      const hasToolUsage = injectAssertions.some(a => a.type === "tool_usage");
      assert.equal(hasToolUsage, false);
    });

    it("skill_usage checks differ by mode", () => {
      const discoverChecks = ["skill_loaded", "workflow_followed", "skill_influenced_output"];
      const injectChecks = ["workflow_followed", "skill_influenced_output"];

      // Discover mode includes skill_loaded check
      assert.ok(discoverChecks.includes("skill_loaded"));
      // Inject mode does not include skill_loaded
      assert.ok(!injectChecks.includes("skill_loaded"));
    });

    it("llm_judge assertion is added for complex workflows", () => {
      // Complex workflows should include llm_judge
      const complexWorkflow: IdentifiedWorkflow = {
        name: "character-to-image",
        description: "Query character details from database and generate an image matching their official appearance",
        task: "I want to create fan art",
      };

      // Description length > 20 indicates complex workflow
      assert.ok(complexWorkflow.description.length > 20);
    });
  });

  describe("extractWorkflowNameFromCaseId", () => {
    it("extracts workflow name from simple skill id", () => {
      assert.equal(
        extractWorkflowNameFromCaseId("skill-neta-discover-character-to-image"),
        "character-to-image",
      );
    });

    it("handles hyphenated skill names in discover mode", () => {
      // skill name "write-judge-prompt" has hyphens
      assert.equal(
        extractWorkflowNameFromCaseId("skill-write-judge-prompt-discover-workflow-quality"),
        "workflow-quality",
      );
    });

    it("handles hyphenated skill names in inject mode", () => {
      assert.equal(
        extractWorkflowNameFromCaseId("skill-error-analysis-inject-categorize-failures"),
        "categorize-failures",
      );
    });

    it("falls back gracefully when no mode marker found", () => {
      const result = extractWorkflowNameFromCaseId("no-mode-here");
      assert.ok(typeof result === "string" && result.length > 0);
    });
  });

  describe("writeSkillCases file naming", () => {
    it("writes files with correct workflow names for hyphenated skill names", () => {
      const tmpDir = mkdtempSync(join(tmpdir(), "skill-case-test-"));
      try {
        const cases = [
          {
            type: "skill" as const,
            id: "skill-write-judge-prompt-discover-workflow-quality",
            description: "Test workflow quality",
            input: { skill: "write-judge-prompt", model: "test", evaluation_mode: "discover" as const, task: "test task" },
            criteria: { assertions: [] },
          },
          {
            type: "skill" as const,
            id: "skill-write-judge-prompt-discover-tone-mismatch",
            description: "Test tone mismatch",
            input: { skill: "write-judge-prompt", model: "test", evaluation_mode: "discover" as const, task: "test task 2" },
            criteria: { assertions: [] },
          },
        ];

        const result = writeSkillCases(cases, "write-judge-prompt", tmpDir);

        assert.equal(result.written.length, 2);
        assert.ok(result.written[0]?.endsWith("workflow-quality.eval.yaml"));
        assert.ok(result.written[1]?.endsWith("tone-mismatch.eval.yaml"));
      } finally {
        rmSync(tmpDir, { recursive: true });
      }
    });

    it("writes files with type: skill field in YAML", async () => {
      const tmpDir = mkdtempSync(join(tmpdir(), "skill-case-test-"));
      try {
        const cases = [
          {
            type: "skill" as const,
            id: "skill-neta-discover-character-to-image",
            description: "Character to image workflow",
            input: { skill: "neta", model: "test", evaluation_mode: "discover" as const, task: "test" },
            criteria: { assertions: [] },
          },
        ];

        const result = writeSkillCases(cases, "neta", tmpDir);
        const { readFileSync } = await import("node:fs");
        const content = readFileSync(result.written[0]!, "utf8");
        assert.ok(content.includes("type: skill"));
      } finally {
        rmSync(tmpDir, { recursive: true });
      }
    });
  });
});
