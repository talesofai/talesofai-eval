import YAML from "yaml";

/**
 * Parse YAML frontmatter from a markdown file.
 * Returns { frontmatter, body } where frontmatter is the parsed object
 * and body is the markdown content after the frontmatter block.
 */
export function parseFrontmatter(content: string): {
  frontmatter: Record<string, unknown>;
  body: string;
} {
  const fmRegex = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;
  const match = content.match(fmRegex);

  if (!match) {
    return { frontmatter: {}, body: content };
  }

  try {
    const frontmatter = YAML.parse(match[1]!) as Record<string, unknown>;
    return {
      frontmatter:
        frontmatter &&
        typeof frontmatter === "object" &&
        !Array.isArray(frontmatter)
          ? frontmatter
          : {},
      body: match[2]!,
    };
  } catch {
    return { frontmatter: {}, body: content };
  }
}