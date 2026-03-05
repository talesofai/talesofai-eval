import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { parseFrontmatter } from "../utils/frontmatter.ts";

export type SkillMeta = {
  name: string;
  description: string;
  filePath: string;
  baseDir: string;
};

export const SKILLS_DIR = join(import.meta.dirname, "evals-skills", "skills");

/**
 * Validate skill name per agentskills.io spec:
 * - Lowercase letters, numbers, hyphens only
 * - No consecutive hyphens
 * - No leading or trailing hyphens
 * - Must match parent directory name
 */
export function isValidSkillName(name: string): boolean {
  return (
    /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(name) && !name.includes("--")
  );
}

// Module-level cache for skill list
let skillListCache: SkillMeta[] | null = null;
const RESOLVED_SKILLS_DIR = resolve(SKILLS_DIR);

/**
 * List all available skill metadata (name + description only, no full content).
 * Results are cached for the module lifetime.
 */
export function listSkills(): SkillMeta[] {
  if (skillListCache !== null) {
    return skillListCache;
  }

  const skills: SkillMeta[] = [];

  if (!existsSync(SKILLS_DIR)) {
    skillListCache = skills;
    return skills;
  }

  const entries = readdirSync(SKILLS_DIR, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const skillName = entry.name;
    const skillPath = join(SKILLS_DIR, skillName, "SKILL.md");

    if (!existsSync(skillPath)) {
      process.stderr.write(
        `[WARN] Skill directory "${skillName}" has no SKILL.md, skipping\n`,
      );
      continue;
    }

    const content = readFileSync(skillPath, "utf-8");
    const { frontmatter, body } = parseFrontmatter(content);

    const name =
      typeof frontmatter["name"] === "string" ? frontmatter["name"] : undefined;
    const description =
      typeof frontmatter["description"] === "string"
        ? frontmatter["description"].trim()
        : body.slice(0, 200).trim();

    if (!isValidSkillName(skillName)) {
      process.stderr.write(
        `[WARN] Skill directory "${skillName}" is not a valid skill name, skipping\n`,
      );
      continue;
    }

    // Validate name matches directory name (agentskills.io spec)
    if (!name) {
      process.stderr.write(
        `[WARN] Skill "${skillName}" missing frontmatter name, skipping\n`,
      );
      continue;
    }

    if (name !== skillName) {
      process.stderr.write(
        `[WARN] Skill "${skillName}" has frontmatter name "${name}" which doesn't match directory name, skipping\n`,
      );
      continue;
    }

    skills.push({
      name: skillName,
      description,
      filePath: skillPath,
      baseDir: join(SKILLS_DIR, skillName),
    });
  }

  skillListCache = skills;
  return skills;
}

/**
 * Load full skill content by name.
 * Validates skill name format and ensures resolved path is within SKILLS_DIR.
 */
export function loadSkillContent(skillName: string): string {
  // Validate skill name format
  if (!isValidSkillName(skillName)) {
    throw new Error(`Invalid skill name: "${skillName}"`);
  }

  const skillPath = join(SKILLS_DIR, skillName, "SKILL.md");

  // Security: ensure resolved path is within SKILLS_DIR (prevent path traversal)
  const resolvedPath = resolve(skillPath);
  if (
    resolvedPath !== RESOLVED_SKILLS_DIR &&
    !resolvedPath.startsWith(`${RESOLVED_SKILLS_DIR}${sep}`)
  ) {
    throw new Error("Invalid skill path: path traversal attempt detected");
  }

  if (!existsSync(skillPath)) {
    throw new Error(`Skill not found: ${skillName}`);
  }

  const content = readFileSync(skillPath, "utf-8");

  // Warn if content is empty
  if (!content.trim()) {
    process.stderr.write(
      `[WARN] Skill "${skillName}" has empty content\n`,
    );
  }

  return content;
}

/**
 * Format skill list for system prompt (agentskills.io XML format).
 * Uses skill name as location (for tool-based agent, not file path).
 */
export function formatSkillsForPrompt(skills: SkillMeta[]): string {
  if (skills.length === 0) {
    return "";
  }

  const skillEntries = skills
    .map((skill) => {
      const name = escapeXml(skill.name);
      const description = escapeXml(skill.description);
      return `<skill name="${name}" location="${name}">\n<description>\n${description}\n</description>\n</skill>`;
    })
    .join("\n\n");

  return `<available_skills>\n${skillEntries}\n</available_skills>`;
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

/**
 * Clear the skill list cache (useful for testing).
 */
export function clearSkillCache(): void {
  skillListCache = null;
}