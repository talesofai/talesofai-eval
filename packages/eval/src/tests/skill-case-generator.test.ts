import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  parseWorkflowIdentificationResponse,
  type IdentifiedWorkflow,
} from "../skill-case-scaffold.ts";

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
});
