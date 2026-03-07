import * as readline from "node:readline";
import pc from "picocolors";
import type { GeneratedSkillCase } from "../skill-case-scaffold.ts";

type CasePreview = {
  index: number;
  selected: boolean;
  workflow: string;
  description: string;
  case: GeneratedSkillCase;
};

/**
 * Shows an interactive confirmation UI for selecting cases to save.
 * Returns the selected cases, or throws if user quits.
 */
export async function showConfirmUI(
  cases: GeneratedSkillCase[],
  skillName: string,
): Promise<GeneratedSkillCase[]> {
  if (cases.length === 0) {
    return [];
  }

  // Initialize all cases as selected
  const previews: CasePreview[] = cases.map((c, i) => ({
    index: i + 1,
    selected: true,
    workflow: extractWorkflowName(c.id),
    description: c.description,
    case: c,
  }));

  return new Promise((resolve, reject) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stderr,
    });

    // Set raw mode for single keypress
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }

    const cleanup = () => {
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(false);
      }
      rl.close();
    };

    const render = () => {
      // Clear previous output
      process.stderr.write("\x1b[2J\x1b[H");

      // Header
      process.stderr.write(
        pc.bold(`Generated ${cases.length} cases for skill '${skillName}':\n\n`),
      );

      // Cases list
      for (const preview of previews) {
        const checkbox = preview.selected ? pc.green("✅") : "⬜";
        const line = `  [${preview.index}] ${checkbox} ${pc.cyan(preview.workflow)} - ${preview.description}\n`;
        process.stderr.write(line);
      }

      // Actions
      process.stderr.write(
        `\nActions: [a]ll | [n]one | [1-${cases.length}] toggle | [q]uit | [Enter] save selected\n`,
      );
    };

    const handleKey = (key: Buffer) => {
      const char = key.toString("utf8");

      // Handle Ctrl+C
      if (char === "\u0003") {
        cleanup();
        reject(new Error("User cancelled"));
        return;
      }

      // Handle 'q' - quit
      if (char === "q" || char === "Q") {
        cleanup();
        reject(new Error("User quit without saving"));
        return;
      }

      // Handle 'a' - select all
      if (char === "a" || char === "A") {
        for (const p of previews) {
          p.selected = true;
        }
        render();
        return;
      }

      // Handle 'n' - select none
      if (char === "n" || char === "N") {
        for (const p of previews) {
          p.selected = false;
        }
        render();
        return;
      }

      // Handle Enter - confirm selection
      if (char === "\r" || char === "\n") {
        cleanup();
        const selected = previews.filter((p) => p.selected).map((p) => p.case);
        resolve(selected);
        return;
      }

      // Handle number keys (1-9) for toggling
      const num = parseInt(char, 10);
      if (!isNaN(num) && num >= 1 && num <= previews.length) {
        const preview = previews[num - 1];
        if (preview) {
          preview.selected = !preview.selected;
          render();
        }
      }
    };

    // Initial render
    render();

    // Listen for keypress
    process.stdin.on("data", handleKey);
  });
}

/**
 * Extracts workflow name from case id.
 * Format: skill-{skillName}-{mode}-{workflowName}
 * Handles skill names with hyphens by finding the mode marker.
 */
function extractWorkflowName(caseId: string): string {
  const discoverMarker = "-discover-";
  const injectMarker = "-inject-";

  const dIdx = caseId.indexOf(discoverMarker);
  if (dIdx !== -1) {
    return caseId.slice(dIdx + discoverMarker.length) || "unknown";
  }

  const iIdx = caseId.indexOf(injectMarker);
  if (iIdx !== -1) {
    return caseId.slice(iIdx + injectMarker.length) || "unknown";
  }

  return caseId.split("-").pop() || "unknown";
}
