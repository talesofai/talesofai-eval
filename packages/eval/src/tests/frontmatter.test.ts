import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseFrontmatter } from "../utils/frontmatter.ts";

describe("parseFrontmatter", () => {
  it("parses yaml frontmatter and body", () => {
    const input = `---
name: write-judge-prompt
description: test description
---
# Title\nBody`;

    const parsed = parseFrontmatter(input);

    assert.equal(parsed.frontmatter["name"], "write-judge-prompt");
    assert.equal(parsed.frontmatter["description"], "test description");
    assert.equal(parsed.body, "# Title\nBody");
  });

  it("returns empty frontmatter when missing", () => {
    const input = "# No frontmatter\ncontent";
    const parsed = parseFrontmatter(input);

    assert.deepEqual(parsed.frontmatter, {});
    assert.equal(parsed.body, input);
  });

  it("returns original content when frontmatter is malformed", () => {
    const input = `---
name: [invalid
---
body`;
    const parsed = parseFrontmatter(input);

    assert.deepEqual(parsed.frontmatter, {});
    assert.equal(parsed.body, input);
  });
});
