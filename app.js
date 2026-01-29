import {
  SHEET_DEFS,
  FIELD_DEFS,
  buildAutoMapping,
  buildAuditResults,
  getEffectiveSheetDefs,
  normalizeRow,
} from "./audit.js";
import { requestAuditSummaries } from "./ai.js";

const REQUIRED_FIELDS = ["spend", "sales", "clicks", "orders"];

const state = {
  workbook: null,
  sheetData: {},
  mappingSelections: {},
  results: null,
  datasets: [],
  brandAliases: [],
  activeAdType: "",
  ai: {
    apiKey: "",
    model: "gpt-5-mini",
    bucketMap: {},
    report: null,
    status: "",
  },
  ui: {
    collapsedSections: {},
    expandedRows: {},
    detailLimits: {},
    searchTermLimits: {},
  },
};

const sortState = {};

const fileInput = document.getElementById("file-input");
const fileMeta = document.getElementById("file-meta");
const mappingPanel = document.getElementById("mapping-panel");
const dashboard = document.getElementById("dashboard");
const healthPanel = document.getElementById("health-panel");
const summaryStrip = document.getElementById("summary-strip");
const autoMapBtn = document.getElementById("auto-map-btn");
const resetBtn = document.getElementById("reset-btn");
const exportBtn = document.getElementById("export-btn");
const saveMapBtn = document.getElementById("save-map-btn");
const mapUpload = document.getElementById("map-upload");
const brandInput = document.getElementById("brand-input");
const aiKeyInput = document.getElementById("ai-key-input");
const aiModelInput = document.getElementById("ai-model-input");
const aiGenerateBtn = document.getElementById("ai-generate-btn");
const aiPrintBtn = document.getElementById("ai-print-btn");
const aiStatus = document.getElementById("ai-status");
const aiReport = document.getElementById("ai-report");

fileInput.addEventListener("change", async (event) => {
  const file = event.target.files[0];
  if (!file) {
    return;
  }
  await loadWorkbook(file);
});

autoMapBtn.addEventListener("click", () => {
  autoMapAllSheets();
  renderMappingPanel();
  recompute();
});

resetBtn.addEventListener("click", () => {
  fileInput.value = "";
  mapUpload.value = "";
  brandInput.value = "";
  aiKeyInput.value = "";
  aiModelInput.value = "gpt-5-mini";
  fileMeta.textContent = "";
  state.workbook = null;
  state.sheetData = {};
  state.mappingSelections = {};
  state.results = null;
  state.datasets = [];
  state.brandAliases = [];
  state.activeAdType = "";
  state.ai.apiKey = "";
  state.ai.model = "gpt-5-mini";
  state.ai.bucketMap = {};
  state.ai.report = null;
  state.ai.status = "";
  state.ui.collapsedSections = {};
  state.ui.expandedRows = {};
  state.ui.detailLimits = {};
  state.ui.searchTermLimits = {};
  mappingPanel.innerHTML = "";
  healthPanel.innerHTML = "";
  if (summaryStrip) {
    summaryStrip.textContent = "Upload a bulk sheet to see share metrics.";
    summaryStrip.classList.add("muted");
  }
  dashboard.textContent = "Upload a bulk sheet to see results.";
  exportBtn.disabled = true;
  aiReport.innerHTML = "Generate summaries to see the report.";
  aiStatus.textContent = "";
  updateAiControls();
});

exportBtn.addEventListener("click", () => {
  if (!state.results) {
    return;
  }
  const blob = new Blob([JSON.stringify(state.results, null, 2)], {
    type: "application/json",
  });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "amazon-audit-results.json";
  link.click();
});

saveMapBtn.addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(state.mappingSelections, null, 2)], {
    type: "application/json",
  });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "amazon-column-mapping.json";
  link.click();
});

mapUpload.addEventListener("change", async (event) => {
  const file = event.target.files[0];
  if (!file) {
    return;
  }
  const text = await file.text();
  try {
    const parsed = JSON.parse(text);
    state.mappingSelections = parsed;
    renderMappingPanel();
    recompute();
  } catch (error) {
    alert("Invalid mapping JSON file.");
  }
});

brandInput.addEventListener("input", () => {
  state.brandAliases = parseBrandAliases(brandInput.value);
  recompute();
});

if (aiKeyInput) {
  aiKeyInput.addEventListener("input", () => {
    state.ai.apiKey = aiKeyInput.value.trim();
    updateAiControls();
  });
}

if (aiModelInput) {
  aiModelInput.addEventListener("input", () => {
    state.ai.model = aiModelInput.value.trim() || "gpt-5-mini";
  });
}

if (aiGenerateBtn) {
  aiGenerateBtn.addEventListener("click", () => {
    generateSummaries();
  });
}

if (aiPrintBtn) {
  aiPrintBtn.addEventListener("click", () => {
    if (!state.ai.report) {
      return;
    }
    window.print();
  });
}

dashboard.addEventListener("click", (event) => {
  const tableMoreBtn = event.target.closest(".table-more");
  if (tableMoreBtn) {
    const tableId = tableMoreBtn.dataset.tableId;
    if (tableId) {
      state.ui.searchTermLimits[tableId] =
        (state.ui.searchTermLimits[tableId] || 10) + 10;
      renderDashboard(state.results);
    }
    return;
  }
  const showMoreBtn = event.target.closest(".detail-more");
  if (showMoreBtn) {
    const tableId = showMoreBtn.dataset.tableId;
    const rowId = showMoreBtn.dataset.rowId;
    if (tableId && rowId) {
      const key = `${tableId}:${rowId}`;
      const current = state.ui.detailLimits[key] || 10;
      state.ui.detailLimits[key] = current + 10;
      renderDashboard(state.results);
    }
    return;
  }
  const sectionToggle = event.target.closest(".section-toggle");
  if (sectionToggle) {
    const sectionId = sectionToggle.dataset.sectionId;
    if (sectionId) {
      state.ui.collapsedSections[sectionId] =
        !state.ui.collapsedSections[sectionId];
      renderDashboard(state.results);
    }
    return;
  }
  const rowToggle = event.target.closest(".row-toggle");
  if (rowToggle) {
    const tableId = rowToggle.dataset.tableId;
    const rowId = rowToggle.dataset.rowId;
    if (tableId && rowId) {
      const key = `${tableId}:${rowId}`;
      const nextExpanded = !state.ui.expandedRows[key];
      state.ui.expandedRows[key] = nextExpanded;
      if (nextExpanded && !state.ui.detailLimits[key]) {
        state.ui.detailLimits[key] = 10;
      }
      renderDashboard(state.results);
    }
    return;
  }
  const target = event.target.closest("th[data-sort-key]");
  if (!target) {
    return;
  }
  const table = target.closest("table");
  const tableId = table?.dataset.tableId;
  const sortKey = target.dataset.sortKey;
  if (!tableId || !sortKey) {
    return;
  }
  const current = sortState[tableId] || {};
  const nextDirection =
    current.key === sortKey && current.direction === "desc" ? "asc" : "desc";
  sortState[tableId] = { key: sortKey, direction: nextDirection };
  renderDashboard(state.results);
});

async function loadWorkbook(file) {
  try {
    const data = await file.arrayBuffer();
    const workbook = XLSX.read(data, { type: "array" });
    state.workbook = workbook;
    state.sheetData = {};
    state.mappingSelections = {};
    state.results = null;

    workbook.SheetNames.forEach((sheetName) => {
      const sheet = workbook.Sheets[sheetName];
      const headerRows = XLSX.utils.sheet_to_json(sheet, {
        header: 1,
        defval: "",
      });
      const columns = (headerRows[0] || []).filter(Boolean);
      const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
      state.sheetData[sheetName] = { columns, rows };
    });

    fileMeta.textContent = `${file.name} • ${workbook.SheetNames.length} sheets`;

    autoMapAllSheets();
    renderMappingPanel();
    recompute();
  } catch (error) {
    fileMeta.textContent = "Failed to parse the bulk sheet. Check the console.";
    console.error("Bulk sheet parsing failed:", error);
  }
}

function autoMapAllSheets() {
  Object.entries(state.sheetData).forEach(([sheetName, sheet]) => {
    state.mappingSelections[sheetName] = buildAutoMapping(sheet.columns);
  });
}

function renderMappingPanel() {
  mappingPanel.innerHTML = "";
  const sheetEntries = Object.entries(state.sheetData);
  if (!sheetEntries.length) {
    mappingPanel.innerHTML =
      "<div class=\"muted\">Upload a sheet to review mappings.</div>";
    return;
  }

  const supportedNames = new Set(
    getEffectiveSheetDefs(state.sheetData, SHEET_DEFS).map((def) => def.name)
  );
  const visibleEntries = sheetEntries.filter(([name]) =>
    supportedNames.has(name)
  );
  const hiddenEntries = sheetEntries.filter(
    ([name]) => !supportedNames.has(name)
  );

  if (!visibleEntries.length) {
    mappingPanel.innerHTML =
      "<div class=\"muted\">No supported sheets detected for mapping.</div>";
    return;
  }

  if (hiddenEntries.length) {
    const note = document.createElement("div");
    note.className = "muted";
    note.textContent = `Ignored sheets: ${hiddenEntries
      .map(([name]) => name)
      .join(", ")}`;
    mappingPanel.appendChild(note);
  }

  visibleEntries.forEach(([sheetName, sheet]) => {
    const section = document.createElement("div");
    section.className = "mapping-sheet";

    const title = document.createElement("h3");
    title.textContent = sheetName;
    section.appendChild(title);

    const grid = document.createElement("div");
    grid.className = "mapping-grid";

    FIELD_DEFS.forEach((field) => {
      const label = document.createElement("label");
      label.textContent = field.label;

      const select = document.createElement("select");
      const blankOption = document.createElement("option");
      blankOption.value = "";
      blankOption.textContent = "—";
      select.appendChild(blankOption);

      sheet.columns.forEach((column) => {
        const option = document.createElement("option");
        option.value = column;
        option.textContent = column;
        select.appendChild(option);
      });

      const selection =
        (state.mappingSelections[sheetName] || {})[field.key] || "";
      select.value = selection;

      select.addEventListener("change", () => {
        state.mappingSelections[sheetName] =
          state.mappingSelections[sheetName] || {};
        state.mappingSelections[sheetName][field.key] = select.value;
        recompute();
      });

      grid.appendChild(label);
      grid.appendChild(select);
    });

    section.appendChild(grid);
    mappingPanel.appendChild(section);
  });
}

function recompute() {
  if (!state.workbook) {
    return;
  }

  const health = [];
  const datasets = [];
  const effectiveDefs = getEffectiveSheetDefs(state.sheetData, SHEET_DEFS);
  effectiveDefs.forEach((def) => {
    const sheet = state.sheetData[def.name];
    if (!sheet) {
      return;
    }
    const mapping = state.mappingSelections[def.name] || {};
    const missing = REQUIRED_FIELDS.filter((field) => !mapping[field]);
    if (missing.length) {
      health.push({
        sheet: def.name,
        missing,
      });
    }
    const rows = sheet.rows.map((row) =>
      normalizeRow(row, mapping, def.adType, def.kind)
    );
    datasets.push({ def, rows });
  });

  renderHealthPanel(health);

  state.results = buildAuditResults(datasets, {
    brandAliases: state.brandAliases,
  });
  state.datasets = datasets;
  resetAiSummaries("Data updated. Generate summaries to refresh AI insights.");
  renderDashboard(state.results);
  exportBtn.disabled = false;
}

function renderHealthPanel(health) {
  healthPanel.innerHTML = "";
  if (!health.length) {
    const item = document.createElement("div");
    item.className = "health-item ok";
    item.textContent = "All required columns detected for core metrics.";
    healthPanel.appendChild(item);
    return;
  }
  health.forEach((issue) => {
    const item = document.createElement("div");
    item.className = "health-item";
    item.textContent = `${issue.sheet}: missing ${issue.missing.join(", ")}`;
    healthPanel.appendChild(item);
  });
}

function renderDashboard(results) {
  if (!results || !Object.keys(results.adTypes).length) {
    dashboard.textContent = "No supported sheets were detected.";
    if (summaryStrip) {
      summaryStrip.textContent = "No share metrics available.";
      summaryStrip.classList.add("muted");
    }
    return;
  }

  const adTypes = Object.keys(results.adTypes);
  let activeType = state.activeAdType || adTypes[0];
  if (!adTypes.includes(activeType)) {
    activeType = adTypes[0];
    state.activeAdType = activeType;
  }

  const tabBar = document.createElement("div");
  tabBar.className = "tab-bar";

  const container = document.createElement("div");
  container.className = "dashboard";

  function renderActive() {
    container.innerHTML = "";
    const data = results.adTypes[activeType];
    if (!data) {
      container.innerHTML = `<div class="muted">No ${activeType} data.</div>`;
      return;
    }

    const summary = document.createElement("div");
    summary.className = "section";
    summary.innerHTML = `
      <h3>${activeType} Summary</h3>
      <div class="kpi-grid">
        ${renderKpi("Spend", formatCurrency(data.summary.spend))}
        ${renderKpi("Sales", formatCurrency(data.summary.sales))}
        ${renderKpi("Spend Share %", formatPercent(data.summary.spendSharePct))}
        ${renderKpi("Sales Share %", formatPercent(data.summary.salesSharePct))}
        ${renderKpi("ACoS", formatPercent(data.summary.acos))}
        ${renderKpi("RoAS", formatNumber(data.summary.roas))}
        ${renderKpi("Avg CPC", formatCurrency(data.summary.cpc))}
        ${renderKpi("CVR", formatPercent(data.summary.cvr))}
      </div>
    `;
    container.appendChild(summary);

    container.appendChild(
      buildSection(
        "Campaign ACoS buckets",
        renderBucketTable(data.campaignBuckets, "campaignBuckets", {
          detailLabel: "Campaign",
        }),
        renderBucketSummary(activeType, "campaignBuckets"),
        { sectionId: `${activeType}:campaignBuckets` }
      )
    );
    container.appendChild(
      buildSection(
        "Match type buckets",
        renderMatchTypeTable(data.matchTypeBuckets, "matchTypeBuckets"),
        renderBucketSummary(activeType, "matchTypeBuckets"),
        { sectionId: `${activeType}:matchTypeBuckets` }
      )
    );
    container.appendChild(
      buildSection(
        "Paused bucket",
        renderPausedTable(data.pausedBuckets, "pausedBuckets"),
        renderBucketSummary(activeType, "pausedBuckets"),
        { sectionId: `${activeType}:pausedBuckets` }
      )
    );
    if (data.placementBuckets?.length) {
      container.appendChild(
        buildSection(
          "Placement buckets",
          renderPlacementTable(data.placementBuckets, "placementBuckets"),
          renderBucketSummary(activeType, "placementBuckets"),
          { sectionId: `${activeType}:placementBuckets` }
        )
      );
    }
    if (data.biddingStrategyBuckets?.length) {
      container.appendChild(
        buildSection(
          "Campaign bidding strategies",
          renderBiddingStrategyTable(
            data.biddingStrategyBuckets,
            "biddingStrategyBuckets"
          ),
          renderBucketSummary(activeType, "biddingStrategyBuckets"),
          { sectionId: `${activeType}:biddingStrategyBuckets` }
        )
      );
    }
    container.appendChild(
      buildSection(
        "Keyword ACoS buckets",
        renderBucketTable(data.keywordBuckets, "keywordBuckets", {
          detailLabel: "Keyword",
        }),
        renderBucketSummary(activeType, "keywordBuckets"),
        { sectionId: `${activeType}:keywordBuckets` }
      )
    );
    container.appendChild(
      buildSection(
        "ASIN ACoS buckets",
        renderBucketTable(data.asinBuckets, "asinBuckets", {
          detailLabel: "ASIN",
        }),
        renderBucketSummary(activeType, "asinBuckets"),
        { sectionId: `${activeType}:asinBuckets` }
      )
    );
    container.appendChild(
      buildSection(
        "Unique search terms (keywords)",
        renderSearchTermTable(
          data.searchTermInsights.uniqueKeywords,
          "uniqueKeywords"
        ),
        renderBucketSummary(activeType, "uniqueKeywords"),
        { sectionId: `${activeType}:uniqueKeywords` }
      )
    );
    container.appendChild(
      buildSection(
        "Unique search terms (ASINs)",
        renderSearchTermTable(data.searchTermInsights.uniqueAsins, "uniqueAsins"),
        renderBucketSummary(activeType, "uniqueAsins"),
        { sectionId: `${activeType}:uniqueAsins` }
      )
    );
  }

  adTypes.forEach((adType) => {
    const btn = document.createElement("button");
    btn.className = `tab-btn ${adType === activeType ? "active" : ""}`;
    btn.textContent = adType;
    btn.addEventListener("click", () => {
      activeType = adType;
      state.activeAdType = adType;
      tabBar.querySelectorAll("button").forEach((button) => {
        button.classList.toggle("active", button.textContent === adType);
      });
      renderActive();
    });
    tabBar.appendChild(btn);
  });

  if (summaryStrip) {
    renderSummaryStrip(results);
  }
  dashboard.innerHTML = "";
  dashboard.appendChild(tabBar);
  dashboard.appendChild(container);
  renderActive();
}

function renderSummaryStrip(results) {
  if (!summaryStrip) {
    return;
  }
  const order = ["SP", "SB", "SD"];
  const entries = order.filter((type) => results.adTypes[type]);
  if (!entries.length) {
    summaryStrip.textContent = "No share metrics available.";
    summaryStrip.classList.add("muted");
    return;
  }
  summaryStrip.classList.remove("muted");
  summaryStrip.innerHTML = entries
    .map((type) => {
      const summary = results.adTypes[type].summary || {};
      return `
        <div class="summary-card">
          <div class="summary-title">${type} Share</div>
          <div class="summary-circles">
            ${renderShareCircle("Spend Share", summary.spendSharePct, "blue")}
            ${renderShareCircle("Sales Share", summary.salesSharePct, "green")}
          </div>
        </div>
      `;
    })
    .join("");
}

function renderShareCircle(label, value, tone) {
  const safeValue = value ?? null;
  const pct = clampPercent(safeValue);
  const display = safeValue === null ? "—" : formatPercent(safeValue);
  return `
    <div class="share-circle ${tone}">
      <div class="circle" style="--pct: ${pct}">
        <span>${display}</span>
      </div>
      <div class="circle-label">${label}</div>
    </div>
  `;
}

function clampPercent(value) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}

function buildSection(title, contentHtml, summaryHtml = "", options = {}) {
  const sectionId = options.sectionId || title;
  const isCollapsed = !!state.ui.collapsedSections[sectionId];
  const section = document.createElement("div");
  section.className = `section section-collapsible ${
    isCollapsed ? "is-collapsed" : ""
  }`;
  section.innerHTML = `
    <div class="section-header">
      <h3>${title}</h3>
      <button class="section-toggle" data-section-id="${sectionId}" aria-expanded="${
    !isCollapsed
  }">
        <span>${isCollapsed ? "Expand" : "Collapse"}</span>
        <span class="caret"></span>
      </button>
    </div>
    <div class="section-body">
      ${summaryHtml}${contentHtml}
    </div>
  `;
  return section;
}

function renderBucketSummary(adType, bucketKey) {
  const entry = state.ai.bucketMap?.[`${adType}:${bucketKey}`];
  if (!entry) {
    return `<div class="ai-summary muted">AI summary will appear here after generation.</div>`;
  }
  const insights = (entry.insights || []).slice(0, 3);
  const insightsHtml = insights.length
    ? `<ul>${insights
        .map((insight) => {
          const evidence = (insight.evidence || [])
            .map((item) => `${escapeHtml(item.label)}: ${escapeHtml(item.value)}`)
            .join(", ");
          return `
          <li>
            <strong>${escapeHtml(insight.title)}</strong>
            <span class="ai-detail">— ${escapeHtml(insight.detail)}</span>
            <span class="ai-action">Action:</span>
            <span class="ai-detail">${escapeHtml(insight.action)}</span>
            ${
              evidence
                ? `<span class="ai-evidence">(${evidence})</span>`
                : ""
            }
          </li>
        `;
        })
        .join("")}</ul>`
    : "";

  return `
    <div class="ai-summary">
      <p>${escapeHtml(entry.summary)}</p>
      ${insightsHtml}
    </div>
  `;
}

function renderReport() {
  if (!aiReport) {
    return;
  }
  if (!state.ai.report) {
    aiReport.innerHTML = "Generate summaries to see the report.";
    aiReport.classList.add("muted");
    return;
  }

  const report = state.ai.report;
  aiReport.classList.remove("muted");
  aiReport.innerHTML = `
    <div class="report-header">
      <h3>${escapeHtml(report.headline)}</h3>
      <p>${escapeHtml(report.overview)}</p>
    </div>
    ${renderReportChecklist(report.checklist || [])}
    ${report.sections
      .map((section) => renderReportSection(section))
      .join("")}
  `;
}

function renderReportSection(section) {
  const insightsHtml = (section.insights || [])
    .map((insight) => {
      const evidence = (insight.evidence || [])
        .map((item) => `${escapeHtml(item.label)}: ${escapeHtml(item.value)}`)
        .join(", ");
      return `
        <li>
          <strong>${escapeHtml(insight.title)}</strong>
          <span class="ai-detail">— ${escapeHtml(insight.detail)}</span>
          <span class="ai-action">Action:</span>
          <span class="ai-detail">${escapeHtml(insight.action)}</span>
          ${
            evidence
            ? `<span class="ai-evidence">(${evidence})</span>`
              : ""
          }
        </li>
      `;
    })
    .join("");

  return `
    <div class="report-section">
      <h4>${escapeHtml(section.adType)} Audit Summary</h4>
      <p>${escapeHtml(section.summary)}</p>
      ${insightsHtml ? `<ul>${insightsHtml}</ul>` : ""}
    </div>
  `;
}

function renderReportChecklist(items) {
  if (!items.length) {
    return "";
  }
  const grouped = items.reduce((acc, item) => {
    acc[item.adType] = acc[item.adType] || [];
    acc[item.adType].push(item);
    return acc;
  }, {});

  return `
    <div class="report-checklist">
      <h4>Checklist</h4>
      ${Object.entries(grouped)
        .map(([adType, entries]) => {
          return `
            <div class="report-checklist-group">
              <h5>${escapeHtml(adType)}</h5>
              <ul>
                ${entries
                  .map((entry) => {
                    return `<li>${escapeHtml(entry.actionText)}</li>`;
                  })
                  .join("")}
              </ul>
            </div>
          `;
        })
        .join("")}
    </div>
  `;
}

function updateAiControls() {
  if (aiGenerateBtn) {
    aiGenerateBtn.disabled = !state.results || !state.ai.apiKey;
  }
  if (aiPrintBtn) {
    aiPrintBtn.disabled = !state.ai.report;
  }
}

function setAiStatus(message) {
  state.ai.status = message;
  if (aiStatus) {
    aiStatus.textContent = message || "";
  }
}

function resetAiSummaries(message) {
  state.ai.bucketMap = {};
  state.ai.report = null;
  setAiStatus(message || "");
  renderReport();
  updateAiControls();
}

function renderBucketTable(rows, tableId, options = {}) {
  if (!rows.length) {
    return `<div class="muted">No bucket data available.</div>`;
  }
  const detailLabel = options.detailLabel || "Entity";
  const detailColumns = [
    {
      label: detailLabel,
      key: "label",
      accessor: (item) => item.label,
      render: (item) => escapeHtml(item.label),
    },
    {
      label: "Spend %",
      key: "spendSharePct",
      accessor: (item) => item.spendSharePct,
      render: (item) => formatPercent(item.spendSharePct),
    },
    {
      label: "Sales %",
      key: "salesSharePct",
      accessor: (item) => item.salesSharePct,
      render: (item) => formatPercent(item.salesSharePct),
    },
    {
      label: "Spend",
      key: "spend",
      accessor: (item) => item.spend,
      render: (item) => formatCurrency(item.spend),
    },
    {
      label: "Sales",
      key: "sales",
      accessor: (item) => item.sales,
      render: (item) => formatCurrency(item.sales),
    },
    {
      label: "ACoS",
      key: "acos",
      accessor: (item) => item.acos,
      render: (item) => formatPercent(item.acos),
    },
    {
      label: "RoAS",
      key: "roas",
      accessor: (item) => item.roas,
      render: (item) => formatNumber(item.roas),
    },
  ];
  const sortedRows = sortRows(rows, tableId, {
    bucket: (row) => row.bucket,
    spendPct: (row) => row.spendPct,
    salesPct: (row) => row.salesPct,
    spend: (row) => row.spend,
    sales: (row) => row.sales,
    avgCpc: (row) => row.avgCpc,
  });
  return `
    <table data-table-id="${tableId}">
      <thead>
        <tr>
          <th class="col-toggle"></th>
          ${renderHeader("Bucket", "bucket", tableId)}
          ${renderHeader("Spend %", "spendPct", tableId)}
          ${renderHeader("Sales %", "salesPct", tableId)}
          ${renderHeader("Spend", "spend", tableId)}
          ${renderHeader("Sales", "sales", tableId)}
          ${renderHeader("Avg CPC", "avgCpc", tableId)}
        </tr>
      </thead>
      <tbody>
        ${sortedRows
          .map((row, index) => {
            const rowId = buildRowId(`${row.bucket}-${index}`);
            return `
          <tr>
            <td class="col-toggle">${renderRowToggle(tableId, rowId)}</td>
            <td><span class="pill">${row.bucket}</span></td>
            <td>${formatPercent(row.spendPct)}</td>
            <td>${formatPercent(row.salesPct)}</td>
            <td>${formatCurrency(row.spend)}</td>
            <td>${formatCurrency(row.sales)}</td>
            <td>${formatCurrency(row.avgCpc)}</td>
          </tr>
          ${renderDetailRow(tableId, rowId, 7, {
            details: row.details || [],
            columns: detailColumns,
          })}
        `;
          })
          .join("")}
      </tbody>
    </table>
  `;
}

function renderMatchTypeTable(rows, tableId) {
  if (!rows.length) {
    return `<div class="muted">No match type data available.</div>`;
  }
  const detailColumns = [
    {
      label: "Target",
      key: "label",
      accessor: (item) => item.label,
      render: (item) => escapeHtml(item.label),
    },
    {
      label: "Spend %",
      key: "spendSharePct",
      accessor: (item) => item.spendSharePct,
      render: (item) => formatPercent(item.spendSharePct),
    },
    {
      label: "Sales %",
      key: "salesSharePct",
      accessor: (item) => item.salesSharePct,
      render: (item) => formatPercent(item.salesSharePct),
    },
    {
      label: "Spend",
      key: "spend",
      accessor: (item) => item.spend,
      render: (item) => formatCurrency(item.spend),
    },
    {
      label: "Sales",
      key: "sales",
      accessor: (item) => item.sales,
      render: (item) => formatCurrency(item.sales),
    },
    {
      label: "ACoS",
      key: "acos",
      accessor: (item) => item.acos,
      render: (item) => formatPercent(item.acos),
    },
    {
      label: "RoAS",
      key: "roas",
      accessor: (item) => item.roas,
      render: (item) => formatNumber(item.roas),
    },
  ];
  const sortedRows = sortRows(rows, tableId, {
    matchType: (row) => row.matchType,
    targetCount: (row) => row.targetCount,
    spendPct: (row) => row.spendPct,
    salesPct: (row) => row.salesPct,
    spend: (row) => row.spend,
    sales: (row) => row.sales,
    avgCpc: (row) => row.avgCpc,
    acos: (row) => row.acos,
    roas: (row) => row.roas,
  });
  return `
    <table data-table-id="${tableId}">
      <thead>
        <tr>
          <th class="col-toggle"></th>
          ${renderHeader("Match type", "matchType", tableId)}
          ${renderHeader("Targets", "targetCount", tableId)}
          ${renderHeader("Spend %", "spendPct", tableId)}
          ${renderHeader("Sales %", "salesPct", tableId)}
          ${renderHeader("Spend", "spend", tableId)}
          ${renderHeader("Sales", "sales", tableId)}
          ${renderHeader("ACoS", "acos", tableId)}
          ${renderHeader("RoAS", "roas", tableId)}
          ${renderHeader("Avg CPC", "avgCpc", tableId)}
        </tr>
      </thead>
      <tbody>
        ${sortedRows
          .map((row, index) => {
            const rowId = buildRowId(`${row.matchType}-${index}`);
            return `
          <tr>
            <td class="col-toggle">${renderRowToggle(tableId, rowId)}</td>
            <td>${renderMatchTypeLabel(row)}</td>
            <td>${row.targetCount ?? "—"}</td>
            <td>${formatPercent(row.spendPct)}</td>
            <td>${formatPercent(row.salesPct)}</td>
            <td>${formatCurrency(row.spend)}</td>
            <td>${formatCurrency(row.sales)}</td>
            <td>${formatPercent(row.acos)}</td>
            <td>${formatNumber(row.roas)}</td>
            <td>${formatCurrency(row.avgCpc)}</td>
          </tr>
          ${renderDetailRow(tableId, rowId, 10, {
            details: row.details || [],
            columns: detailColumns,
          })}
        `;
          })
          .join("")}
      </tbody>
    </table>
  `;
}

function renderMatchTypeLabel(row) {
  if (row.matchType !== "Auto" || !row.autoBreakdown?.length) {
    return row.matchType;
  }
  return `
    <details>
      <summary>Auto</summary>
      ${renderAutoBreakdownTable(row.autoBreakdown, "autoBreakdown")}
    </details>
  `;
}

function renderAutoBreakdownTable(breakdown, tableId) {
  const sortedRows = sortRows(breakdown, `${tableId}-auto`, {
    label: (item) => item.label,
    spend: (item) => item.summary.spend,
    sales: (item) => item.summary.sales,
    acos: (item) => item.summary.acos,
    cpc: (item) => item.summary.cpc,
  });
  return `
    <div class="auto-breakdown">
      <table data-table-id="${tableId}-auto">
        <thead>
          <tr>
            ${renderHeader("Auto variant", "label", `${tableId}-auto`)}
            ${renderHeader("Spend", "spend", `${tableId}-auto`)}
            ${renderHeader("Sales", "sales", `${tableId}-auto`)}
            ${renderHeader("ACoS", "acos", `${tableId}-auto`)}
            ${renderHeader("Avg CPC", "cpc", `${tableId}-auto`)}
          </tr>
        </thead>
        <tbody>
          ${sortedRows
            .map(
              (item) => `
            <tr>
              <td>${item.label}</td>
              <td>${formatCurrency(item.summary.spend)}</td>
              <td>${formatCurrency(item.summary.sales)}</td>
              <td>${formatPercent(item.summary.acos)}</td>
              <td>${formatCurrency(item.summary.cpc)}</td>
            </tr>
          `
            )
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderSearchTermTable(rows, tableId) {
  if (!rows.length) {
    return `<div class="muted">No unique terms found.</div>`;
  }
  const sortedRows = sortRows(rows, tableId, {
    term: (row) => row.term,
    spend: (row) => row.spend,
    sales: (row) => row.sales,
    acos: (row) => row.acos,
    cvr: (row) => row.cvr,
  });
  const sortLabelMap = {
    term: "term",
    spend: "spend",
    sales: "sales",
    acos: "ACoS",
    cvr: "CVR",
  };
  const currentSortKey = sortState[tableId]?.key || "spend";
  const sortLabel = sortLabelMap[currentSortKey] || "spend";
  const limit = state.ui.searchTermLimits[tableId] || 10;
  const visibleRows = sortedRows.slice(0, limit);
  const hasMore = sortedRows.length > visibleRows.length;
  return `
    <table data-table-id="${tableId}">
      <thead>
        <tr>
          ${renderHeader("Search term", "term", tableId)}
          ${renderHeader("Spend", "spend", tableId)}
          ${renderHeader("Sales", "sales", tableId)}
          ${renderHeader("ACoS", "acos", tableId)}
          ${renderHeader("CVR", "cvr", tableId)}
        </tr>
      </thead>
      <tbody>
        ${visibleRows
          .map(
            (row) => `
          <tr>
            <td>${row.term}</td>
            <td>${formatCurrency(row.spend)}</td>
            <td>${formatCurrency(row.sales)}</td>
            <td>${formatPercent(row.acos)}</td>
            <td>${formatPercent(row.cvr)}</td>
          </tr>
        `
          )
          .join("")}
      </tbody>
    </table>
    <div class="table-footer">
      <span class="muted">Showing ${visibleRows.length} of ${
    sortedRows.length
  } terms by ${sortLabel}.</span>
      ${
        hasMore
          ? `<button class="table-more" data-table-id="${tableId}">Show more</button>`
          : ""
      }
    </div>
  `;
}

function renderPausedTable(paused, tableId) {
  if (!paused) {
    return `<div class="muted">No paused data available.</div>`;
  }
  const detailsByType = paused.details || {};
  const rows = [
    {
      label: "Campaigns",
      count: paused.campaigns?.count ?? 0,
      summary: paused.campaigns?.summary ?? {},
      details: detailsByType.campaigns || [],
    },
    {
      label: "Ad Groups",
      count: paused.adGroups?.count ?? 0,
      summary: paused.adGroups?.summary ?? {},
      details: detailsByType.adGroups || [],
    },
    {
      label: "Targets",
      count: paused.targets?.count ?? 0,
      summary: paused.targets?.summary ?? {},
      details: detailsByType.targets || [],
    },
  ];
  const labelMap = {
    Campaigns: "Campaign",
    "Ad Groups": "Ad group",
    Targets: "Target",
  };
  const sortedRows = sortRows(rows, tableId, {
    label: (row) => row.label,
    count: (row) => row.count,
    spend: (row) => row.summary.spend,
    sales: (row) => row.summary.sales,
    acos: (row) => row.summary.acos,
    roas: (row) => row.summary.roas,
    cpc: (row) => row.summary.cpc,
  });
  return `
    <table data-table-id="${tableId}">
      <thead>
        <tr>
          <th class="col-toggle"></th>
          ${renderHeader("Paused type", "label", tableId)}
          ${renderHeader("Count", "count", tableId)}
          ${renderHeader("Spend", "spend", tableId)}
          ${renderHeader("Sales", "sales", tableId)}
          ${renderHeader("ACoS", "acos", tableId)}
          ${renderHeader("RoAS", "roas", tableId)}
          ${renderHeader("Avg CPC", "cpc", tableId)}
        </tr>
      </thead>
      <tbody>
        ${sortedRows
          .map((row, index) => {
            const rowId = buildRowId(`${row.label}-${index}`);
            const detailColumns = [
              {
                label: labelMap[row.label] || "Entity",
                key: "label",
                accessor: (item) => item.label,
                render: (item) => escapeHtml(item.label),
              },
              {
                label: "Spend %",
                key: "spendSharePct",
                accessor: (item) => item.spendSharePct,
                render: (item) => formatPercent(item.spendSharePct),
              },
              {
                label: "Sales %",
                key: "salesSharePct",
                accessor: (item) => item.salesSharePct,
                render: (item) => formatPercent(item.salesSharePct),
              },
              {
                label: "Spend",
                key: "spend",
                accessor: (item) => item.spend,
                render: (item) => formatCurrency(item.spend),
              },
              {
                label: "Sales",
                key: "sales",
                accessor: (item) => item.sales,
                render: (item) => formatCurrency(item.sales),
              },
              {
                label: "ACoS",
                key: "acos",
                accessor: (item) => item.acos,
                render: (item) => formatPercent(item.acos),
              },
              {
                label: "RoAS",
                key: "roas",
                accessor: (item) => item.roas,
                render: (item) => formatNumber(item.roas),
              },
            ];
            return `
          <tr>
            <td class="col-toggle">${renderRowToggle(tableId, rowId)}</td>
            <td>${row.label}</td>
            <td>${row.count}</td>
            <td>${formatCurrency(row.summary.spend ?? 0)}</td>
            <td>${formatCurrency(row.summary.sales ?? 0)}</td>
            <td>${formatPercent(row.summary.acos)}</td>
            <td>${formatNumber(row.summary.roas)}</td>
            <td>${formatCurrency(row.summary.cpc ?? 0)}</td>
          </tr>
          ${renderDetailRow(tableId, rowId, 8, {
            details: row.details || [],
            columns: detailColumns,
          })}
        `;
          })
          .join("")}
      </tbody>
    </table>
  `;
}

function renderPlacementTable(rows, tableId) {
  if (!rows.length) {
    return `<div class="muted">No placement data available.</div>`;
  }
  const detailColumns = [
    {
      label: "Campaign",
      key: "label",
      accessor: (item) => item.label,
      render: (item) => escapeHtml(item.label),
    },
    {
      label: "Spend %",
      key: "spendSharePct",
      accessor: (item) => item.spendSharePct,
      render: (item) => formatPercent(item.spendSharePct),
    },
    {
      label: "Sales %",
      key: "salesSharePct",
      accessor: (item) => item.salesSharePct,
      render: (item) => formatPercent(item.salesSharePct),
    },
    {
      label: "Spend",
      key: "spend",
      accessor: (item) => item.spend,
      render: (item) => formatCurrency(item.spend),
    },
    {
      label: "Sales",
      key: "sales",
      accessor: (item) => item.sales,
      render: (item) => formatCurrency(item.sales),
    },
    {
      label: "ACoS",
      key: "acos",
      accessor: (item) => item.acos,
      render: (item) => formatPercent(item.acos),
    },
    {
      label: "RoAS",
      key: "roas",
      accessor: (item) => item.roas,
      render: (item) => formatNumber(item.roas),
    },
  ];
  const sortedRows = sortRows(rows, tableId, {
    label: (row) => row.label,
    spendPct: (row) => row.spendPct,
    salesPct: (row) => row.salesPct,
    spend: (row) => row.spend,
    sales: (row) => row.sales,
    avgCpc: (row) => row.avgCpc,
    acos: (row) => row.acos,
    roas: (row) => row.roas,
  });
  return `
    <table data-table-id="${tableId}">
      <thead>
        <tr>
          <th class="col-toggle"></th>
          ${renderHeader("Placement", "label", tableId)}
          ${renderHeader("Spend %", "spendPct", tableId)}
          ${renderHeader("Sales %", "salesPct", tableId)}
          ${renderHeader("Spend", "spend", tableId)}
          ${renderHeader("Sales", "sales", tableId)}
          ${renderHeader("ACoS", "acos", tableId)}
          ${renderHeader("RoAS", "roas", tableId)}
          ${renderHeader("Avg CPC", "avgCpc", tableId)}
        </tr>
      </thead>
      <tbody>
        ${sortedRows
          .map((row, index) => {
            const rowId = buildRowId(`${row.label}-${index}`);
            return `
          <tr>
            <td class="col-toggle">${renderRowToggle(tableId, rowId)}</td>
            <td>${row.label}</td>
            <td>${formatPercent(row.spendPct)}</td>
            <td>${formatPercent(row.salesPct)}</td>
            <td>${formatCurrency(row.spend)}</td>
            <td>${formatCurrency(row.sales)}</td>
            <td>${formatPercent(row.acos)}</td>
            <td>${formatNumber(row.roas)}</td>
            <td>${formatCurrency(row.avgCpc)}</td>
          </tr>
          ${renderDetailRow(tableId, rowId, 9, {
            details: row.details || [],
            columns: detailColumns,
          })}
        `;
          })
          .join("")}
      </tbody>
    </table>
  `;
}

function renderBiddingStrategyTable(rows, tableId) {
  if (!rows.length) {
    return `<div class="muted">No bidding strategy data available.</div>`;
  }
  const detailColumns = [
    {
      label: "Campaign",
      key: "label",
      accessor: (item) => item.label,
      render: (item) => escapeHtml(item.label),
    },
    {
      label: "Spend %",
      key: "spendSharePct",
      accessor: (item) => item.spendSharePct,
      render: (item) => formatPercent(item.spendSharePct),
    },
    {
      label: "Sales %",
      key: "salesSharePct",
      accessor: (item) => item.salesSharePct,
      render: (item) => formatPercent(item.salesSharePct),
    },
    {
      label: "Spend",
      key: "spend",
      accessor: (item) => item.spend,
      render: (item) => formatCurrency(item.spend),
    },
    {
      label: "Sales",
      key: "sales",
      accessor: (item) => item.sales,
      render: (item) => formatCurrency(item.sales),
    },
    {
      label: "ACoS",
      key: "acos",
      accessor: (item) => item.acos,
      render: (item) => formatPercent(item.acos),
    },
    {
      label: "RoAS",
      key: "roas",
      accessor: (item) => item.roas,
      render: (item) => formatNumber(item.roas),
    },
  ];
  const sortedRows = sortRows(rows, tableId, {
    label: (row) => row.label,
    spendPct: (row) => row.spendPct,
    salesPct: (row) => row.salesPct,
    spend: (row) => row.spend,
    sales: (row) => row.sales,
    avgCpc: (row) => row.avgCpc,
    acos: (row) => row.acos,
    roas: (row) => row.roas,
  });
  return `
    <table data-table-id="${tableId}">
      <thead>
        <tr>
          <th class="col-toggle"></th>
          ${renderHeader("Bidding strategy", "label", tableId)}
          ${renderHeader("Spend %", "spendPct", tableId)}
          ${renderHeader("Sales %", "salesPct", tableId)}
          ${renderHeader("Spend", "spend", tableId)}
          ${renderHeader("Sales", "sales", tableId)}
          ${renderHeader("ACoS", "acos", tableId)}
          ${renderHeader("RoAS", "roas", tableId)}
          ${renderHeader("Avg CPC", "avgCpc", tableId)}
        </tr>
      </thead>
      <tbody>
        ${sortedRows
          .map((row, index) => {
            const rowId = buildRowId(`${row.label}-${index}`);
            return `
          <tr>
            <td class="col-toggle">${renderRowToggle(tableId, rowId)}</td>
            <td>${row.label}</td>
            <td>${formatPercent(row.spendPct)}</td>
            <td>${formatPercent(row.salesPct)}</td>
            <td>${formatCurrency(row.spend)}</td>
            <td>${formatCurrency(row.sales)}</td>
            <td>${formatPercent(row.acos)}</td>
            <td>${formatNumber(row.roas)}</td>
            <td>${formatCurrency(row.avgCpc)}</td>
          </tr>
          ${renderDetailRow(tableId, rowId, 9, {
            details: row.details || [],
            columns: detailColumns,
          })}
        `;
          })
          .join("")}
      </tbody>
    </table>
  `;
}

async function generateSummaries() {
  if (!state.results) {
    setAiStatus("Upload a bulk sheet before generating summaries.");
    return;
  }
  if (!state.ai.apiKey) {
    setAiStatus("Enter an OpenAI API key to generate summaries.");
    return;
  }

  aiGenerateBtn.disabled = true;
  setAiStatus("Generating AI summaries...");

  const payload = buildAiPayload(state.results, state.datasets);
  const systemText =
    "You are an Amazon Ads analyst. Produce concise, action-oriented audit insights. " +
    "Use only the provided data. Keep bucket summaries to 1-2 sentences. " +
    "Provide up to 3 insights per bucket and up to 5 per report section. " +
    "Use checklistCandidates to produce report.checklist items (max 5 per bucket). " +
    "Do not include numeric change prescriptions (e.g., reduce bid 10%). " +
    "Return JSON that matches the schema exactly. Do not include markdown or extra text.";
  const userText = `Audit data (JSON):\n${JSON.stringify(payload)}`;

  try {
    const response = await requestAuditSummaries({
      apiKey: state.ai.apiKey,
      model: state.ai.model || "gpt-5-mini",
      systemText,
      userText,
    });

    if (!response?.buckets || !response?.report) {
      throw new Error("AI response missing required fields.");
    }

    state.ai.bucketMap = indexBucketSummaries(response.buckets);
    state.ai.report = response.report;
    renderDashboard(state.results);
    renderReport();
    setAiStatus("Summaries generated.");
  } catch (error) {
    setAiStatus(error.message || "Failed to generate AI summaries.");
  } finally {
    aiGenerateBtn.disabled = false;
    updateAiControls();
  }
}

function buildAiPayload(results, datasets = []) {
  const checklistCandidates = buildChecklistCandidates(results, datasets);
  return {
    engineVersion: results.engineVersion,
    generatedAt: results.generatedAt,
    adTypes: Object.entries(results.adTypes).map(([adType, data]) => ({
      adType,
      searchTerms: {
        uniqueKeywords: data.searchTermInsights?.uniqueKeywords?.length || 0,
        uniqueAsins: data.searchTermInsights?.uniqueAsins?.length || 0,
      },
      summary: {
        spend: data.summary.spend,
        sales: data.summary.sales,
        spendSharePct: data.summary.spendSharePct,
        salesSharePct: data.summary.salesSharePct,
        acos: data.summary.acos,
        roas: data.summary.roas,
        cpc: data.summary.cpc,
        cvr: data.summary.cvr,
      },
      checklistCandidates: checklistCandidates[adType] || [],
      buckets: [
        buildBucketPayload(
          "campaignBuckets",
          "Campaign ACoS buckets",
          summarizeBucketRows(data.campaignBuckets, (row) => row.spend)
        ),
        buildBucketPayload(
          "matchTypeBuckets",
          "Match type buckets",
          summarizeMatchTypeRows(data.matchTypeBuckets)
        ),
        buildBucketPayload(
          "pausedBuckets",
          "Paused bucket",
          summarizePausedRows(data.pausedBuckets)
        ),
        buildBucketPayload(
          "placementBuckets",
          "Placement buckets",
          summarizePlacementRows(data.placementBuckets || [])
        ),
        buildBucketPayload(
          "biddingStrategyBuckets",
          "Campaign bidding strategies",
          summarizePlacementRows(data.biddingStrategyBuckets || [])
        ),
        buildBucketPayload(
          "keywordBuckets",
          "Keyword ACoS buckets",
          summarizeBucketRows(data.keywordBuckets, (row) => row.spend)
        ),
        buildBucketPayload(
          "asinBuckets",
          "ASIN ACoS buckets",
          summarizeBucketRows(data.asinBuckets, (row) => row.spend)
        ),
        buildBucketPayload(
          "uniqueKeywords",
          "Unique search terms (keywords)",
          summarizeSearchTermRows(
            data.searchTermInsights?.uniqueKeywords || []
          )
        ),
        buildBucketPayload(
          "uniqueAsins",
          "Unique search terms (ASINs)",
          summarizeSearchTermRows(data.searchTermInsights?.uniqueAsins || [])
        ),
      ],
    })),
  };
}

function buildBucketPayload(bucketKey, bucketLabel, rows) {
  return { bucketKey, bucketLabel, rows };
}

function buildChecklistCandidates(results, datasets) {
  const byAdType = {};
  const datasetsByType = datasets.reduce((acc, item) => {
    acc[item.def.adType] = acc[item.def.adType] || [];
    acc[item.def.adType].push(item);
    return acc;
  }, {});

  Object.keys(results.adTypes || {}).forEach((adType) => {
    const typeDatasets = datasetsByType[adType] || [];
    const campaignRows = typeDatasets
      .filter((set) => set.def.kind === "campaign")
      .flatMap((set) => set.rows);
    const searchRows = typeDatasets
      .filter((set) => set.def.kind === "searchTerm")
      .flatMap((set) => set.rows);
    const data = results.adTypes[adType];

    const candidates = [];
    candidates.push(
      ...buildCampaignChecklist(adType, campaignRows, "campaignBuckets")
    );
    candidates.push(
      ...buildKeywordChecklist(adType, campaignRows, "keywordBuckets")
    );
    candidates.push(...buildAsinChecklist(adType, campaignRows, "asinBuckets"));
    candidates.push(
      ...buildSearchTermChecklist(adType, searchRows, "searchTerms")
    );
    candidates.push(
      ...buildOpportunityChecklist(
        adType,
        data.searchTermInsights?.uniqueKeywords || [],
        "uniqueKeywords"
      )
    );
    candidates.push(
      ...buildOpportunityChecklist(
        adType,
        data.searchTermInsights?.uniqueAsins || [],
        "uniqueAsins"
      )
    );
    candidates.push(
      ...buildMatchTypeChecklist(adType, data.matchTypeBuckets || [])
    );
    candidates.push(
      ...buildPlacementChecklist(adType, data.placementBuckets || [])
    );
    candidates.push(
      ...buildBiddingStrategyChecklist(adType, data.biddingStrategyBuckets || [])
    );

    byAdType[adType] = candidates;
  });

  return byAdType;
}

function buildCampaignChecklist(adType, rows, bucketKey) {
  const grouped = groupRows(rows.filter((row) => row.campaignName), (row) =>
    String(row.campaignName || row.campaignId || "").trim()
  );
  const summaries = Object.entries(grouped).map(([key, items]) => ({
    entityName: key,
    ...summarizeRows(items),
  }));
  return selectInefficient(summaries, 5).map((item) => ({
    adType,
    bucketKey,
    entityName: item.entityName,
    actionText: `Review campaign "${item.entityName}" due to inefficient performance relative to peer campaigns.`,
    evidence: buildEvidence(item),
  }));
}

function buildKeywordChecklist(adType, rows, bucketKey) {
  const keywordRows = rows.filter((row) => row.keywordText);
  const grouped = groupRows(keywordRows, (row) =>
    String(row.keywordText || "").trim()
  );
  const summaries = Object.entries(grouped).map(([key, items]) => ({
    entityName: key,
    campaignName: items[0]?.campaignName || "",
    ...summarizeRows(items),
  }));
  return selectInefficient(summaries, 5).map((item) => ({
    adType,
    bucketKey,
    entityName: item.entityName,
    actionText: `Consider reducing or negating "${item.entityName}" in "${item.campaignName}" due to inefficient performance.`,
    evidence: buildEvidence(item),
  }));
}

function buildAsinChecklist(adType, rows, bucketKey) {
  const asinRows = rows.filter((row) => row.asinTarget);
  const grouped = groupRows(asinRows, (row) =>
    String(row.asinTarget || "").trim()
  );
  const summaries = Object.entries(grouped).map(([key, items]) => ({
    entityName: key,
    campaignName: items[0]?.campaignName || "",
    ...summarizeRows(items),
  }));
  return selectInefficient(summaries, 5).map((item) => ({
    adType,
    bucketKey,
    entityName: item.entityName,
    actionText: `Consider reducing ASIN target "${item.entityName}" in "${item.campaignName}" due to inefficient performance.`,
    evidence: buildEvidence(item),
  }));
}

function buildSearchTermChecklist(adType, rows, bucketKey) {
  const termRows = rows.filter((row) => row.customerSearchTerm);
  const grouped = groupRows(termRows, (row) =>
    [
      String(row.campaignName || row.campaignId || "").trim(),
      String(row.customerSearchTerm || "").trim(),
    ].join("::")
  );
  const summaries = Object.values(grouped).map((items) => ({
    term: items[0]?.customerSearchTerm || "",
    campaignName: items[0]?.campaignName || "",
    ...summarizeRows(items),
  }));

  return selectInefficient(summaries, 5).map((item) => {
    const noOrders = !item.orders;
    const actionText = noOrders
      ? `Consider negating "${item.term}" in "${item.campaignName}" due to high spend with no conversions.`
      : `Consider reducing "${item.term}" in "${item.campaignName}" due to inefficient performance relative to other terms.`;
    const evidence = buildEvidence(item, { noOrders });
    return {
      adType,
      bucketKey,
      entityName: item.term,
      actionText,
      evidence,
    };
  });
}

function buildOpportunityChecklist(adType, rows, bucketKey) {
  if (!rows.length) {
    return [];
  }
  const sorted = [...rows].sort((a, b) => (b.sales || 0) - (a.sales || 0));
  return sorted.slice(0, 5).map((item) => ({
    adType,
    bucketKey,
    entityName: item.term,
    actionText: `Consider adding "${item.term}" as a target due to strong sales among untargeted terms.`,
    evidence: ["Strong sales among untargeted terms."],
  }));
}

function buildMatchTypeChecklist(adType, rows) {
  if (!rows.length) {
    return [];
  }
  const sorted = [...rows].sort((a, b) => (b.acos || 0) - (a.acos || 0));
  const worst = sorted[0];
  if (!worst || !worst.matchType) {
    return [];
  }
  return [
    {
      adType,
      bucketKey: "matchTypeBuckets",
      entityName: worst.matchType,
      actionText: `Match type "${worst.matchType}" underperforms peers; review negatives and targeting to improve efficiency.`,
      evidence: ["Underperforms other match types."],
    },
  ];
}

function buildPlacementChecklist(adType, rows) {
  if (!rows.length) {
    return [];
  }
  const sorted = [...rows].sort((a, b) => (b.acos || 0) - (a.acos || 0));
  const worst = sorted[0];
  if (!worst || !worst.label) {
    return [];
  }
  return [
    {
      adType,
      bucketKey: "placementBuckets",
      entityName: worst.label,
      actionText: `Placement "${worst.label}" underperforms peers; consider reducing exposure for this placement.`,
      evidence: ["Underperforms other placements."],
    },
  ];
}

function buildBiddingStrategyChecklist(adType, rows) {
  if (!rows.length) {
    return [];
  }
  const sorted = [...rows].sort((a, b) => (b.acos || 0) - (a.acos || 0));
  const worst = sorted[0];
  if (!worst || !worst.label) {
    return [];
  }
  return [
    {
      adType,
      bucketKey: "biddingStrategyBuckets",
      entityName: worst.label,
      actionText: `Bidding strategy "${worst.label}" appears in the least efficient segment; consider testing a more conservative strategy.`,
      evidence: ["Underperforms other bidding strategies."],
    },
  ];
}

function groupRows(rows, keyFn) {
  return rows.reduce((acc, row) => {
    const key = keyFn(row);
    if (!key) {
      return acc;
    }
    acc[key] = acc[key] || [];
    acc[key].push(row);
    return acc;
  }, {});
}

function summarizeRows(rows) {
  const spend = rows.reduce((sum, row) => sum + (row.spend || 0), 0);
  const sales = rows.reduce((sum, row) => sum + (row.sales || 0), 0);
  const orders = rows.reduce((sum, row) => sum + (row.orders || 0), 0);
  const clicks = rows.reduce((sum, row) => sum + (row.clicks || 0), 0);
  return {
    spend,
    sales,
    orders,
    clicks,
    acos: sales ? spend / sales : null,
  };
}

function selectInefficient(items, limit) {
  const sorted = [...items].sort((a, b) => {
    const aNoOrders = !a.orders;
    const bNoOrders = !b.orders;
    if (aNoOrders !== bNoOrders) {
      return aNoOrders ? -1 : 1;
    }
    const aAcos = a.acos ?? -1;
    const bAcos = b.acos ?? -1;
    if (aAcos !== bAcos) {
      return bAcos - aAcos;
    }
    return (b.spend || 0) - (a.spend || 0);
  });
  return sorted.slice(0, limit);
}

function buildEvidence(item, options = {}) {
  const evidence = [];
  if (options.noOrders) {
    evidence.push("High spend with no conversions.");
  }
  if (item.acos !== null && item.acos !== undefined) {
    evidence.push("Inefficient ACoS relative to peers.");
  }
  if (item.spend) {
    evidence.push("Material spend concentration.");
  }
  return evidence.length ? evidence : ["Underperforms peers."];
}
function summarizeBucketRows(rows, sortBy) {
  return selectTopRows(rows, sortBy).map((row) => ({
    label: row.bucket,
    spendPct: row.spendPct,
    salesPct: row.salesPct,
    spend: row.spend,
    sales: row.sales,
    avgCpc: row.avgCpc,
  }));
}

function summarizeMatchTypeRows(rows) {
  return selectTopRows(rows, (row) => row.spend).map((row) => ({
    label: row.matchType,
    targetCount: row.targetCount,
    spendPct: row.spendPct,
    salesPct: row.salesPct,
    spend: row.spend,
    sales: row.sales,
    acos: row.acos,
    roas: row.roas,
    avgCpc: row.avgCpc,
  }));
}

function summarizePlacementRows(rows) {
  return selectTopRows(rows, (row) => row.spend).map((row) => ({
    label: row.label,
    spendPct: row.spendPct,
    salesPct: row.salesPct,
    spend: row.spend,
    sales: row.sales,
    acos: row.acos,
    roas: row.roas,
    avgCpc: row.avgCpc,
  }));
}

function summarizePausedRows(paused) {
  if (!paused) {
    return [];
  }
  const rows = [
    {
      label: "Campaigns",
      count: paused.campaigns?.count ?? 0,
      summary: paused.campaigns?.summary ?? {},
    },
    {
      label: "Ad Groups",
      count: paused.adGroups?.count ?? 0,
      summary: paused.adGroups?.summary ?? {},
    },
    {
      label: "Targets",
      count: paused.targets?.count ?? 0,
      summary: paused.targets?.summary ?? {},
    },
  ];
  return rows.map((row) => ({
    label: row.label,
    count: row.count,
    spend: row.summary.spend ?? 0,
    sales: row.summary.sales ?? 0,
    acos: row.summary.acos ?? null,
    roas: row.summary.roas ?? null,
    avgCpc: row.summary.cpc ?? null,
  }));
}

function summarizeSearchTermRows(rows) {
  return selectTopRows(rows, (row) => row.spend, 10).map((row) => ({
    label: row.term,
    spend: row.spend,
    sales: row.sales,
    acos: row.acos,
    cvr: row.cvr,
  }));
}

function selectTopRows(rows, sortBy, limit = 6) {
  if (!rows?.length) {
    return [];
  }
  return [...rows]
    .sort((a, b) => (sortBy(b) || 0) - (sortBy(a) || 0))
    .slice(0, limit);
}

function indexBucketSummaries(buckets) {
  return buckets.reduce((acc, bucket) => {
    acc[`${bucket.adType}:${bucket.bucketKey}`] = bucket;
    return acc;
  }, {});
}

function renderHeader(label, key, tableId) {
  const current = sortState[tableId];
  const isActive = current?.key === key;
  const arrow = isActive ? (current.direction === "desc" ? " ▼" : " ▲") : "";
  return `<th data-sort-key="${key}" data-table-id="${tableId}">${label}${arrow}</th>`;
}

function sortRows(rows, tableId, accessors) {
  const sort = sortState[tableId];
  if (!sort || !accessors[sort.key]) {
    return rows;
  }
  const accessor = accessors[sort.key];
  const direction = sort.direction === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const aVal = accessor(a);
    const bVal = accessor(b);
    const aNum = typeof aVal === "number" ? aVal : null;
    const bNum = typeof bVal === "number" ? bVal : null;
    if (aNum !== null && bNum !== null) {
      return (aNum - bNum) * direction;
    }
    return String(aVal ?? "").localeCompare(String(bVal ?? "")) * direction;
  });
}

function buildRowId(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9_-]/g, "");
}

function isRowExpanded(tableId, rowId) {
  return !!state.ui.expandedRows[`${tableId}:${rowId}`];
}

function renderRowToggle(tableId, rowId) {
  const expanded = isRowExpanded(tableId, rowId);
  return `
    <button class="row-toggle" data-table-id="${tableId}" data-row-id="${rowId}" aria-expanded="${expanded}">
      ${expanded ? "▾" : "▸"}
    </button>
  `;
}

function getDetailLimit(tableId, rowId) {
  return state.ui.detailLimits[`${tableId}:${rowId}`] || 10;
}

function renderDetailTable(tableId, rowId, details, columns) {
  if (!details || !details.length) {
    return `<div class="muted">No details available.</div>`;
  }
  const detailTableId = `${tableId}::detail::${rowId}`;
  const accessors = columns.reduce((acc, col) => {
    if (col.key && typeof col.accessor === "function") {
      acc[col.key] = col.accessor;
    }
    return acc;
  }, {});
  const sorted = sortRows(details, detailTableId, accessors);
  const limit = getDetailLimit(tableId, rowId);
  const visible = sorted.slice(0, limit);
  const moreAvailable = details.length > visible.length;
  return `
    <div class="detail-table-wrap">
      <table class="detail-table" data-table-id="${detailTableId}">
        <thead>
          <tr>
            ${columns
              .map((col) =>
                col.key
                  ? renderHeader(col.label, col.key, detailTableId)
                  : `<th>${col.label}</th>`
              )
              .join("")}
          </tr>
        </thead>
        <tbody>
          ${visible
            .map(
              (item) => `
            <tr>
              ${columns
                .map((col) => `<td>${col.render(item)}</td>`)
                .join("")}
            </tr>
          `
            )
            .join("")}
        </tbody>
      </table>
      <div class="detail-footer">
        <span class="muted">Showing ${visible.length} of ${
    details.length
  }</span>
        ${
          moreAvailable
            ? `<button class="detail-more" data-table-id="${tableId}" data-row-id="${rowId}">Show more</button>`
            : ""
        }
      </div>
    </div>
  `;
}

function renderDetailRow(tableId, rowId, colspan, detailConfig) {
  const expanded = isRowExpanded(tableId, rowId);
  const content = detailConfig
    ? renderDetailTable(
        tableId,
        rowId,
        detailConfig.details,
        detailConfig.columns
      )
    : "";
  return `
    <tr class="row-detail ${expanded ? "is-open" : ""}">
      <td colspan="${colspan}">
        ${content}
      </td>
    </tr>
  `;
}

function renderKpi(label, value) {
  return `
    <div class="kpi">
      <h4>${label}</h4>
      <strong>${value}</strong>
    </div>
  `;
}

function formatCurrency(value) {
  if (value === null || value === undefined) {
    return "—";
  }
  return `$${value.toFixed(2)}`;
}

function formatPercent(value) {
  if (value === null || value === undefined) {
    return "—";
  }
  return `${(value * 100).toFixed(2)}%`;
}

function formatNumber(value) {
  if (value === null || value === undefined) {
    return "—";
  }
  return Number(value).toFixed(2);
}

function parseBrandAliases(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

updateAiControls();
renderReport();
