import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AgentEvalCase, CharacterFromSelect } from "../types.ts";
import {
  extractCharacterCount,
  injectAndReplaceCharacters,
  mapToCharacterAssign,
} from "../utils/character-injector.ts";

const makeMockCharacter = (index: number): CharacterFromSelect => ({
  uuid: `uuid-${index}`,
  name: `Character${index}`,
  biography: {
    age: "25",
    persona: "Friendly",
    interests: "Coding",
    occupation: "Developer",
    description: `A test character ${index}`,
  },
  config: {
    avatar_img: `https://example.com/avatar-${index}.png`,
  },
});

const createMockProvider = (characters: CharacterFromSelect[]) => ({
  getRandomCharacters: async (num: number) => characters.slice(0, num),
});

const createTestCase = (content: string): AgentEvalCase => ({
  type: "agent",
  id: "test-case",
  description: "Test case",
  criteria: {},
  input: {
    preset_key: "test-preset",
    parameters: {},
    messages: [
      {
        role: "user",
        content,
      },
    ],
  },
});

describe("extractCharacterCount", () => {
  it("returns 0 when no placeholders", () => {
    const testCase = createTestCase("Hello world");
    const count = extractCharacterCount(testCase.input);
    assert.equal(count, 0);
  });

  it("extracts count from {@character} placeholder", () => {
    const testCase = createTestCase("Hello {@character}");
    const count = extractCharacterCount(testCase.input);
    assert.equal(count, 1);
  });

  it("extracts count from {@character_0} placeholder", () => {
    const testCase = createTestCase("Hello {@character_0}");
    const count = extractCharacterCount(testCase.input);
    assert.equal(count, 1);
  });

  it("extracts count from {@character0} placeholder (no underscore)", () => {
    const testCase = createTestCase("Hello {@character0}");
    const count = extractCharacterCount(testCase.input);
    assert.equal(count, 1);
  });

  it("extracts max count from {@character_1} placeholder", () => {
    const testCase = createTestCase("Hello {@character_1}");
    const count = extractCharacterCount(testCase.input);
    assert.equal(count, 2);
  });

  it("extracts max count from {@character1} placeholder (no underscore)", () => {
    const testCase = createTestCase("Hello {@character1}");
    const count = extractCharacterCount(testCase.input);
    assert.equal(count, 2);
  });

  it("extracts count from multiple indexed placeholders", () => {
    const testCase = createTestCase("Hello {@character_0} and {@character_2}");
    const count = extractCharacterCount(testCase.input);
    assert.equal(count, 3);
  });

  it("handles mixed {@character} and {@character_N} placeholders", () => {
    const testCase = createTestCase("Hello {@character} and {@character_2}");
    const count = extractCharacterCount(testCase.input);
    assert.equal(count, 3);
  });

  it("handles mixed underscore and no-underscore formats", () => {
    const testCase = createTestCase("Hello {@character0} and {@character_1}");
    const count = extractCharacterCount(testCase.input);
    assert.equal(count, 2);
  });

  it("extracts from parameters", () => {
    const testCase: AgentEvalCase = {
      type: "agent",
      id: "test-case",
      description: "Test case",
      criteria: {},
      input: {
        preset_key: "test-preset",
        parameters: {
          prompt: "Hello {@character_1}",
        },
        messages: [],
      },
    };
    const count = extractCharacterCount(testCase.input);
    assert.equal(count, 2);
  });

  it("extracts from array content", () => {
    const testCase: AgentEvalCase = {
      type: "agent",
      id: "test-case",
      description: "Test case",
      criteria: {},
      input: {
        preset_key: "test-preset",
        parameters: {},
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "Hello {@character_0}" },
              { type: "text", text: "and {@character_1}" },
            ],
          },
        ],
      },
    };
    const count = extractCharacterCount(testCase.input);
    assert.equal(count, 2);
  });

  it("extracts from input_text content parts", () => {
    const testCase: AgentEvalCase = {
      type: "agent",
      id: "test-case",
      description: "Test case",
      criteria: {},
      input: {
        preset_key: "test-preset",
        parameters: {},
        messages: [
          {
            role: "user",
            content: [{ type: "input_text", text: "Hello {@character}" }],
          },
        ],
      },
    };
    const count = extractCharacterCount(testCase.input);
    assert.equal(count, 1);
  });

  it("extracts from output_text content parts", () => {
    const testCase: AgentEvalCase = {
      type: "agent",
      id: "test-case",
      description: "Test case",
      criteria: {},
      input: {
        preset_key: "test-preset",
        parameters: {},
        messages: [
          {
            role: "assistant",
            content: [{ type: "output_text", text: "Hello {@character}" }],
          },
        ],
      },
    };
    const count = extractCharacterCount(testCase.input);
    assert.equal(count, 1);
  });

  it("throws when requesting too many characters", () => {
    const testCase = createTestCase("Hello {@character_9999}");
    assert.throws(() => extractCharacterCount(testCase.input), /max 10/);
  });
});

describe("mapToCharacterAssign", () => {
  it("maps CharacterFromSelect to CharacterAssign", () => {
    const char = makeMockCharacter(0);
    const assign = mapToCharacterAssign(char);

    assert.equal(assign.type, "character");
    assert.equal(assign.uuid, char.uuid);
    assert.equal(assign.name, char.name);
    assert.equal(assign.age, char.biography?.age);
    assert.equal(assign.persona, char.biography?.persona);
    assert.equal(assign.interests, char.biography?.interests);
    assert.equal(assign.occupation, char.biography?.occupation);
    assert.equal(assign.description, char.biography?.description);
    assert.equal(assign.avatar_img, char.config?.avatar_img);
  });

  it("handles missing biography fields", () => {
    const char = {
      uuid: "test-uuid",
      name: "Test",
      biography: {
        age: "",
        persona: "",
        interests: "",
        occupation: "",
        description: "",
      },
      config: {
        avatar_img: "",
      },
    } as CharacterFromSelect;

    const assign = mapToCharacterAssign(char);
    assert.equal(assign.age, "");
    assert.equal(assign.avatar_img, "");
  });
});

describe("injectAndReplaceCharacters", () => {
  it("returns same evalCase when no placeholders", async () => {
    const testCase = createTestCase("Hello world");
    const apis = createMockProvider([makeMockCharacter(0)]);

    const result = await injectAndReplaceCharacters(
      testCase,
      apis,
    );

    assert.strictEqual(result, testCase);
  });

  it("replaces {@character} with character name", async () => {
    const testCase = createTestCase("Hello {@character}");
    const mockChar = makeMockCharacter(0);
    mockChar.name = "Alice";
    const apis = createMockProvider([mockChar]);

    const result = await injectAndReplaceCharacters(
      testCase,
      apis,
    );

    assert.equal(
      (result.input.messages[0] as { content: string }).content,
      "Hello Alice",
    );
  });

  it("replaces {@character_1} with second character name", async () => {
    const testCase = createTestCase("Hello {@character_1}");
    const mockChars = [makeMockCharacter(0), makeMockCharacter(1)];
    const char1 = mockChars[1];
    assert.ok(char1);
    char1.name = "Bob";
    const apis = createMockProvider(mockChars);

    const result = await injectAndReplaceCharacters(
      testCase,
      apis,
    );

    const message = result.input.messages[0];
    assert.ok(message);
    assert.equal((message as { content: string }).content, "Hello Bob");
  });

  it("replaces {@character1} (no underscore) with second character name", async () => {
    const testCase = createTestCase("Hello {@character1}");
    const mockChars = [makeMockCharacter(0), makeMockCharacter(1)];
    const char1 = mockChars[1];
    assert.ok(char1);
    char1.name = "Charlie";
    const apis = createMockProvider(mockChars);

    const result = await injectAndReplaceCharacters(
      testCase,
      apis,
    );

    const message = result.input.messages[0];
    assert.ok(message);
    assert.equal((message as { content: string }).content, "Hello Charlie");
  });

  it("replaces placeholders in input_text parts", async () => {
    const testCase: AgentEvalCase = {
      type: "agent",
      id: "test-case",
      description: "Test case",
      criteria: {},
      input: {
        preset_key: "test-preset",
        parameters: {},
        messages: [
          {
            role: "user",
            content: [{ type: "input_text", text: "Hello {@character}" }],
          },
        ],
      },
    };

    const mockChar = makeMockCharacter(0);
    mockChar.name = "Dave";
    const apis = createMockProvider([mockChar]);

    const result = await injectAndReplaceCharacters(
      testCase,
      apis,
    );

    const msg = result.input.messages[0] as {
      content: Array<{ type: string; text: string }>;
    };
    assert.ok(msg.content[0]);
    assert.equal(msg.content[0].text, "Hello Dave");
  });

  it("replaces placeholders in output_text parts", async () => {
    const testCase: AgentEvalCase = {
      type: "agent",
      id: "test-case",
      description: "Test case",
      criteria: {},
      input: {
        preset_key: "test-preset",
        parameters: {},
        messages: [
          {
            role: "assistant",
            content: [{ type: "output_text", text: "Hello {@character}" }],
          },
        ],
      },
    };

    const mockChar = makeMockCharacter(0);
    mockChar.name = "Eve";
    const apis = createMockProvider([mockChar]);

    const result = await injectAndReplaceCharacters(
      testCase,
      apis,
    );

    const msg = result.input.messages[0] as {
      content: Array<{ type: string; text: string }>;
    };
    assert.ok(msg.content[0]);
    assert.equal(msg.content[0].text, "Hello Eve");
  });

  it("throws when provider fails (fail-fast)", async () => {
    const testCase = createTestCase("Hello {@character}");
    const provider = {
      getRandomCharacters: async () => {
        throw new Error("API Error");
      },
    };

    await assert.rejects(
      async () => await injectAndReplaceCharacters(testCase, provider),
      /API Error/,
    );
  });

  it("throws when placeholders exist but provider is missing", async () => {
    const testCase = createTestCase("Hello {@character}");
    await assert.rejects(
      async () => await injectAndReplaceCharacters(testCase),
      /characterProvider is required/,
    );
  });

  it("preserves original evalCase structure", async () => {
    const testCase: AgentEvalCase = {
      type: "agent",
      id: "test-id",
      description: "Test description",
      criteria: {},
      input: {
        preset_key: "test-preset",
        parameters: { key: "value" },
        messages: [{ role: "user", content: "Hello {@character}" }],
        allowed_tool_names: ["tool1"],
        need_approval_tool_names: ["tool2"],
      },
    };

    const mockChar = makeMockCharacter(0);
    const apis = createMockProvider([mockChar]);

    const result = await injectAndReplaceCharacters(
      testCase,
      apis,
    );

    assert.equal(result.id, testCase.id);
    assert.equal(result.description, testCase.description);
    assert.equal(result.input.preset_key, testCase.input.preset_key);
    assert.deepStrictEqual(result.input.parameters, { key: "value" });
    assert.deepStrictEqual(result.input.allowed_tool_names, ["tool1"]);
    assert.deepStrictEqual(result.input.need_approval_tool_names, ["tool2"]);
  });

  it("does not mutate original evalCase input", async () => {
    const testCase = createTestCase("Hello {@character}");
    const originalContent = (testCase.input.messages[0] as { content: string })
      .content;

    const mockChar = makeMockCharacter(0);
    mockChar.name = "Frank";
    const apis = createMockProvider([mockChar]);

    await injectAndReplaceCharacters(testCase, apis);

    assert.equal(
      (testCase.input.messages[0] as { content: string }).content,
      originalContent,
    );
  });
});
