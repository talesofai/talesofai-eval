// Report data injected by renderer
const REPORT_DATA = "{{REPORT_DATA}}";

// Decode base64 payload (handles UTF-8 correctly)
function decodePayload() {
  try {
    const binaryStr = atob(REPORT_DATA);
    const bytes = Uint8Array.from(binaryStr, (c) => c.charCodeAt(0));
    const jsonStr = new TextDecoder().decode(bytes);
    return JSON.parse(jsonStr);
  } catch (_e) {
    return null;
  }
}

// Format duration
function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

// Render summary row (compact inline)
function renderSummary(summary) {
  const container = document.getElementById("summary-row");
  container.innerHTML = `
        <div class="summary-item total">
          <span class="value">${summary.total}</span>
          <span class="label">total</span>
        </div>
        <div class="summary-item passed">
          <span class="value">${summary.passed}</span>
          <span class="label">passed</span>
        </div>
        <div class="summary-item failed">
          <span class="value">${summary.failed}</span>
          <span class="label">failed</span>
        </div>
        <div class="summary-item errored">
          <span class="value">${summary.errored}</span>
          <span class="label">errored</span>
        </div>
        <div class="summary-item">
          <span class="value">${formatDuration(summary.duration_ms)}</span>
          <span class="label">duration</span>
        </div>
      `;
}

// Render metrics section
function renderMetrics(metrics) {
  const container = document.getElementById("metrics-section");
  const bindingRate =
    metrics.binding_rate === null
      ? "n/a"
      : `${(metrics.binding_rate * 100).toFixed(1)}%`;

  container.innerHTML = `
        <h2>Metrics Summary</h2>
        <div class="metrics-grid">
          <div class="metric-item">
            <span class="key">Avg Tool Calls</span>
            <span class="value">${metrics.avg_tool_calls_total}</span>
          </div>
          <div class="metric-item">
            <span class="key">Avg Tool Errors</span>
            <span class="value">${metrics.avg_tool_error_calls_total}</span>
          </div>
          <div class="metric-item">
            <span class="key">Avg Tool Retries</span>
            <span class="value">${metrics.avg_tool_retry_calls_total}</span>
          </div>
          <div class="metric-item">
            <span class="key">Picture Rate</span>
            <span class="value">${(metrics.picture_rate * 100).toFixed(1)}%</span>
          </div>
          <div class="metric-item">
            <span class="key">Video Rate</span>
            <span class="value">${(metrics.video_rate * 100).toFixed(1)}%</span>
          </div>
          <div class="metric-item">
            <span class="key">Binding Rate</span>
            <span class="value">${bindingRate}</span>
          </div>
          <div class="metric-item">
            <span class="key">Delivery Rate</span>
            <span class="value">${(metrics.delivery_rate * 100).toFixed(1)}%</span>
          </div>
        </div>
      `;
}

// Render conversation timeline
function renderConversation(conversation) {
  if (!conversation || conversation.length === 0) {
    return '<p style="color: var(--text-tertiary); font-size: 12px;">No conversation</p>';
  }

  const html = [];

  for (const msg of conversation) {
    if (msg.role === "user") {
      html.push(
        `<div class="message-item user"><span class="message-role">User</span><div class="message-content">${escapeHtml(msg.content || "")}</div></div>`,
      );
    } else if (msg.role === "assistant") {
      const lines = [];
      if (msg.content) lines.push(escapeHtml(msg.content));
      if (msg.tool_calls && msg.tool_calls.length > 0) {
        for (const tc of msg.tool_calls) {
          const args = tc.arguments_preview
            ? ` ${escapeHtml(tc.arguments_preview)}`
            : "";
          lines.push(`→ ${escapeHtml(tc.name)}${args}`);
        }
      }
      html.push(
        `<div class="message-item assistant"><span class="message-role">Assistant</span><div class="message-content">${lines.join("<br>")}</div></div>`,
      );
    } else if (msg.role === "tool") {
      const tool = msg.tool;
      const header = tool
        ? `${tool.name}${tool.arguments_preview ? ` ${tool.arguments_preview}` : ""}`
        : "Result";
      html.push(
        `<div class="message-item tool"><span class="message-role">Tool</span><div class="message-content"><div class="tool-return-header">${escapeHtml(header)}</div>${tool ? renderToolMedia(tool.media) : ""}</div></div>`,
      );
    }
  }

  return `<div class="conversation-timeline">${html.join("")}</div>`;
}

// Render dimensions
function renderDimensions(dimensions) {
  if (!dimensions || dimensions.length === 0) {
    return '<p style="color: var(--text-tertiary); font-size: 12px;">No dimensions</p>';
  }

  return `
        <div class="dimensions-list">
          ${dimensions
            .map(
              (d) => `
            <div class="dimension-item">
              <div class="dimension-status ${d.passed ? "pass" : "fail"}"></div>
              <div class="dimension-content">
                <div class="dimension-name">${d.dimension}</div>
                <div class="dimension-score">score: ${d.score.toFixed(2)}</div>
                ${d.reason ? `<div class="dimension-reason">${escapeHtml(d.reason)}</div>` : ""}
              </div>
            </div>
          `,
            )
            .join("")}
        </div>
      `;
}

// Render tool timeline
function renderToolTimeline(tools) {
  if (!tools || tools.length === 0) {
    return '<p style="color: var(--text-tertiary); font-size: 12px;">No tool calls</p>';
  }

  return `
        <div class="tool-timeline">
          ${tools
            .map(
              (tool) => `
            <div class="tool-item" data-tool-id="${escapeHtml(tool.tool_call_id)}">
              <div class="tool-header" onclick="toggleTool(this)">
                <div class="tool-info">
                  <span class="tool-name">${escapeHtml(tool.name)}</span>
                  <span class="tool-args-preview">${escapeHtml(tool.arguments_preview)}</span>
                </div>
                <span class="tool-duration">${formatDuration(tool.duration_ms)}</span>
              </div>
              <div class="tool-details">
                <div class="tool-section">
                  <div class="tool-section-label">Arguments</div>
                  <pre class="code-block">${escapeHtml(tool.arguments_pretty)}</pre>
                </div>
                <div class="tool-section">
                  <div class="tool-section-label">Output</div>
                  <pre class="code-block">${escapeHtml(tool.output_pretty)}</pre>
                </div>
                ${renderToolMedia(tool.media)}
              </div>
            </div>
          `,
            )
            .join("")}
        </div>
      `;
}

// Render media preview for tool output
function renderToolMedia(media) {
  if (!media || media.length === 0) return "";

  const items = media
    .map((m) => {
      const mediaEl =
        m.type === "video"
          ? `<video controls src="${escapeHtml(m.url)}"></video>`
          : `<img src="${escapeHtml(m.url)}" alt="${escapeHtml(m.modality)}" loading="lazy">`;
      const meta = [m.modality, m.uuid ? m.uuid.slice(0, 8) : ""]
        .filter(Boolean)
        .join(" · ");
      return `<div class="media-item">${mediaEl}<div class="media-meta">${escapeHtml(meta)}</div></div>`;
    })
    .join("");

  return `<div class="media-preview"><div class="media-grid">${items}</div></div>`;
}

// Escape HTML
function escapeHtml(text) {
  if (!text) return "";
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

// Toggle tool details
function _toggleTool(header) {
  const item = header.closest(".tool-item");
  item.classList.toggle("expanded");
}

// Toggle case details
function _toggleCase(header) {
  const item = header.closest(".case-item");
  item.classList.toggle("expanded");
}

// Render case metrics
function renderCaseMetrics(metrics) {
  if (!metrics) return "";
  return `
        <div class="case-metrics">
          <div class="case-metric">
            <span class="key">Tool Calls</span>
            <span class="value">${metrics.tool_calls_total}</span>
          </div>
          <div class="case-metric">
            <span class="key">Errors</span>
            <span class="value">${metrics.tool_error_calls_total}</span>
          </div>
          <div class="case-metric">
            <span class="key">Retries</span>
            <span class="value">${metrics.tool_retry_calls_total}</span>
          </div>
          <div class="case-metric">
            <span class="key">Pictures</span>
            <span class="value">${metrics.picture_count}</span>
          </div>
          <div class="case-metric">
            <span class="key">Videos</span>
            <span class="value">${metrics.video_count}</span>
          </div>
          <div class="case-metric">
            <span class="key">Artifacts</span>
            <span class="value">${metrics.artifact_count}</span>
          </div>
        </div>
      `;
}

// Render single case
function renderCase(caseData) {
  const row = caseData.row;
  const result = caseData.result;
  const trace = result.trace;
  const hasError = !!result.error;

  return `
        <div class="case-item" data-case-id="${escapeHtml(result.case_id)}" data-status="${row.status_class}" id="case-${escapeHtml(result.case_id)}">
          <div class="case-header" onclick="toggleCase(this)">
            <div class="case-title-section">
              <span class="case-title">${escapeHtml(caseData.title)}</span>
              <span class="case-subtitle">${escapeHtml(result.case_id)}</span>
            </div>
            <span class="case-status ${row.status_class}">${row.status_text}</span>
            <span class="case-judge ${row.judge_class}">${row.judge_text}</span>
            <span class="case-duration">${row.duration_text}</span>
            <span class="case-tokens">${row.tokens_text}</span>
            <span class="case-toggle">▶</span>
          </div>
          <div class="case-details">
            ${
              hasError
                ? `
              <div class="detail-section">
                <h3>Error</h3>
                <div class="error-message">${escapeHtml(result.error)}</div>
              </div>
            `
                : ""
            }

            ${renderCaseMetrics(caseData.metrics_view)}

            <div class="detail-section">
              <h3>Conversation</h3>
              ${renderConversation(caseData.conversation)}
            </div>

            <div class="detail-section">
              <h3>Dimensions</h3>
              ${renderDimensions(result.dimensions)}
            </div>

            <div class="detail-section">
              <h3>Trace Summary</h3>
              <div class="trace-summary">
                <div class="trace-summary-item">
                  <div class="key">Status</div>
                  <div class="value">${trace.status}</div>
                </div>
                <div class="trace-summary-item">
                  <div class="key">Duration</div>
                  <div class="value">${formatDuration(trace.duration_ms)}</div>
                </div>
                <div class="trace-summary-item">
                  <div class="key">Input Tokens</div>
                  <div class="value">${trace.usage.input_tokens}</div>
                </div>
                <div class="trace-summary-item">
                  <div class="key">Output Tokens</div>
                  <div class="value">${trace.usage.output_tokens}</div>
                </div>
                <div class="trace-summary-item">
                  <div class="key">Total Tokens</div>
                  <div class="value">${trace.usage.total_tokens}</div>
                </div>
                <div class="trace-summary-item">
                  <div class="key">Tool Calls</div>
                  <div class="value">${trace.tools_called.length}</div>
                </div>
              </div>
            </div>

            <div class="detail-section">
              <h3>Tool Calls</h3>
              ${renderToolTimeline(caseData.tool_calls)}
            </div>

            <div class="detail-section">
              <h3>Final Response</h3>
              <div class="final-response">${escapeHtml(trace.final_response || "")}</div>
            </div>

            <details class="raw-json">
              <summary>View Raw Trace JSON</summary>
              <pre>${escapeHtml(JSON.stringify(trace, null, 2))}</pre>
            </details>

            <details class="raw-json">
              <summary>View Raw Result JSON</summary>
              <pre>${escapeHtml(JSON.stringify(result, null, 2))}</pre>
            </details>
          </div>
        </div>
      `;
}

// Render case list
function renderCaseList(cases) {
  const container = document.getElementById("case-list");
  if (cases.length === 0) {
    container.innerHTML = '<div class="empty-state">No cases found</div>';
    return;
  }
  container.innerHTML = cases.map(renderCase).join("");
}

// Update visibility based on filters
function updateVisibility(cases) {
  const filter =
    document.querySelector(".filter-btn.active")?.dataset.filter || "all";
  const search = document.getElementById("search-input").value.trim();

  document.querySelectorAll(".case-item").forEach((el) => {
    const caseId = el.dataset.caseId;
    const caseData = cases.find((c) => c.result.case_id === caseId);
    if (!caseData) return;

    const matchesFilter =
      filter === "all" || caseData.row.status_class === filter;
    const matchesSearch =
      !search || caseId.toLowerCase().includes(search.toLowerCase());

    el.classList.toggle("hidden", !(matchesFilter && matchesSearch));
  });
}

// Initialize
function init() {
  const data = decodePayload();
  if (!data) {
    document.body.innerHTML =
      '<div class="container"><div class="error-message">Failed to load report data</div></div>';
    return;
  }

  renderSummary(data.summary);
  renderMetrics(data.summary.metrics_summary);
  renderCaseList(data.cases);

  // Filter buttons
  document.querySelectorAll(".filter-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".filter-btn").forEach((b) => {
        b.classList.remove("active");
      });
      btn.classList.add("active");
      updateVisibility(data.cases);
    });
  });

  // Search input
  document.getElementById("search-input").addEventListener("input", () => {
    updateVisibility(data.cases);
  });

  // Handle hash for deep linking
  if (window.location.hash) {
    const targetId = window.location.hash.slice(1);
    const target = document.getElementById(targetId);
    if (target) {
      target.classList.add("expanded");
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }
}

// Run on load
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
