import {
  SHEET_DEFS,
  FIELD_DEFS,
  buildAutoMapping,
  buildAuditResults,
  getEffectiveSheetDefs,
  normalizeRow,
} from "./audit.js";

const REQUIRED_FIELDS = ["spend", "sales", "clicks", "orders"];

const state = {
  workbook: null,
  sheetData: {},
  mappingSelections: {},
  results: null,
  brandAliases: [],
};

const sortState = {};

const fileInput = document.getElementById("file-input");
const fileMeta = document.getElementById("file-meta");
const mappingPanel = document.getElementById("mapping-panel");
const dashboard = document.getElementById("dashboard");
const healthPanel = document.getElementById("health-panel");
const autoMapBtn = document.getElementById("auto-map-btn");
const resetBtn = document.getElementById("reset-btn");
const exportBtn = document.getElementById("export-btn");
const saveMapBtn = document.getElementById("save-map-btn");
const mapUpload = document.getElementById("map-upload");
const brandInput = document.getElementById("brand-input");

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
  fileMeta.textContent = "";
  state.workbook = null;
  state.sheetData = {};
  state.mappingSelections = {};
  state.results = null;
  state.brandAliases = [];
  mappingPanel.innerHTML = "";
  healthPanel.innerHTML = "";
  dashboard.textContent = "Upload a bulk sheet to see results.";
  exportBtn.disabled = true;
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

dashboard.addEventListener("click", (event) => {
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
    return;
  }

  const adTypes = Object.keys(results.adTypes);
  let activeType = adTypes[0];

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
        renderBucketTable(data.campaignBuckets, "campaignBuckets")
      )
    );
    container.appendChild(
      buildSection(
        "Match type buckets",
        renderMatchTypeTable(data.matchTypeBuckets, "matchTypeBuckets")
      )
    );
    container.appendChild(
      buildSection(
        "Paused bucket",
        renderPausedTable(data.pausedBuckets, "pausedBuckets")
      )
    );
    if (data.placementBuckets?.length) {
      container.appendChild(
        buildSection(
          "Placement buckets",
          renderPlacementTable(data.placementBuckets, "placementBuckets")
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
          )
        )
      );
    }
    container.appendChild(
      buildSection(
        "Keyword ACoS buckets",
        renderBucketTable(data.keywordBuckets, "keywordBuckets")
      )
    );
    container.appendChild(
      buildSection(
        "ASIN ACoS buckets",
        renderBucketTable(data.asinBuckets, "asinBuckets")
      )
    );
    container.appendChild(
      buildSection(
        "Unique search terms (keywords)",
        renderSearchTermTable(
          data.searchTermInsights.uniqueKeywords,
          "uniqueKeywords"
        )
      )
    );
    container.appendChild(
      buildSection(
        "Unique search terms (ASINs)",
        renderSearchTermTable(data.searchTermInsights.uniqueAsins, "uniqueAsins")
      )
    );
  }

  adTypes.forEach((adType) => {
    const btn = document.createElement("button");
    btn.className = `tab-btn ${adType === activeType ? "active" : ""}`;
    btn.textContent = adType;
    btn.addEventListener("click", () => {
      activeType = adType;
      tabBar.querySelectorAll("button").forEach((button) => {
        button.classList.toggle("active", button.textContent === adType);
      });
      renderActive();
    });
    tabBar.appendChild(btn);
  });

  dashboard.innerHTML = "";
  dashboard.appendChild(tabBar);
  dashboard.appendChild(container);
  renderActive();
}

function buildSection(title, contentHtml) {
  const section = document.createElement("div");
  section.className = "section";
  section.innerHTML = `<h3>${title}</h3>${contentHtml}`;
  return section;
}

function renderBucketTable(rows, tableId) {
  if (!rows.length) {
    return `<div class="muted">No bucket data available.</div>`;
  }
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
          .map(
            (row) => `
          <tr>
            <td><span class="pill">${row.bucket}</span></td>
            <td>${formatPercent(row.spendPct)}</td>
            <td>${formatPercent(row.salesPct)}</td>
            <td>${formatCurrency(row.spend)}</td>
            <td>${formatCurrency(row.sales)}</td>
            <td>${formatCurrency(row.avgCpc)}</td>
          </tr>
        `
          )
          .join("")}
      </tbody>
    </table>
  `;
}

function renderMatchTypeTable(rows, tableId) {
  if (!rows.length) {
    return `<div class="muted">No match type data available.</div>`;
  }
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
          .map(
            (row) => `
          <tr>
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
        `
          )
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
  const topRows = sortRows(rows, tableId, {
    term: (row) => row.term,
    spend: (row) => row.spend,
    sales: (row) => row.sales,
    acos: (row) => row.acos,
    cvr: (row) => row.cvr,
  }).slice(0, 50);
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
        ${topRows
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
    <div class="muted">Showing top ${topRows.length} terms by spend.</div>
  `;
}

function renderPausedTable(paused, tableId) {
  if (!paused) {
    return `<div class="muted">No paused data available.</div>`;
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
          .map(
            (row) => `
          <tr>
            <td>${row.label}</td>
            <td>${row.count}</td>
            <td>${formatCurrency(row.summary.spend ?? 0)}</td>
            <td>${formatCurrency(row.summary.sales ?? 0)}</td>
            <td>${formatPercent(row.summary.acos)}</td>
            <td>${formatNumber(row.summary.roas)}</td>
            <td>${formatCurrency(row.summary.cpc ?? 0)}</td>
          </tr>
        `
          )
          .join("")}
      </tbody>
    </table>
  `;
}

function renderPlacementTable(rows, tableId) {
  if (!rows.length) {
    return `<div class="muted">No placement data available.</div>`;
  }
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
          .map(
            (row) => `
          <tr>
            <td>${row.label}</td>
            <td>${formatPercent(row.spendPct)}</td>
            <td>${formatPercent(row.salesPct)}</td>
            <td>${formatCurrency(row.spend)}</td>
            <td>${formatCurrency(row.sales)}</td>
            <td>${formatPercent(row.acos)}</td>
            <td>${formatNumber(row.roas)}</td>
            <td>${formatCurrency(row.avgCpc)}</td>
          </tr>
        `
          )
          .join("")}
      </tbody>
    </table>
  `;
}

function renderBiddingStrategyTable(rows, tableId) {
  if (!rows.length) {
    return `<div class="muted">No bidding strategy data available.</div>`;
  }
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
          .map(
            (row) => `
          <tr>
            <td>${row.label}</td>
            <td>${formatPercent(row.spendPct)}</td>
            <td>${formatPercent(row.salesPct)}</td>
            <td>${formatCurrency(row.spend)}</td>
            <td>${formatCurrency(row.sales)}</td>
            <td>${formatPercent(row.acos)}</td>
            <td>${formatNumber(row.roas)}</td>
            <td>${formatCurrency(row.avgCpc)}</td>
          </tr>
        `
          )
          .join("")}
      </tbody>
    </table>
  `;
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
