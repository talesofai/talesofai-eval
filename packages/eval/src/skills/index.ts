import {
  existsSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
} from "node:fs";
import { homedir } from "node:os";
import { join, resolve as resolvePath, sep } from "node:path";
import { resolveSkillsDir } from "../config.ts";
import type { SkillSourceKind } from "../types.ts";
import { parseFrontmatter } from "../utils/frontmatter.ts";

export type SkillMeta = {
  name: string;
  description: string;
  filePath: string;
  baseDir: string;
};

/**
 * Meta-skills directory: bundled evaluation method skills used BY the framework.
 * These are NOT skills to be evaluated - they are tools for case generation.
 */
export const META_SKILLS_DIR = join(
  import.meta.dirname,
  "evals-skills",
  "skills",
);

/** @deprecated Use META_SKILLS_DIR instead */
export const BUNDLED_SKILLS_DIR = META_SKILLS_DIR;

export type ResolvedSkillsRoot = {
  source: SkillSourceKind;
  rootDir: string;
  canonicalRootDir: string;
};

const skillListCache = new Map<string, SkillMeta[]>();

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

function expandHomeDir(pathValue: string, homeDir: string): string {
  if (pathValue === "~") {
    return homeDir;
  }

  if (pathValue.startsWith(`~${sep}`) || pathValue.startsWith("~/")) {
    return join(homeDir, pathValue.slice(2));
  }

  return pathValue;
}

function isPathWithinRoot(pathValue: string, rootDir: string): boolean {
  return pathValue === rootDir || pathValue.startsWith(`${rootDir}${sep}`);
}

function validateSkillsRoot(
  rootDir: string,
  source: SkillSourceKind = "cli",
): ResolvedSkillsRoot {
  const resolvedRootDir = resolvePath(rootDir);

  if (!existsSync(resolvedRootDir)) {
    throw new Error(`Skills root does not exist: ${resolvedRootDir}`);
  }

  const stats = statSync(resolvedRootDir);
  if (!stats.isDirectory()) {
    throw new Error(`Skills root is not a directory: ${resolvedRootDir}`);
  }

  return {
    source,
    rootDir: resolvedRootDir,
    canonicalRootDir: realpathSync(resolvedRootDir),
  };
}

function loadSkillMetaFromFile(options: {
  rootDir: string;
  canonicalRootDir: string;
  skillName: string;
}): SkillMeta | null {
  const skillPath = join(options.rootDir, options.skillName, "SKILL.md");

  if (!existsSync(skillPath)) {
    process.stderr.write(
      `[WARN] Skill directory "${options.skillName}" has no SKILL.md, skipping\n`,
    );
    return null;
  }

  let canonicalPath: string;
  try {
    canonicalPath = realpathSync(skillPath);
  } catch {
    process.stderr.write(
      `[WARN] Skill "${options.skillName}" could not resolve SKILL.md, skipping\n`,
    );
    return null;
  }

  if (!isPathWithinRoot(canonicalPath, options.canonicalRootDir)) {
    process.stderr.write(
      `[WARN] Skill "${options.skillName}" has invalid skill path: path traversal attempt detected, skipping\n`,
    );
    return null;
  }

  const content = readFileSync(canonicalPath, "utf-8");
  const { frontmatter, body } = parseFrontmatter(content);

  const name =
    typeof frontmatter["name"] === "string" ? frontmatter["name"] : undefined;
  const description =
    typeof frontmatter["description"] === "string"
      ? frontmatter["description"].trim()
      : body.slice(0, 200).trim();

  if (!isValidSkillName(options.skillName)) {
    process.stderr.write(
      `[WARN] Skill directory "${options.skillName}" is not a valid skill name, skipping\n`,
    );
    return null;
  }

  if (!name) {
    process.stderr.write(
      `[WARN] Skill "${options.skillName}" missing frontmatter name, skipping\n`,
    );
    return null;
  }

  if (name !== options.skillName) {
    process.stderr.write(
      `[WARN] Skill "${options.skillName}" has frontmatter name "${name}" which doesn't match directory name, skipping\n`,
    );
    return null;
  }

  return {
    name: options.skillName,
    description,
    filePath: skillPath,
    baseDir: join(options.rootDir, options.skillName),
  };
}

function getValidatedRoot(rootDir: string): ResolvedSkillsRoot {
  return validateSkillsRoot(rootDir, "cli");
}

export function resolveSkillsRoot(options: {
  cliSkillsDir?: string;
  caseSkillsDir?: string;
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
}): ResolvedSkillsRoot {
  const resolvedHomeDir = options.homeDir ?? homedir();
  const envSkillsDir = resolveSkillsDir(options.env ?? process.env);

  const candidates: Array<{ source: SkillSourceKind; rootDir: string }> = [];
  const checkedLocations: string[] = [];

  const pushCandidate = (
    source: SkillSourceKind,
    maybeRootDir: string | undefined,
  ): void => {
    if (!maybeRootDir) {
      return;
    }

    const expandedRootDir = expandHomeDir(maybeRootDir, resolvedHomeDir);
    const absoluteRootDir = resolvePath(expandedRootDir);
    checkedLocations.push(`${source}: ${absoluteRootDir}`);

    if (!existsSync(absoluteRootDir)) {
      return;
    }

    let stats;
    try {
      stats = statSync(absoluteRootDir);
    } catch {
      return;
    }

    if (!stats.isDirectory()) {
      return;
    }

    candidates.push({ source, rootDir: absoluteRootDir });
  };

  pushCandidate("cli", options.cliSkillsDir);
  pushCandidate("case", options.caseSkillsDir);
  pushCandidate("env", envSkillsDir);
  pushCandidate("home", join(resolvedHomeDir, ".agents", "skills"));

  const candidate = candidates[0];
  if (!candidate) {
    throw new Error(
      `No skills root configured. Set --skills-dir, EVAL_SKILLS_DIR, or create ~/.agents/skills. Checked: ${checkedLocations.join(", ")}`,
    );
  }

  const validated = validateSkillsRoot(candidate.rootDir, candidate.source);
  return {
    source: candidate.source,
    rootDir: candidate.rootDir,
    canonicalRootDir: validated.canonicalRootDir,
  };
}

/**
 * List all available skill metadata (name + description only, no full content).
 * Results are cached per canonical root for the module lifetime.
 */
export function listSkillsFromRoot(rootDir: string): SkillMeta[] {
  const validatedRoot = getValidatedRoot(rootDir);
  const cached = skillListCache.get(validatedRoot.canonicalRootDir);
  if (cached) {
    return cached;
  }

  const skills: SkillMeta[] = [];
  const entries = readdirSync(validatedRoot.rootDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const meta = loadSkillMetaFromFile({
      rootDir: validatedRoot.rootDir,
      canonicalRootDir: validatedRoot.canonicalRootDir,
      skillName: entry.name,
    });

    if (meta) {
      skills.push(meta);
    }
  }

  skillListCache.set(validatedRoot.canonicalRootDir, skills);
  return skills;
}

/**
 * Load full skill content by name from a specific root.
 * Validates skill name format, ensures canonical path is within rootDir,
 * and verifies frontmatter is valid.
 */
export function loadSkillContentFromRoot(
  rootDir: string,
  skillName: string,
): string {
  if (!isValidSkillName(skillName)) {
    throw new Error(`Invalid skill name: "${skillName}"`);
  }

  const validatedRoot = getValidatedRoot(rootDir);
  const skillPath = join(validatedRoot.rootDir, skillName, "SKILL.md");

  if (!existsSync(skillPath)) {
    throw new Error(`Skill not found: ${skillName} in ${validatedRoot.rootDir}`);
  }

  let canonicalPath: string;
  try {
    canonicalPath = realpathSync(skillPath);
  } catch {
    throw new Error(`Skill not found: ${skillName} in ${validatedRoot.rootDir}`);
  }

  if (!isPathWithinRoot(canonicalPath, validatedRoot.canonicalRootDir)) {
    throw new Error("Invalid skill path: path traversal attempt detected");
  }

  const content = readFileSync(canonicalPath, "utf-8");
  const { frontmatter } = parseFrontmatter(content);
  const name =
    typeof frontmatter["name"] === "string" ? frontmatter["name"] : undefined;

  if (!name) {
    throw new Error(`Skill "${skillName}" missing frontmatter name`);
  }

  if (name !== skillName) {
    throw new Error(
      `Skill "${skillName}" has frontmatter name "${name}" which doesn't match directory name`,
    );
  }

  if (!content.trim()) {
    process.stderr.write(`[WARN] Skill "${skillName}" has empty content\n`);
  }

  return content;
}

export function listSkills(): SkillMeta[] {
  return listSkillsFromRoot(BUNDLED_SKILLS_DIR);
}

export function loadSkillContent(skillName: string): string {
  return loadSkillContentFromRoot(BUNDLED_SKILLS_DIR, skillName);
}

/**
 * List bundled meta-skills (evaluation methods).
 * These are skills used BY the evaluation framework, not skills being evaluated.
 */
export function listMetaSkills(): SkillMeta[] {
  return listSkillsFromRoot(META_SKILLS_DIR);
}

/**
 * Load a meta-skill by name.
 * Used by draft-skill-case to generate intelligent test cases.
 */
export function loadMetaSkillContent(skillName: string): string {
  return loadSkillContentFromRoot(META_SKILLS_DIR, skillName);
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

export function clearSkillCache(): void {
  skillListCache.clear();
}
