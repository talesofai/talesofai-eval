// Report data injected by renderer
const REPORT_DATA = "{{REPORT_DATA}}";

// Decode base64 payload
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

// Format number with commas
function formatNumber(n) {
  return n.toLocaleString();
}

// Escape HTML
function escapeHtml(text) {
  if (!text) return "";
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

// Toggle tool details
function toggleTool(header) {
  const item = header.closest(".tool-item");
  item.classList.toggle("expanded");
}

// Extract media from tool output
function extractMediaFromOutput(output) {
  if (!output) return [];

  const media = [];
  const artifacts = extractArtifacts(output);

  for (const artifact of artifacts) {
    if (artifact.url && artifact.modality) {
      media.push({
        type: artifact.modality === "VIDEO" ? "video" : "image",
        url: artifact.url,
        modality: artifact.modality,
        uuid: artifact.uuid,
      });
    }
  }

  return media;
}

// Extract artifacts from various output formats
function extractArtifacts(output) {
  if (!output) return [];

  // Handle string output (JSON string)
  if (typeof output === "string") {
    try {
      const parsed = JSON.parse(output);
      return extractArtifacts(parsed);
    } catch {
      return [];
    }
  }

  // Handle array output (OpenAI-style content parts)
  if (Array.isArray(output)) {
    const artifacts = [];
    for (const item of output) {
      if (item && typeof item === "object") {
        if (item.artifacts) {
          artifacts.push(...item.artifacts);
        }
        // Handle content array with image_url
        if (item.content && Array.isArray(item.content)) {
          for (const content of item.content) {
            if (content.type === "image_url" && content.image_url?.url) {
              artifacts.push({
                url: content.image_url.url,
                modality: "PICTURE",
                uuid: null,
              });
            }
          }
        }
      }
    }
    return artifacts;
  }

  // Handle object output
  if (typeof output === "object") {
    // Direct artifacts array
    if (output.artifacts && Array.isArray(output.artifacts)) {
      return output.artifacts;
    }
    // Nested in result
    if (output.result?.artifacts && Array.isArray(output.result.artifacts)) {
      return output.result.artifacts;
    }
  }

  return [];
}

// Build conversation view with linked tool info
function buildConversationView(conversation, toolCalls) {
  const toolMap = new Map(toolCalls.map((t) => [t.tool_call_id, t]));

  return conversation.map((msg) => {
    if (msg.role === "assistant" && msg.tool_calls) {
      return {
        ...msg,
        tool_calls: msg.tool_calls.map((tc) => {
          const tool = toolMap.get(tc.id);
          return {
            ...tc,
            name: tc.function?.name || tool?.name || "unknown",
            arguments_preview: tool
              ? JSON.stringify(tool.arguments).slice(0, 60)
              : tc.function?.arguments?.slice(0, 60) || "",
          };
        }),
      };
    }
    if (msg.role === "tool") {
      const tool = toolMap.get(msg.tool_call_id);
      return {
        ...msg,
        tool: tool
          ? {
              name: tool.name,
              arguments_preview: JSON.stringify(tool.arguments).slice(0, 60),
              media: tool.media,
            }
          : undefined,
      };
    }
    return msg;
  });
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

// Get case consistency
function getCaseConsistency(caseId, cells) {
  const caseCells = cells.filter((c) => c.case_id === caseId);
  const passes = caseCells.map((c) => c.result.passed);
  const allPass = passes.every((p) => p);
  const allFail = passes.every((p) => !p);
  if (allPass) return "consistent-pass";
  if (allFail) return "consistent-fail";
  return "inconsistent";
}

// Get cell by case and variant
function getCell(cells, caseId, variantLabel) {
  return cells.find((c) => c.case_id === caseId && c.variant_label === variantLabel);
}

// Calculate variant stats
function calculateVariantStats(variantLabel, cells) {
  const variantCells = cells.filter((c) => c.variant_label === variantLabel);
  const passed = variantCells.filter((c) => c.result.passed).length;
  const failed = variantCells.filter((c) => !c.result.passed && !c.result.error).length;
  const errored = variantCells.filter((c) => c.result.error).length;
  const total = variantCells.length;
  const passRate = total > 0 ? (passed / total) * 100 : 0;

  const avgDuration =
    variantCells.length > 0
      ? variantCells.reduce((sum, c) => sum + (c.result.trace?.duration_ms || 0), 0) /
        variantCells.length
      : 0;

  const totalTokens =
    variantCells.length > 0
      ? variantCells.reduce(
          (sum, c) =>
            sum + (c.result.trace?.usage?.total_tokens || 0),
          0
        )
      : 0;

  return {
    passed,
    failed,
    errored,
    total,
    passRate,
    avgDuration,
    totalTokens,
  };
}

// Render summary row
function renderSummary(summary) {
  const container = document.getElementById("summary-row");
  const passRate = summary.total > 0 ? (summary.passed / summary.total) * 100 : 0;
  const inconsistentCount = summary.case_ids.filter(
    (id) => getCaseConsistency(id, summary.cells) === "inconsistent"
  ).length;

  container.innerHTML = `
    <span class="pass-rate">${passRate.toFixed(1)}%</span>
    <span class="summary-divider">—</span>
    <div class="summary-stat"><span class="n">${summary.variants.length}</span><span class="l">variants</span></div>
    <div class="summary-stat"><span class="n">${summary.case_ids.length}</span><span class="l">cases</span></div>
    <div class="summary-stat"><span class="n">${summary.total}</span><span class="l">cells</span></div>
    <span class="summary-divider">·</span>
    <div class="summary-stat"><span class="n passed">${summary.passed}</span><span class="l">passed</span></div>
    <div class="summary-stat"><span class="n failed">${summary.failed}</span><span class="l">failed</span></div>
    <div class="summary-stat"><span class="n errored">${summary.errored}</span><span class="l">errored</span></div>
    ${inconsistentCount > 0 ? `<div class="summary-stat"><span class="n inconsistent">${inconsistentCount}</span><span class="l">inconsistent</span></div>` : ""}
    <span class="summary-divider">·</span>
    <div class="summary-stat"><span class="n">${formatDuration(summary.duration_ms)}</span><span class="l">total</span></div>
  `;
}

// Render variant cards
function renderVariantCards(data) {
  const container = document.getElementById("variants-section");
  const stats = data.variants.map((v) => ({
    label: v,
    ...calculateVariantStats(v, data.cells),
  }));

  const bestPassRate = Math.max(...stats.map((s) => s.passRate));

  container.innerHTML = stats
    .map((stat) => {
      const isBest = stat.passRate === bestPassRate && stat.passRate > 0;
      return `
        <div class="variant-card ${isBest ? "best" : ""}" data-variant="${escapeHtml(stat.label)}">
          <div class="variant-name">${escapeHtml(stat.label)}</div>
          <div class="variant-stats">
            <div class="variant-stat">
              <span class="label">Pass Rate</span>
              <span class="value ${stat.passRate >= 60 ? "pass" : "fail"}">${stat.passRate.toFixed(1)}%</span>
            </div>
            <div class="variant-stat">
              <span class="label">Passed</span>
              <span class="value">${stat.passed}/${stat.total}</span>
            </div>
            <div class="variant-stat">
              <span class="label">Avg Time</span>
              <span class="value subtle">${formatDuration(stat.avgDuration)}</span>
            </div>
            <div class="variant-stat">
              <span class="label">Tokens</span>
              <span class="value subtle">${formatNumber(stat.totalTokens)}</span>
            </div>
          </div>
        </div>
      `;
    })
    .join("");
}

// Render matrix heatmap
function renderMatrixHeatmap(data) {
  const container = document.getElementById("matrix-container");

  const headerRow = `
    <thead>
      <tr>
        <th class="case-col">Case</th>
        ${data.variants.map((v) => `<th class="variant-col">${escapeHtml(v)}</th>`).join("")}
        <th class="consistency-col">Consistency</th>
      </tr>
    </thead>
  `;

  const bodyRows = data.case_ids
    .map((caseId) => {
      const consistency = getCaseConsistency(caseId, data.cells);
      const caseData = data.cells.find((c) => c.case_id === caseId);
      const description = caseData?.result?.description || "";

      const cells = data.variants
        .map((variant) => {
          const cell = getCell(data.cells, caseId, variant);
          if (!cell) {
            return `<td class="cell">—</td>`;
          }

          const result = cell.result;
          const statusClass = result.error ? "err" : result.passed ? "pass" : "fail";
          const statusSymbol = result.error ? "!" : result.passed ? "✓" : "✗";
          const score = result.dimensions?.length
            ? result.dimensions.reduce((sum, d) => sum + d.score, 0) / result.dimensions.length
            : 0;

          return `
            <td class="cell">
              <div class="cell-content ${statusClass}">
                <span class="cell-status ${statusClass}">${statusSymbol}</span>
                <span class="cell-score ${score < 0.5 ? "low" : ""}">${score.toFixed(2)}</span>
              </div>
            </td>
          `;
        })
        .join("");

      const consistencyBadge = {
        "consistent-pass": '<span class="consistency-badge consistent-pass">✓ Pass</span>',
        "consistent-fail": '<span class="consistency-badge consistent-fail">✗ Fail</span>',
        inconsistent: '<span class="consistency-badge inconsistent">⚠ Inconsistent</span>',
      }[consistency];

      return `
        <tr data-case-id="${escapeHtml(caseId)}" onclick="openCaseDetail('${escapeHtml(caseId)}')">
          <td class="case-cell">
            <div class="case-id">${escapeHtml(caseId)}</div>
            ${description ? `<div class="case-desc">${escapeHtml(description)}</div>` : ""}
          </td>
          ${cells}
          <td class="cell">${consistencyBadge}</td>
        </tr>
      `;
    })
    .join("");

  container.innerHTML = `
    <table class="matrix-table">
      ${headerRow}
      <tbody>${bodyRows}</tbody>
    </table>
  `;
}

// Open case detail modal
function openCaseDetail(caseId) {
  const data = window.reportData;
  if (!data) return;

  const caseCells = data.variants
    .map((variant) => ({
      variant,
      cell: getCell(data.cells, caseId, variant),
    }))
    .filter((item) => item.cell);

  if (caseCells.length === 0) return;

  const consistency = getCaseConsistency(caseId, data.cells);
  const consistencyBadge = {
    "consistent-pass": '<span class="consistency-badge consistent-pass">✓ Consistent Pass</span>',
    "consistent-fail": '<span class="consistency-badge consistent-fail">✗ Consistent Fail</span>',
    inconsistent: '<span class="consistency-badge inconsistent">⚠ Inconsistent</span>',
  }[consistency];

  // Find best performing variant
  const scores = caseCells.map((item) => {
    const dims = item.cell.result.dimensions || [];
    const avgScore = dims.length ? dims.reduce((sum, d) => sum + d.score, 0) / dims.length : 0;
    return { variant: item.variant, score: avgScore, passed: item.cell.result.passed };
  });
  const bestScore = Math.max(...scores.map((s) => s.score));

  // Render variant comparison cards
  const variantCards = caseCells
    .map((item) => {
      const result = item.cell.result;
      const statusClass = result.error ? "err" : result.passed ? "pass" : "fail";
      const statusText = result.error ? "ERROR" : result.passed ? "PASS" : "FAIL";
      const dims = result.dimensions || [];
      const avgScore = dims.length ? dims.reduce((sum, d) => sum + d.score, 0) / dims.length : 0;
      const isBest = avgScore === bestScore && avgScore > 0;

      const dimensionsHtml = dims.length
        ? `
        <div class="detail-section">
          <div class="detail-section-title">Dimensions</div>
          <table class="dimensions-table">
            <thead>
              <tr>
                <th>Dimension</th>
                <th style="text-align: right">Score</th>
              </tr>
            </thead>
            <tbody>
              ${dims
                .map(
                  (d) => `
                <tr>
                  <td>
                    ${escapeHtml(d.dimension)}
                    ${d.reason ? `<div class="dimension-reason">${escapeHtml(d.reason)}</div>` : ""}
                  </td>
                  <td class="score ${d.passed ? "pass" : "fail"}">${d.score.toFixed(2)}</td>
                </tr>
              `
                )
                .join("")}
            </tbody>
          </table>
        </div>
      `
        : "";

      // Build conversation view with tool call linking
      const toolCalls = (result.trace?.tools_called || []).map((tool, index) => ({
        ...tool,
        tool_call_id: tool.tool_call_id || `tool-${index}`,
        arguments_preview: JSON.stringify(tool.arguments).slice(0, 60),
        arguments_pretty: JSON.stringify(tool.arguments, null, 2),
        output_pretty: typeof tool.output === "string" ? tool.output : JSON.stringify(tool.output, null, 2),
        media: extractMediaFromOutput(tool.output),
      }));

      const conversationWithTools = buildConversationView(result.trace?.conversation || [], toolCalls);

      return `
        <div class="detail-variant-card ${isBest ? "best" : ""}">
          <div class="detail-variant-header">
            <span class="detail-variant-name">${escapeHtml(item.variant)}</span>
            <span class="detail-variant-status ${statusClass}">${statusText} (${avgScore.toFixed(2)})</span>
          </div>
          <div class="detail-variant-metrics">
            <div class="detail-metric">
              <span class="label">Duration</span>
              <span class="value">${formatDuration(result.trace?.duration_ms || 0)}</span>
            </div>
            <div class="detail-metric">
              <span class="label">Tokens</span>
              <span class="value">${formatNumber(result.trace?.usage?.total_tokens || 0)}</span>
            </div>
            <div class="detail-metric">
              <span class="label">Tool Calls</span>
              <span class="value">${toolCalls.length}</span>
            </div>
            <div class="detail-metric">
              <span class="label">Status</span>
              <span class="value">${result.trace?.status || "unknown"}</span>
            </div>
          </div>
          ${dimensionsHtml}
          <div class="detail-section">
            <div class="detail-section-title">Conversation</div>
            ${renderConversation(conversationWithTools)}
          </div>
          <div class="detail-section">
            <div class="detail-section-title">Tool Calls</div>
            ${renderToolTimeline(toolCalls)}
          </div>
          <div class="detail-section">
            <div class="detail-section-title">Final Response</div>
            <div class="final-response">${escapeHtml(result.trace?.final_response || "")}</div>
          </div>
          ${result.error ? `<div class="detail-section"><div class="detail-section-title">Error</div><div class="error-message">${escapeHtml(result.error)}</div></div>` : ""}
        </div>
      `;
    })
    .join("");

  // Render cross-variant dimension comparison
  const allDimensions = new Set();
  caseCells.forEach((item) => {
    (item.cell.result.dimensions || []).forEach((d) => allDimensions.add(d.dimension));
  });

  const crossVariantHtml =
    allDimensions.size > 0
      ? `
    <div class="cross-variant-section">
      <div class="detail-section-title">Cross-Variant Dimension Comparison</div>
      <table class="cross-variant-table">
        <thead>
          <tr>
            <th>Dimension</th>
            ${data.variants.map((v) => `<th>${escapeHtml(v)}</th>`).join("")}
          </tr>
        </thead>
        <tbody>
          ${Array.from(allDimensions)
            .map((dim) => {
              const cells = data.variants
                .map((variant) => {
                  const cell = getCell(data.cells, caseId, variant);
                  const d = cell?.result?.dimensions?.find((x) => x.dimension === dim);
                  if (!d) return "<td>—</td>";
                  return `<td class="${d.passed ? "pass" : "fail"}">${d.score.toFixed(2)}</td>`;
                })
                .join("");
              return `
                <tr>
                  <td>${escapeHtml(dim)}</td>
                  ${cells}
                </tr>
              `;
            })
            .join("")}
        </tbody>
      </table>
    </div>
  `
      : "";

  document.getElementById("modal-case-id").textContent = caseId;
  document.getElementById("modal-consistency").innerHTML = consistencyBadge;
  document.getElementById("modal-body").innerHTML = `
    <div class="detail-comparison">${variantCards}</div>
    ${crossVariantHtml}
  `;

  document.getElementById("case-modal").classList.add("open");
  document.body.style.overflow = "hidden";
}

// Close modal
function closeModal() {
  document.getElementById("case-modal").classList.remove("open");
  document.body.style.overflow = "";
}

// Handle modal backdrop click
function handleModalBackdrop(e) {
  if (e.target === document.getElementById("case-modal")) {
    closeModal();
  }
}

// Initialize
function init() {
  const data = decodePayload();
  if (!data) {
    document.body.innerHTML =
      '<div class="container"><div class="empty-state">Failed to load report data</div></div>';
    return;
  }

  // Store data globally for modal access
  window.reportData = data;

  renderSummary(data);
  renderVariantCards(data);
  renderMatrixHeatmap(data);

  // Keyboard shortcuts
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeModal();
    }
  });
}

// Run on load
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
