import { Type } from "@mariozechner/pi-ai";
import { isValidSkillName, loadSkillContent } from "../../skills/index.ts";
import type { BuiltinTool } from "../minimal-agent/types.ts";

export const readSkillTool: BuiltinTool = {
  name: "read_skill",
  description: "Read a skill file by name to load its full instructions.",
  parameters: Type.Object({
    skill_name: Type.String({
      description: "Name of the skill to load (e.g., 'write-judge-prompt')",
    }),
  }),
  execute: (args) => {
    const skillName = args["skill_name"];

    if (typeof skillName !== "string" || skillName.trim().length === 0) {
      return 'Error: Missing required argument "skill_name".';
    }

    if (!isValidSkillName(skillName)) {
      return `Error: Invalid skill name "${skillName}".`;
    }

    try {
      return loadSkillContent(skillName);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      if (
        message.startsWith("Skill not found:") ||
        message.startsWith("Invalid skill name:")
      ) {
        return `Error: ${message}`;
      }

      if (message.startsWith("Invalid skill path:")) {
        return "Error: Invalid skill path.";
      }

      return `Error: Failed to read skill \"${skillName}\".`;
    }
  },
};
