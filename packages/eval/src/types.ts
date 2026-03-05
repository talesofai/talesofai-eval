import type { Logger } from "pino";

export type EvalTier = 1 | 2 | 3;

export type CaseType = "plain" | "agent" | "skill";

export type AnyAssistantMessage = {
  role: "assistant";
  reasoning_content?: string;
  content?:
    | string
    | (
        | { type: "text"; text: string }
        | { type: "output_text"; text: string }
      )[];
  tool_calls?: {
    index: number;
    id: string;
    type: "function";
    function: {
      name: string;
      arguments: string;
    };
  }[];
};

export type AnyUserMessage = {
  role: "user";
  content:
    | string
    | (
        | {
            type: "text";
            text: string;
          }
        | {
            type: "image_url";
            image_url: {
              url: string;
            };
          }
        | {
            type: "input_text";
            text: string;
          }
        | {
            type: "input_image";
            image: string;
          }
      )[];
};

// ─── Messages ────────────────────────────────────────────────────────────────

/** Multi-turn conversation: alternating user / assistant messages */
export type EvalMessage = AnyUserMessage | AnyAssistantMessage;

// ─── Case ────────────────────────────────────────────────────────────────────

export type AssertionConfig =
  | {
      type: "tool_usage";
      tier?: EvalTier;
      expected_tools?: string[];
      forbidden_tools?: string[];
    }
  | {
      type: "final_status";
      tier?: EvalTier;
      expected_status: "SUCCESS" | "PENDING" | "FAILURE";
    }
  | {
      type: "llm_judge";
      tier?: EvalTier;
      prompt: string;
      pass_threshold: number;
    }
  | {
      type: "task_success";
      tier?: EvalTier;
      user_goal?: string;
      pass_threshold: number;
    }
  | {
      type: "tool_parameter_accuracy";
      tier?: EvalTier;
      tool_name: string;
      expected_description: string;
      pass_threshold: number;
    }
  | {
      type: "error_recovery";
      tier?: EvalTier;
      tool_name?: string;
      pass_threshold?: number;
    }
  | { type: "human_review"; tier?: EvalTier; reason?: string };

export type EvalCriteria = {
  // --- Legacy compatibility fields ---
  expected_tools?: string[];
  forbidden_tools?: string[];
  /** AgentCase only */
  expected_status?: "SUCCESS" | "PENDING" | "FAILURE";
  llm_judge?: {
    prompt: string;
    /** 0–1, recommended ≥ 0.7 */
    pass_threshold: number;
  };

  // --- Assertion-based scoring fields ---
  assertions?: AssertionConfig[];
};

export type PlainEvalCase = {
  type: "plain";
  /** Stable unique id, kebab-case */
  id: string;
  description: string;
  input: {
    system_prompt: string;
    /** Model ID to resolve from models.json */
    model: string;
    messages: EvalMessage[];
    allowed_tool_names?: string[];
  };
  criteria: EvalCriteria;
};

export const DEFAULT_AGENT_PRESET_KEY = "latitude://8|live|running_agent_new";

export const DEFAULT_ALLOWED_TOOL_NAMES = [
  "make_image_v1",
  "make_video_v1",
  "make_song_v1",
  "remove_background_v1",
  "remove_background_nocrop_v1",
  "request_character_or_elementum_v1",
  "search_character_or_elementum_v1",
  "request_bgm_v1",
  "list_assigns_v1",
  "update_assign_v1",
  "get_assign_v1",
  "get_hashtag_collections",
  "get_hashtag_info",
  "edit_html_v1",
  "apply_html_v1",
  "see_html_v1",
] as const;

export type AgentAutoFollowup = {
  mode: "adversarial_help_choose";
  /** default 1 */
  max_turns?: number;
};

export type CharacterFromSelect = {
  uuid: string;
  name: string;
  biography?: {
    age?: string | null;
    interests?: string | null;
    persona?: string | null;
    description?: string | null;
    occupation?: string | null;
  } | null;
  config?: {
    avatar_img?: string | null;
  } | null;
};

export interface CharacterProvider {
  getRandomCharacters(count: number): Promise<CharacterFromSelect[]>;
}

export type AgentEvalCase = {
  type: "agent";
  id: string;
  description: string;
  input: {
    /** @deprecated No longer used by the runner. Kept for case file identification only. Use `system_prompt` + `model` instead. */
    preset_key?: string;
    system_prompt?: string;
    model?: string;
    preset_description?: string;
    parameters: Record<string, string | number | boolean>;
    messages: EvalMessage[];
    allowed_tool_names?: string[];
    need_approval_tool_names?: string[];
    auto_followup?: AgentAutoFollowup;
  };
  criteria: EvalCriteria;
};

export type SkillEvalCase = {
  type: "skill";
  id: string;
  description: string;
  input: {
    /** Skill name, corresponds to subdirectory name in skills/ */
    skill: string;
    /** Model ID to execute the skill */
    model: string;
    /** Task description */
    task: string;
    /** Test data (optional), serialized as JSON and injected into prompt */
    fixtures?: Record<string, unknown>;
    /** Additional system prompt prefix (optional) */
    system_prompt_prefix?: string;
    /**
     * Evaluation mode:
     * - "inject": Directly inject skill content (test skill doc quality)
     * - "discover": Only provide skill list, agent loads on demand (test real usage)
     * @default "inject"
     */
    evaluation_mode?: "inject" | "discover";
  };
  criteria: EvalCriteria;
};

export type EvalCase = PlainEvalCase | AgentEvalCase | SkillEvalCase;

// ─── Trace ───────────────────────────────────────────────────────────────────

export type ToolCallStartRecord = {
  name: string;
  arguments: Record<string, unknown>;
};

export type ToolCallRecord = {
  tool_call_id?: string;
  name: string;
  arguments: Record<string, unknown>;
  output: unknown;
  duration_ms: number;
};

export type CommonLLMMessage =
  | {
      role: "system";
      content: string;
    }
  | {
      role: "user";
      content: string;
    }
  | {
      role: "assistant";
      content: string | null;
      tool_calls?: {
        id: string;
        type: "function";
        function: { name: string; arguments: string };
      }[];
    }
  | {
      role: "tool";
      content: string;
      tool_call_id: string;
    };

export type EvalTraceStatus = "success" | "failure" | "cancelled" | "error";

// ─── Span Timing ──────────────────────────────────────────────────────────────

export type SpanKind =
  | "mcp_connect"
  | "mcp_list_tools"
  | "llm_turn"
  | "tool_call";

export type Span = {
  name: string;
  kind: SpanKind;
  start_ms: number;
  end_ms: number;
  duration_ms: number;
  parent?: string;
  attributes?: {
    first_token_ms?: number;
    input_tokens?: number;
    output_tokens?: number;
    tool_call_id?: string;
    error?: string;
  };
};

export type TimingSummary = {
  mcp_connect_ms: number;
  mcp_list_tools_ms: number;
  llm_total_ms: number;
  llm_first_token_ms: number | null;
  tool_total_ms: number;
  turns_count: number;
};

export type EvalTrace = {
  case_id: string;
  case_type: CaseType;
  conversation: CommonLLMMessage[];
  tools_called: ToolCallRecord[];
  final_response: string | null;
  status: EvalTraceStatus;
  usage: { input_tokens: number; output_tokens: number; total_tokens: number };
  duration_ms: number;
  /** Runner-level error message; only present when status === "error" */
  error?: string;
  /** Span timing data, optional for backward compatibility */
  spans?: Span[];
};

export type ArtifactRef = {
  uuid: string;
  url: string;
  modality: string;
  status?: string;
  tool_name: string;
  tool_index: number;
};

export type TraceMetrics = {
  tool_calls_total: number;
  tool_calls_by_name: Record<string, number>;

  tool_error_calls_total: number;
  tool_error_calls_by_name: Record<string, number>;

  tool_retry_calls_total: number;

  tool_duration_ms_total: number;

  artifacts_total: number;
  artifacts_by_modality: Record<string, number>;
  artifacts_success_total: number;
  artifacts_success_by_modality: Record<string, number>;

  bindings_total: number;
  bindings_by_to_tool: Record<string, number>;

  make_video_calls_total: number;
  make_video_bound_calls_total: number;

  delivery_contains_artifact_url: boolean;

  milestones: {
    has_picture: boolean;
    has_video: boolean;
    has_picture_to_video_binding: boolean;
    delivered_any_artifact: boolean;
    progress_image_only: number;
    progress_image_to_video: number | null;
  };

  debug?: {
    artifacts?: ArtifactRef[];
    delivered_urls?: string[];
  };
};

export type TraceMetricsSummary = {
  avg_tool_calls_total: number;
  avg_tool_error_calls_total: number;
  avg_tool_retry_calls_total: number;
  make_video_binding_rate: number | null;
  artifacts_by_modality: Record<string, number>;
  picture_rate: number;
  video_rate: number;
  binding_rate: number | null;
  delivery_rate: number;
};

// ─── Score ───────────────────────────────────────────────────────────────────

export type DimensionKind =
  | "tool_usage"
  | "final_status"
  | "llm_judge"
  | "task_success"
  | "tool_parameter_accuracy"
  | "error_recovery"
  | "human_review";

export type DimensionResult = {
  dimension: DimensionKind;
  /** Set by scoreTrace; reflects the tier of the assertion that produced this result */
  tier?: EvalTier;
  /** Present only on auto-synthesized task_success fallback (D12) */
  auto_synthesized?: true;
  passed: boolean;
  /** 0–1 */
  score: number;
  reason: string;
};

export type EvalResult = {
  case_id: string;
  case_type: CaseType;
  /** Human-readable case description */
  description?: string;
  /** Preset description for agent cases */
  preset_description?: string;
  /** All dimensions passed */
  passed: boolean;
  dimensions: DimensionResult[];
  trace: EvalTrace;
  metrics?: TraceMetrics;
  /** Runner-level error (not LLM error) */
  error?: string;
};

// ─── Summary ─────────────────────────────────────────────────────────────────

export type EvalSummary = {
  total: number;
  passed: number;
  failed: number;
  errored: number;
  duration_ms: number;
  results: EvalResult[];
};

export type DiffSummary = {
  total: number;
  base_better: number;
  candidate_better: number;
  equivalent: number;
  errored: number;
  duration_ms: number;
};

// ─── Diff ────────────────────────────────────────────────────────────────────

export type DiffConfig = {
  label: string;
  overrides: Partial<PlainEvalCase["input"]> | Partial<AgentEvalCase["input"]>;
};

export type DiffVerdict =
  | "base_better"
  | "candidate_better"
  | "equivalent"
  | "error";

export type DiffResult = {
  case_id: string;
  verdict: DiffVerdict;
  reason: string;
  base: EvalTrace;
  candidate: EvalTrace;
};

// ─── Runner ──────────────────────────────────────────────────────────────────

export type RunnerOptions = {
  mcpServerBaseURL: string;
  /** LLM streaming token (each turn fires) */
  onDelta?: (delta: string) => void;
  /** Tool call started */
  onToolStart?: (call: ToolCallStartRecord) => void;
  /** Tool call completed */
  onToolCall?: (call: ToolCallRecord) => void;
  /** Optional pino logger for debug output */
  logger?: Logger;
  characterProvider?: CharacterProvider;
};

// ─── Reporter ────────────────────────────────────────────────────────────────

export interface Reporter {
  onCaseStart(c: EvalCase, index: number, total: number): void;
  onDelta(delta: string): void;
  onToolStart(call: ToolCallStartRecord): void;
  onToolCall(call: ToolCallRecord): void;
  onCaseResult(result: EvalResult): void;
  onDiffResult(result: DiffResult): void;
  onSummary(summary: EvalSummary): void;
  onDiffSummary(summary: DiffSummary): void;
}

// ─── Scorer ──────────────────────────────────────────────────────────────────

export type ScorerFn<T extends AssertionConfig = AssertionConfig> = (
  trace: EvalTrace,
  assertion: T,
  evalCase: EvalCase,
) => Promise<DimensionResult> | DimensionResult;

/**
 * Back-compat alias (deprecated): scorers used to accept EvalCriteria.
 */
export type Scorer = ScorerFn;

// ─── Matrix ──────────────────────────────────────────────────────────────────

export type MatrixVariant = {
  /** Display label (unique and non-empty). */
  label: string;
  /** Input overrides merged into case.input (compatible with applyOverrides). */
  overrides: Record<string, unknown>;
};

export type MatrixCell = {
  case_id: string;
  variant_label: string;
  result: EvalResult;
};

export type MatrixSummary = {
  /** Variant labels in column order. */
  variants: string[];
  /** Case IDs in row order. */
  case_ids: string[];
  /** Flat list of cells in case_id × variant_label order. */
  cells: MatrixCell[];
  total: number;
  passed: number;
  failed: number;
  errored: number;
  duration_ms: number;
};

// ─── Matrix Reporter ─────────────────────────────────────────────────────────

export interface MatrixReporter {
  onCellStart(
    caseId: string,
    variantLabel: string,
    cellIndex: number,
    total: number,
  ): void;
  onCellResult(cell: MatrixCell): void;
  onMatrixSummary(summary: MatrixSummary): void;
}
