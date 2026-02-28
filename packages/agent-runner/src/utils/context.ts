import type { Apis, ManuscriptModel } from "@agent-eval/apis";
import type { AgentEventsHandler } from "../events.ts";

export type AgentRunOptions = {
  name: string;
  presetKey: string;
  parameters: Record<string, string | number | boolean>;
  maxTurns?: number;
  workflowName?: string;
  traceId?: string;
  groupId?: string;
  traceMetadata?: Record<string, string>;
  meta?: {
    inherit?: {
      collection_uuid?: string;
      picture_uuid?: string;
    };
    entrance_uuid?: string;
  };
  autoApprove?: boolean;
};

export type AgentContext = {
  apis: Apis;
  manuscript: ManuscriptModel;
  eventsHandler: AgentEventsHandler;
};
