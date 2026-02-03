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
const AD_TYPE_OPTIONS = ["All", "SP", "SB", "SD"];

const state = {
  sessions: [],
  activeSessionId: null,
  workbook: null,
  sheetData: {},
  mappingSelections: {},
  results: null,
  datasets: [],
  brandAliases: [],
  accountTotals: null,
  health: [],
  ai: {
    apiKey: "",
    model: "gpt-5-mini",
    bucketMap: {},
    report: null,
    status: "",
  },
  ui: {
    activeSection: "overview",
    viewMode: "groups",
    searchQuery: "",
    sortKey: "spend",
    sortDirection: "desc",
    adTypeFilter: "All",
    selectedEntity: null,
    selectedBucket: null,
    inspectorPinned: false,
    inspectorOpen: true,
    tableLimit: 20,
    inspectorDetailLimit: 25,
    detailSortKey: "spend",
    detailSortDirection: "desc",
    searchTermFilter: "terms",
    negativeKeywordFilter: "keywords",
    groupedBy: "acos",
  },
};

const fileInput = document.getElementById("file-input");
const fileMeta = document.getElementById("file-meta");
const fileWarning = document.getElementById("file-warning");
const mappingPanel = document.getElementById("mapping-panel");
const autoMapBtn = document.getElementById("auto-map-btn");
const saveMapBtn = document.getElementById("save-map-btn");
const mapUpload = document.getElementById("map-upload");
const brandInput = document.getElementById("brand-input");
const aiKeyInput = document.getElementById("ai-key-input");
const aiModelInput = document.getElementById("ai-model-input");
const aiGenerateBtn = document.getElementById("ai-generate-btn");
const aiPrintBtn = document.getElementById("ai-print-btn");
const aiStatus = document.getElementById("ai-status");
const aiReport = document.getElementById("ai-report");

const sessionSelect = document.getElementById("session-select");
const topbarMetrics = document.getElementById("topbar-metrics");
const navItems = document.querySelectorAll("[data-section]");
const homeView = document.getElementById("home-view");
const sessionView = document.getElementById("session-view");
const workspaceContent = document.getElementById("workspace-content");
const workspaceTitle = document.getElementById("workspace-title");
const workspaceBreadcrumb = document.getElementById("workspace-breadcrumb");
const workspaceControls = document.querySelector(".workspace-controls");
const searchInput = document.getElementById("search-input");
const sortSelect = document.getElementById("sort-select");
const viewButtons = document.querySelectorAll("[data-view]");
const viewToggle = document.querySelector(".view-toggle");
const adTypeFilter = document.getElementById("adtype-filter");
const groupedByWrap = document.getElementById("grouped-by-wrap");
const groupedBySelect = document.getElementById("grouped-by");
const searchTermFilter = document.getElementById("searchterm-filter");
const searchTermFilterWrap = document.getElementById("searchterm-filter-wrap");
const searchTermExport = document.getElementById("searchterm-export");
const negativeFilter = document.getElementById("negative-filter");
const negativeFilterWrap = document.getElementById("negative-filter-wrap");

const inspector = document.getElementById("inspector");
const inspectorTitle = document.getElementById("inspector-title");
const inspectorType = document.getElementById("inspector-type");
const inspectorBody = document.getElementById("inspector-body");
const inspectorPin = document.getElementById("inspector-pin");
const inspectorClose = document.getElementById("inspector-close");

const uploadModal = document.getElementById("upload-modal");
const uploadOpen = document.getElementById("upload-open");
const uploadClose = document.getElementById("upload-close");
const uploadCreate = document.getElementById("upload-create");
const uploadName = document.getElementById("upload-name");
const uploadDateStart = document.getElementById("upload-date-start");
const uploadDateEnd = document.getElementById("upload-date-end");
const uploadNotes = document.getElementById("upload-notes");

const settingsModal = document.getElementById("settings-modal");
const settingsOpen = document.getElementById("settings-open");
const settingsClose = document.getElementById("settings-close");
const appBody = document.querySelector(".app-body");

function openModal(modal) {
  if (modal) {
    modal.classList.remove("hidden");
  }
}

function closeModal(modal) {
  if (modal) {
    modal.classList.add("hidden");
  }
}

function setCreateLoading(isLoading) {
  if (!uploadCreate) {
    return;
  }
  uploadCreate.disabled = isLoading;
  uploadCreate.classList.toggle("is-loading", isLoading);
  uploadCreate.innerHTML = isLoading
    ? `<span class="spinner" aria-hidden="true"></span>Creating...`
    : "Create session";
}

function updateSessionSelect() {
  if (!sessionSelect) {
    return;
  }
  sessionSelect.innerHTML = "";
  const libraryOption = document.createElement("option");
  libraryOption.value = "";
  libraryOption.textContent = "Uploads Library";
  sessionSelect.appendChild(libraryOption);
  if (!state.sessions.length) {
    return;
  }
  state.sessions.slice(0, 4).forEach((session) => {
    const option = document.createElement("option");
    option.value = session.id;
    option.textContent = truncateLabel(session.name, 20);
    option.title = session.name;
    sessionSelect.appendChild(option);
  });
  if (state.activeSessionId) {
    sessionSelect.value = state.activeSessionId;
  } else {
    sessionSelect.value = "";
  }
}

function setActiveSession(sessionId) {
  if (!sessionId) {
    state.activeSessionId = null;
    renderApp();
    return;
  }
  const session = state.sessions.find((entry) => entry.id === sessionId);
  if (!session) {
    return;
  }
  state.activeSessionId = sessionId;
  state.workbook = session.workbook;
  state.sheetData = session.sheetData;
  state.mappingSelections = session.mappingSelections;
  state.results = session.results;
  state.datasets = session.datasets;
  state.brandAliases = session.brandAliases;
  state.accountTotals = session.accountTotals;
  state.health = session.health;
  updateSessionSelect();
  renderMappingPanel();
  renderApp();
}

function createSessionFromState(meta) {
  const id = `session-${Date.now()}`;
  const dateLabel =
    meta.dateStart && meta.dateEnd
      ? `${meta.dateStart} → ${meta.dateEnd}`
      : meta.dateStart || meta.dateEnd || "";
  const session = {
    id,
    name: meta.name || `Upload ${state.sessions.length + 1}`,
    date: dateLabel || new Date().toISOString().slice(0, 10),
    notes: meta.notes || "",
    workbook: state.workbook,
    sheetData: state.sheetData,
    mappingSelections: state.mappingSelections,
    results: state.results,
    datasets: state.datasets,
    brandAliases: state.brandAliases,
    accountTotals: state.accountTotals,
    health: state.health,
  };
  state.sessions.unshift(session);
  setActiveSession(id);
}

function clearUploadForm() {
  if (fileInput) {
    fileInput.value = "";
  }
  if (uploadName) {
    uploadName.value = "";
  }
  if (uploadDateStart) {
    uploadDateStart.value = "";
  }
  if (uploadDateEnd) {
    uploadDateEnd.value = "";
  }
  if (uploadNotes) {
    uploadNotes.value = "";
  }
  if (fileMeta) {
    fileMeta.textContent = "";
  }
}

if (uploadOpen) {
  uploadOpen.addEventListener("click", () => {
    if (uploadDateEnd) {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      uploadDateEnd.value = yesterday.toISOString().slice(0, 10);
    }
    openModal(uploadModal);
  });
}
if (uploadClose) {
  uploadClose.addEventListener("click", () => closeModal(uploadModal));
}
if (settingsOpen) {
  settingsOpen.addEventListener("click", () => openModal(settingsModal));
}
if (settingsClose) {
  settingsClose.addEventListener("click", () => closeModal(settingsModal));
}

if (uploadCreate) {
  uploadCreate.addEventListener("click", async () => {
    if (!fileInput?.files?.length) {
      alert("Choose a bulksheet file to upload.");
      return;
    }
    setCreateLoading(true);
    const meta = {
      name: uploadName?.value?.trim(),
      dateStart: uploadDateStart?.value,
      dateEnd: uploadDateEnd?.value,
      notes: uploadNotes?.value?.trim(),
    };
    await loadWorkbook(fileInput.files[0]);
    recompute();
    createSessionFromState(meta);
    clearUploadForm();
    closeModal(uploadModal);
    setCreateLoading(false);
  });
}

if (sessionSelect) {
  sessionSelect.addEventListener("change", (event) => {
    const value = event.target.value;
    setActiveSession(value);
  });
}

navItems.forEach((item) => {
  item.addEventListener("click", () => {
    state.ui.activeSection = item.dataset.section;
    state.ui.selectedEntity = null;
    state.ui.selectedBucket = null;
    if (!state.ui.inspectorPinned) {
      state.ui.inspectorOpen = state.ui.activeSection === "overview";
    }
    state.ui.viewMode = getSectionConfig(state.ui.activeSection).defaultView;
    syncNav();
    renderApp();
  });
});

viewButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const view = button.dataset.view;
    if (!view) {
      return;
    }
    state.ui.viewMode = view;
    state.ui.selectedBucket = null;
    renderApp();
  });
});

if (searchInput) {
  searchInput.addEventListener("input", () => {
    state.ui.searchQuery = searchInput.value;
    renderApp();
  });
}

if (sortSelect) {
  sortSelect.addEventListener("change", () => {
    const [key, direction] = sortSelect.value.split("-");
    state.ui.sortKey = key;
    state.ui.sortDirection = direction;
    renderApp();
  });
}

if (adTypeFilter) {
  adTypeFilter.addEventListener("change", () => {
    state.ui.adTypeFilter = adTypeFilter.value;
    renderApp();
  });
}

if (groupedBySelect) {
  groupedBySelect.addEventListener("change", () => {
    state.ui.groupedBy = groupedBySelect.value;
    renderApp();
  });
}

if (searchTermFilter) {
  searchTermFilter.addEventListener("change", () => {
    state.ui.searchTermFilter = searchTermFilter.value;
    renderApp();
  });
}

if (searchTermExport) {
  searchTermExport.addEventListener("click", () => {
    const sectionConfig = getSectionConfig(state.ui.activeSection);
    if (sectionConfig.key !== "search-terms") {
      return;
    }
    const rows = buildTableEntities(sectionConfig);
    const search = state.ui.searchQuery.toLowerCase();
    const filtered = rows.filter((item) =>
      item.label.toLowerCase().includes(search)
    );
    const lines = filtered
      .map((item) => item.label)
      .filter(Boolean)
      .map((label) =>
        state.ui.searchTermFilter === "asins"
          ? String(label).toUpperCase()
          : label
      );
    const blob = new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const label = state.ui.searchTermFilter === "asins" ? "asins" : "search-terms";
    link.href = url;
    link.download = `${label}.txt`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  });
}

if (negativeFilter) {
  negativeFilter.addEventListener("change", () => {
    state.ui.negativeKeywordFilter = negativeFilter.value;
    renderApp();
  });
}

if (workspaceContent) {
  workspaceContent.addEventListener("click", (event) => {
    const copyBtn = event.target.closest("[data-copy]");
    if (copyBtn) {
      event.stopPropagation();
      const value = copyBtn.dataset.copy || "";
      if (value) {
        navigator.clipboard?.writeText(value);
      }
      return;
    }
    const moreBtn = event.target.closest("[data-table-more]");
    if (moreBtn) {
      const action = moreBtn.dataset.tableMore;
      if (action === "more") {
        state.ui.tableLimit += 20;
      }
      if (action === "all") {
        state.ui.tableLimit = Infinity;
      }
      renderApp();
    }
    const detailBtn = event.target.closest("[data-detail-more]");
    if (detailBtn) {
      const action = detailBtn.dataset.detailMore;
      if (action === "more") {
        state.ui.inspectorDetailLimit += 20;
      }
      if (action === "all") {
        state.ui.inspectorDetailLimit = Infinity;
      }
      renderWorkspaceContent();
    }
    const detailSort = event.target.closest("[data-detail-sort]");
    if (detailSort) {
      const key = detailSort.dataset.detailSort;
      if (key) {
        if (state.ui.detailSortKey === key) {
          state.ui.detailSortDirection =
            state.ui.detailSortDirection === "desc" ? "asc" : "desc";
        } else {
          state.ui.detailSortKey = key;
          state.ui.detailSortDirection = "desc";
        }
        renderWorkspaceContent();
      }
    }
  });
}

if (inspectorPin) {
  inspectorPin.addEventListener("click", () => {
    state.ui.inspectorPinned = !state.ui.inspectorPinned;
    inspectorPin.classList.toggle("active", state.ui.inspectorPinned);
    inspectorPin.setAttribute(
      "aria-label",
      state.ui.inspectorPinned ? "Pinned" : "Pin"
    );
  });
}

if (inspectorClose) {
  inspectorClose.addEventListener("click", () => {
    state.ui.inspectorOpen = !state.ui.inspectorOpen;
    state.ui.inspectorPinned = false;
    renderInspector();
  });
}

if (autoMapBtn) {
  autoMapBtn.addEventListener("click", () => {
    autoMapAllSheets();
    renderMappingPanel();
    recompute();
  });
}

if (saveMapBtn) {
  saveMapBtn.addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(state.mappingSelections, null, 2)], {
      type: "application/json",
    });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "amazon-column-mapping.json";
    link.click();
  });
}

if (mapUpload) {
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
}

if (brandInput) {
  brandInput.addEventListener("input", () => {
    state.brandAliases = parseBrandAliases(brandInput.value);
    recompute();
  });
}

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

    if (fileMeta) {
      fileMeta.textContent = `${file.name} • ${workbook.SheetNames.length} sheets`;
    }
    autoMapAllSheets();
    renderMappingPanel();
  } catch (error) {
    if (fileMeta) {
      fileMeta.textContent = "Failed to parse the bulk sheet.";
    }
    console.error("Bulk sheet parsing failed:", error);
  }
}

function autoMapAllSheets() {
  Object.entries(state.sheetData).forEach(([sheetName, sheet]) => {
    state.mappingSelections[sheetName] = buildAutoMapping(sheet.columns);
  });
}

function renderMappingPanel() {
  if (!mappingPanel) {
    return;
  }
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

  state.health = health;
  state.results = buildAuditResults(datasets, {
    brandAliases: state.brandAliases,
  });
  state.datasets = datasets;
  state.accountTotals = computeSummary(
    datasets
      .filter((set) => set.def.kind === "campaign")
      .flatMap((set) => set.rows)
  );
  resetAiSummaries("Data updated. Generate summaries to refresh AI insights.");
  renderApp();
}

function syncNav() {
  navItems.forEach((item) => {
    item.classList.toggle("active", item.dataset.section === state.ui.activeSection);
  });
  if (appBody) {
    appBody.classList.toggle(
      "nav-collapsed",
      state.ui.activeSection !== "overview"
    );
    appBody.classList.add("inspector-overlay");
  }
}

function renderApp() {
  updateSessionSelect();
  syncNav();
  renderTopbarMetrics();
  renderHomeView();
  renderSessionView();
  renderInspector();
}

function renderHomeView() {
  if (!homeView) {
    return;
  }
  const hasSessions = state.sessions.length > 0;
  const isActive = !state.activeSessionId;
  homeView.classList.toggle("is-active", isActive);
  if (!hasSessions) {
    homeView.innerHTML = `
      <div class="card">
        <h3 class="card-title">Add your first upload</h3>
        <p class="muted">Upload an Amazon Ads bulksheet to create an audit session.</p>
        <button class="btn primary" id="home-upload-btn">Upload bulksheet</button>
      </div>
    `;
    const button = document.getElementById("home-upload-btn");
    if (button) {
      button.addEventListener("click", () => openModal(uploadModal));
    }
    return;
  }
  if (!isActive) {
    return;
  }

  const cards = state.sessions
    .map((session) => {
      const summary = session.accountTotals || {};
      const note = session.notes || "";
      const notePreview =
        note.length > 120 ? `${note.slice(0, 120).trim()}…` : note;
      const showToggle = note.length > 120;
      const formattedDate = formatDateRangeLabel(session.date);
      return `
        <div class="card clickable" data-session="${session.id}">
          <div class="row space-between">
            <strong>${escapeHtml(session.name)}</strong>
            <span class="muted">${escapeHtml(formattedDate)}</span>
          </div>
          <div class="row">
            <span class="chip">Spend ${formatCurrency(summary.spend)}</span>
            <span class="chip">Sales ${formatCurrency(summary.sales)}</span>
            <span class="chip">ACoS ${formatPercent(summary.acos)}</span>
          </div>
          ${
            note
              ? `<div class="note-preview" data-note-wrap="${session.id}">
                  <span class="note-text">${escapeHtml(notePreview)}</span>
                  ${
                    showToggle
                      ? `<button class="note-toggle" data-note-toggle="${session.id}">
                          Show more
                        </button>`
                      : ""
                  }
                </div>`
              : ""
          }
        </div>
      `;
    })
    .join("");
  homeView.innerHTML = `<div class="masonry">${cards}</div>`;
  homeView.querySelectorAll("[data-session]").forEach((card) => {
    card.addEventListener("click", () => {
      setActiveSession(card.dataset.session);
    });
  });
  homeView.querySelectorAll("[data-note-toggle]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      const sessionId = button.dataset.noteToggle;
      const session = state.sessions.find((entry) => entry.id === sessionId);
      const wrap = homeView.querySelector(`[data-note-wrap="${sessionId}"]`);
      if (!session || !wrap) {
        return;
      }
      const textEl = wrap.querySelector(".note-text");
      const expanded = wrap.classList.toggle("expanded");
      if (textEl) {
        textEl.textContent = expanded
          ? session.notes
          : `${session.notes.slice(0, 120).trim()}…`;
      }
      button.textContent = expanded ? "Show less" : "Show more";
    });
  });
}

function renderSessionView() {
  if (!sessionView) {
    return;
  }
  const hasSession = Boolean(state.activeSessionId);
  sessionView.classList.toggle("is-active", hasSession);
  if (!hasSession) {
    return;
  }
  updateWorkspaceHeader();
  renderWorkspaceContent();
}

function updateWorkspaceHeader() {
  const sectionConfig = getSectionConfig(state.ui.activeSection);
  if (workspaceTitle) {
    workspaceTitle.textContent = sectionConfig.title;
  }
  if (workspaceBreadcrumb) {
    const session = state.sessions.find((entry) => entry.id === state.activeSessionId);
    workspaceBreadcrumb.innerHTML = `
      <button class="breadcrumb-link" data-breadcrumb="uploads">Uploads</button>
      <span class="breadcrumb-sep">/</span>
      <span>${escapeHtml(session?.name || "Session")}</span>
    `;
    const link = workspaceBreadcrumb.querySelector("[data-breadcrumb='uploads']");
    if (link) {
      link.addEventListener("click", () => setActiveSession(""));
    }
  }
  viewButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.view === state.ui.viewMode);
  });
  if (viewToggle) {
    viewToggle.style.display = sectionConfig.allowViewToggle ? "inline-flex" : "none";
  }
  if (workspaceControls) {
    workspaceControls.style.display =
      sectionConfig.key === "overview" ? "none" : "flex";
  }
  const isGroupedView =
    state.ui.viewMode === "groups" &&
    sectionConfig.groupedMode === "buckets" &&
    sectionConfig.allowViewToggle;
  if (searchInput) {
    searchInput.style.display = isGroupedView ? "none" : "inline-flex";
    searchInput.value = state.ui.searchQuery;
  }
  if (groupedByWrap) {
    groupedByWrap.style.display = isGroupedView ? "flex" : "none";
  }
  updateSortOptions(isGroupedView);
  if (sortSelect) {
    sortSelect.value = `${state.ui.sortKey}-${state.ui.sortDirection}`;
  }
  if (adTypeFilter) {
    adTypeFilter.value = state.ui.adTypeFilter;
  }
  if (groupedBySelect) {
    groupedBySelect.value = state.ui.groupedBy;
  }
  if (searchTermFilterWrap) {
    searchTermFilterWrap.style.display =
      sectionConfig.key === "search-terms" ? "flex" : "none";
  }
  if (searchTermFilter) {
    searchTermFilter.value = state.ui.searchTermFilter;
  }
  if (searchTermExport) {
    searchTermExport.style.display =
      sectionConfig.key === "search-terms" ? "inline-flex" : "none";
  }
  if (negativeFilterWrap) {
    negativeFilterWrap.style.display =
      sectionConfig.key === "negative-keywords" ? "flex" : "none";
  }
  if (negativeFilter) {
    negativeFilter.value = state.ui.negativeKeywordFilter;
  }
}

function renderTopbarMetrics() {
  if (!topbarMetrics) {
    return;
  }
  if (!state.accountTotals) {
    topbarMetrics.innerHTML = "";
    return;
  }
  topbarMetrics.innerHTML = `
    <span class="metric-pill">Spend ${formatCurrency(state.accountTotals.spend)}</span>
    <span class="metric-pill">Sales ${formatCurrency(state.accountTotals.sales)}</span>
    <span class="metric-pill">ACoS ${formatPercent(state.accountTotals.acos)}</span>
    <span class="metric-pill">ROAS ${formatRoas(state.accountTotals.roas)}</span>
  `;
}

function renderWorkspaceContent() {
  if (!workspaceContent) {
    return;
  }
  const sectionConfig = getSectionConfig(state.ui.activeSection);
  if (!state.results) {
    workspaceContent.innerHTML = `<div class="muted">Upload a bulk sheet to see results.</div>`;
    return;
  }
  if (sectionConfig.key === "overview") {
    workspaceContent.innerHTML = renderOverview();
    attachOverviewHandlers();
    return;
  }
  if (sectionConfig.key === "negative-keywords") {
    const tableRows = buildTableEntities(sectionConfig);
    workspaceContent.innerHTML = renderNegativeCards(tableRows);
    attachGroupHandlers();
    return;
  }

  const view = sectionConfig.allowViewToggle ? state.ui.viewMode : sectionConfig.defaultView;
  if (view !== state.ui.viewMode) {
    state.ui.viewMode = view;
  }
  if (view === "groups") {
    if (sectionConfig.groupedMode === "buckets") {
      const buckets = buildBucketEntities(sectionConfig);
      workspaceContent.innerHTML = renderBucketTable(buckets);
      attachBucketHandlers();
    } else {
      const groups = buildGroupEntities(sectionConfig);
      workspaceContent.innerHTML = renderGroupCards(groups);
      attachGroupHandlers();
    }
  } else {
    const tableRows = buildTableEntities(sectionConfig);
    workspaceContent.innerHTML = renderTable(tableRows);
    attachTableHandlers();
  }
}

function updateSortOptions(isGroupedView) {
  if (!sortSelect) {
    return;
  }
  if (isGroupedView) {
    const groupedLabel =
      state.ui.groupedBy === "roas" ? "RoAS bands" : "ACoS bands";
    const groupedLowHigh =
      state.ui.groupedBy === "roas"
        ? `${groupedLabel} (low → high)`
        : `${groupedLabel} (low → high)`;
    const groupedHighLow =
      state.ui.groupedBy === "roas"
        ? `${groupedLabel} (high → low)`
        : `${groupedLabel} (high → low)`;
    sortSelect.innerHTML = `
      <option value="group-asc">${groupedLowHigh}</option>
      <option value="group-desc">${groupedHighLow}</option>
      <option value="spendShare-desc">Spend share (high to low)</option>
      <option value="spendShare-asc">Spend share (low to high)</option>
      <option value="salesShare-desc">Sales share (high to low)</option>
      <option value="salesShare-asc">Sales share (low to high)</option>
    `;
    if (!["spendShare", "salesShare", "group"].includes(state.ui.sortKey)) {
      state.ui.sortKey = "group";
      state.ui.sortDirection = "asc";
    }
    return;
  }
  sortSelect.innerHTML = `
    <option value="spend-desc">Spend (high to low)</option>
    <option value="spend-asc">Spend (low to high)</option>
    <option value="sales-desc">Sales (high to low)</option>
    <option value="sales-asc">Sales (low to high)</option>
    <option value="acos-desc">ACoS (high to low)</option>
    <option value="acos-asc">ACoS (low to high)</option>
    <option value="roas-desc">ROAS (high to low)</option>
    <option value="roas-asc">ROAS (low to high)</option>
  `;
  if (
    !["spend", "sales", "acos", "roas"].includes(state.ui.sortKey) ||
    !["asc", "desc"].includes(state.ui.sortDirection)
  ) {
    state.ui.sortKey = "spend";
    state.ui.sortDirection = "desc";
  }
}

function renderOverview() {
  const adTypes = Object.keys(state.results.adTypes || {});
  const cards = adTypes
    .map((adType) => {
      const summary = state.results.adTypes[adType]?.summary;
      if (!summary) {
        return "";
      }
      return `
        <div class="card">
          <h3 class="card-title">${escapeHtml(adType)} Overview</h3>
          <div class="kpi-grid">
            ${renderKpi("Spend", formatCurrency(summary.spend))}
            ${renderKpi("Sales", formatCurrency(summary.sales))}
            ${renderKpi("ACoS", formatPercent(summary.acos))}
            ${renderKpi("ROAS", formatRoas(summary.roas))}
          </div>
        </div>
      `;
    })
    .join("");

  return `
    <div class="kpi-grid">${cards}</div>
    ${renderAiRecommendationsHub(true)}
  `;
}

function renderAiRecommendationsHub(useGrid) {
  const tilesClass = useGrid ? "ai-tiles ai-tiles-grid" : "ai-tiles";
  return `
    <div class="card ai-spotlight">
      <div class="row space-between">
        <strong>AI Recommendations Hub</strong>
        <span class="chip">Priority Insights</span>
      </div>
      <p class="muted">
        This panel will surface your highest-impact opportunities, tailored to the
        current upload. Think of it as your daily mission brief.
      </p>
      <div class="${tilesClass}">
        <div class="ai-tile">
          <div class="ai-dot"></div>
          <div>
            <div class="ai-title">Spend Share Risk</div>
            <div class="muted">Flag top spenders with weak CVR.</div>
          </div>
        </div>
        <div class="ai-tile">
          <div class="ai-dot"></div>
          <div>
            <div class="ai-title">Search Term Gold</div>
            <div class="muted">Highlight winning queries to harvest.</div>
          </div>
        </div>
        <div class="ai-tile">
          <div class="ai-dot"></div>
          <div>
            <div class="ai-title">A+ Optimization</div>
            <div class="muted">Pinpoint high ACoS pockets to fix.</div>
          </div>
        </div>
      </div>
      ${renderHealthWarnings()}
    </div>
  `;
}

function renderAiChatPanel() {
  return `
    <div class="card ai-chat">
      <div class="ai-chat-header">
        <div>
          <div class="ai-chat-title">AI Workspace</div>
          <div class="muted">Ask about performance, actions, and what to fix next.</div>
        </div>
      </div>
      <div class="ai-chat-chips">
        <button class="chip">Summarize top spend risks</button>
        <button class="chip">Explain ACoS outliers</button>
        <button class="chip">Which campaigns to pause?</button>
        <button class="chip">Where is wasted spend?</button>
        <button class="chip">Best keywords to scale</button>
        <button class="chip">Branded vs non‑branded split</button>
      </div>
      <div class="ai-chat-thread">
        <p class="muted">
          Ask a question to explore your upload. Insights can reference campaigns,
          ad groups, keywords, placements, and search terms.
        </p>
      </div>
      <div class="ai-chat-input">
        <textarea rows="3" placeholder="Ask the AI to analyze your account..."></textarea>
        <button class="btn primary" disabled>Send</button>
      </div>
    </div>
  `;
}

function renderAiInsightCards() {
  if (!state.ai.report) {
    return `<div class="card"><p class="muted">Generate summaries to see AI insights.</p></div>`;
  }
  const cards = collectInsights()
    .map((insight) => {
      return `
        <div class="card clickable" data-insight="${escapeHtml(insight.title)}">
          <div class="row space-between">
            <strong>${escapeHtml(insight.title)}</strong>
            <span class="chip">${escapeHtml(insight.severity || "Insight")}</span>
          </div>
          <p class="muted">${escapeHtml(insight.summary || insight.detail || "")}</p>
          <div class="row">
            ${insight.metrics
              .slice(0, 4)
              .map((metric) => `<span class="chip">${escapeHtml(metric)}</span>`)
              .join("")}
          </div>
        </div>
      `;
    })
    .join("");
  return `<div class="masonry">${cards}</div>`;
}

function attachOverviewHandlers() {
  workspaceContent.querySelectorAll("[data-insight]").forEach((card) => {
    card.addEventListener("click", () => {
      state.ui.selectedEntity = {
        label: card.dataset.insight,
        type: "Insight",
      };
      state.ui.inspectorOpen = true;
      renderInspector();
    });
  });
}

function stripAdTypePrefix(key) {
  const splitIndex = String(key || "").indexOf("::");
  if (splitIndex === -1) {
    return key;
  }
  return key.slice(splitIndex + 2);
}

function getDetailEntry(sectionKey, adType, detailKey) {
  if (!state.results || !adType || !detailKey) {
    return null;
  }
  const detailSet = state.results.adTypes?.[adType]?.details?.[sectionKey];
  if (!detailSet) {
    return null;
  }
  return detailSet[detailKey] || null;
}

function getDetailKeyForRow(sectionKey, row) {
  if (!row) {
    return null;
  }
  if (sectionKey === "negative-keywords") {
    return (
      row.keywordText ||
      row.productTargetingExpression ||
      row.asinTarget ||
      "Negative"
    );
  }
  return null;
}

function buildGroupEntities(sectionConfig) {
  const rows = filterRowsBySection(sectionConfig);
  const filtered = applyAdTypeFilter(rows);
  if (!filtered.length) {
    return [];
  }
  const grouped = groupBy(filtered, (row) => {
    const baseKey = sectionConfig.groupKey(row);
    if (state.ui.adTypeFilter === "All") {
      return `${row.adType || "All"}::${baseKey}`;
    }
    return baseKey;
  });
  const totalSpend = state.accountTotals?.spend || 0;
  const totalSales = state.accountTotals?.sales || 0;
  return Object.entries(grouped).map(([key, items]) => {
    const summary = computeSummary(items);
    const labelKey =
      state.ui.adTypeFilter === "All" ? stripAdTypePrefix(key) : key;
    const label = sectionConfig.groupLabel(items[0], labelKey, items);
    const detailKey =
      state.ui.adTypeFilter === "All" ? stripAdTypePrefix(key) : key;
    const detailAdType =
      state.ui.adTypeFilter === "All" ? items[0]?.adType : state.ui.adTypeFilter;
    const details = getDetailEntry(
      sectionConfig.key,
      detailAdType,
      detailKey
    );
    return {
      id: `${sectionConfig.key}:${key}`,
      label,
      type: sectionConfig.entityLabel,
      adType: items[0]?.adType || "",
      count: items.length,
      summary,
      details,
      spendSharePct: totalSpend ? summary.spend / totalSpend : null,
      salesSharePct: totalSales ? summary.sales / totalSales : null,
    };
  });
}

function buildBucketEntities(sectionConfig) {
  const rows = filterRowsBySection(sectionConfig);
  const filtered = applyAdTypeFilter(rows);
  if (!filtered.length) {
    return [];
  }
  const showCampaignChip = sectionConfig.key.startsWith("match-");
  const grouped = groupBy(filtered, sectionConfig.groupKey);
  const entities = Object.entries(grouped).map(([key, items]) => ({
    key,
    label: sectionConfig.groupLabel(items[0], key, items),
    summary: computeSummary(items),
    rows: items,
  }));
  const totalSpend = entities.reduce((sum, item) => sum + item.summary.spend, 0);
  const totalSales = entities.reduce((sum, item) => sum + item.summary.sales, 0);
  const totalsByBucket = {};

  entities.forEach((entity) => {
    const bucket = bucketLabelForSummary(entity.summary, state.ui.groupedBy);
    if (!bucket) {
      return;
    }
    totalsByBucket[bucket] = totalsByBucket[bucket] || {
      bucket,
      spend: 0,
      sales: 0,
      clicks: 0,
      orders: 0,
      count: 0,
      entities: [],
    };
    totalsByBucket[bucket].spend += entity.summary.spend;
    totalsByBucket[bucket].sales += entity.summary.sales;
    totalsByBucket[bucket].clicks += entity.summary.clicks || 0;
    totalsByBucket[bucket].orders += entity.summary.orders || 0;
    totalsByBucket[bucket].count += 1;
    totalsByBucket[bucket].entities.push(entity);
  });

  return Object.values(totalsByBucket)
    .map((bucket) => ({
      bucket: bucket.bucket,
      count: bucket.count,
      spend: bucket.spend,
      sales: bucket.sales,
      spendSharePct: totalSpend ? bucket.spend / totalSpend : null,
      salesSharePct: totalSales ? bucket.sales / totalSales : null,
      acos: bucket.sales ? bucket.spend / bucket.sales : null,
      roas: bucket.spend ? bucket.sales / bucket.spend : null,
      cvr: bucket.clicks ? bucket.orders / bucket.clicks : null,
      cpc: bucket.clicks ? bucket.spend / bucket.clicks : null,
      clicks: bucket.clicks,
      orders: bucket.orders,
      details: {
        title: `Items in ${bucket.bucket}`,
        rows: bucket.entities
          .map((entity) => ({
            label: entity.label,
            campaignLabel: showCampaignChip
              ? getCampaignLabelFromRows(entity.rows)
              : "",
            ...computeDetailMetricsFromRows(entity.rows),
          }))
          .sort((a, b) => (b.spend || 0) - (a.spend || 0)),
      },
    }))
    .sort((a, b) => {
      if (state.ui.sortKey === "group") {
        const orderA = bucketSortOrder(a.bucket, state.ui.groupedBy);
        const orderB = bucketSortOrder(b.bucket, state.ui.groupedBy);
        return state.ui.sortDirection === "desc"
          ? orderB - orderA
          : orderA - orderB;
      }
      if (state.ui.sortKey === "spendShare") {
        return (
          sortDirectionMultiplier() *
          ((b.spendSharePct || 0) - (a.spendSharePct || 0))
        );
      }
      if (state.ui.sortKey === "salesShare") {
        return (
          sortDirectionMultiplier() *
          ((b.salesSharePct || 0) - (a.salesSharePct || 0))
        );
      }
      return (
        bucketSortOrder(a.bucket, state.ui.groupedBy) -
        bucketSortOrder(b.bucket, state.ui.groupedBy)
      );
    });
}

function buildTableEntities(sectionConfig) {
  if (sectionConfig.listMode === "rows") {
    const rows = applyAdTypeFilter(filterRowsBySection(sectionConfig));
    return rows.map((row, index) => ({
      id: `${sectionConfig.key}:${index}`,
      label: sectionConfig.rowLabel(row),
      type: sectionConfig.entityLabel,
      adType: row.adType,
      summary: computeSummary([row]),
      spendSharePct: state.accountTotals?.spend
        ? row.spend / state.accountTotals.spend
        : null,
      salesSharePct: state.accountTotals?.sales
        ? row.sales / state.accountTotals.sales
        : null,
      details: getDetailEntry(
        sectionConfig.key,
        row.adType,
        getDetailKeyForRow(sectionConfig.key, row)
      ),
      raw: row,
    }));
  }
  const groups = buildGroupEntities(sectionConfig);
  return groups.map((group) => ({ ...group }));
}

function renderGroupCards(groups) {
  if (!groups.length) {
    return `<div class="card"><p class="muted">No entities found.</p></div>`;
  }
  const search = state.ui.searchQuery.toLowerCase();
  const sorted = applySorting(
    groups.filter((item) => item.label.toLowerCase().includes(search))
  );
  const cards = sorted
    .map((item) => {
      const selected = state.ui.selectedEntity?.id === item.id;
      return `
        <div class="card clickable ${selected ? "selected" : ""}" data-entity="${item.id}">
          <div class="row space-between">
            <strong>${escapeHtml(item.label)}</strong>
            <span class="chip">${escapeHtml(item.adType || "All")}</span>
          </div>
          <div class="row">
            <span class="chip">Spend ${formatCurrency(item.summary.spend)}</span>
            <span class="chip">Sales ${formatCurrency(item.summary.sales)}</span>
            <span class="chip">ACoS ${formatPercent(item.summary.acos)}</span>
            <span class="chip">ROAS ${formatRoas(item.summary.roas)}</span>
          </div>
          <div class="row">
            <span class="muted">Spend share ${formatPercent(item.spendSharePct)}</span>
            <span class="muted">Sales share ${formatPercent(item.salesSharePct)}</span>
          </div>
        </div>
      `;
    })
    .join("");
  return `<div class="masonry">${cards}</div>`;
}

function renderTable(rows) {
  if (!rows.length) {
    return `<div class="card"><p class="muted">No entities found.</p></div>`;
  }
  const search = state.ui.searchQuery.toLowerCase();
  const sorted = applySorting(
    rows.filter((item) => item.label.toLowerCase().includes(search))
  );
  const limit = Number.isFinite(state.ui.tableLimit)
    ? state.ui.tableLimit
    : sorted.length;
  const visible = sorted.slice(0, limit);
  const isSearchTerms = state.ui.activeSection === "search-terms";
  const columnCount = isSearchTerms ? 10 : 8;
  const body = visible
    .map((item) => {
      const selected = state.ui.selectedEntity?.id === item.id;
      const detailRow =
        selected && item.details
          ? renderDetailExpandedRow(item.details, columnCount)
          : "";
      const clickCells = isSearchTerms
        ? `<td class="num">${formatNumber(item.summary.clicks)}</td>
          <td class="num">${formatCurrency(item.summary.cpc)}</td>`
        : "";
      const label =
        isSearchTerms && state.ui.searchTermFilter === "asins"
          ? String(item.label).toUpperCase()
          : item.label;
      const copyValue = String(label || "");
      return `
        <tr class="${selected ? "selected" : ""}" data-entity="${item.id}">
          <td>
            <span class="name-cell">
              ${escapeHtml(label)}
              <button class="copy-btn" data-copy="${escapeHtml(copyValue)}" aria-label="Copy name">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <rect x="9" y="9" width="10" height="10" rx="2" />
                  <rect x="5" y="5" width="10" height="10" rx="2" />
                </svg>
              </button>
            </span>
          </td>
          <td>${escapeHtml(item.adType || "—")}</td>
          <td class="num">${formatCurrency(item.summary.spend)}</td>
          <td class="num">${formatCurrency(item.summary.sales)}</td>
          ${clickCells}
          <td class="num">${formatPercent(item.summary.acos)}</td>
          <td class="num">${formatRoas(item.summary.roas)}</td>
          <td class="num">${formatPercent(item.summary.cvr)}</td>
          <td class="num">${formatNumber(item.summary.orders)}</td>
        </tr>
        ${detailRow}
      `;
    })
    .join("");
  const hasMore = visible.length < sorted.length;
  const clickHeaders = isSearchTerms
    ? `<th class="num">Clicks</th>
       <th class="num">CPC</th>`
    : "";
  return `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Ad type</th>
            <th class="num">Spend</th>
            <th class="num">Sales</th>
            ${clickHeaders}
            <th class="num">ACoS</th>
            <th class="num">ROAS</th>
            <th class="num">CVR</th>
            <th class="num">Orders</th>
          </tr>
        </thead>
        <tbody>${body}</tbody>
      </table>
      <div class="table-footer">
        <span>Showing ${visible.length} of ${sorted.length} rows</span>
        ${
          hasMore
            ? `<div class="row">
                <button class="btn ghost" data-table-more="more">Show 20 more</button>
                <button class="btn ghost" data-table-more="all">Show all</button>
              </div>`
            : ""
        }
      </div>
    </div>
  `;
}

function renderDetailExpandedRow(detailEntry, colSpan) {
  if (!detailEntry?.rows?.length) {
    return "";
  }
  const rows = detailEntry.rows;
  const sortedRows = [...rows].sort((a, b) => {
    const key = state.ui.detailSortKey;
    const direction = state.ui.detailSortDirection === "desc" ? -1 : 1;
    if (key === "label") {
      return direction * String(a.label || "").localeCompare(String(b.label || ""));
    }
    const aVal = Number(a[key] || 0);
    const bVal = Number(b[key] || 0);
    if (aVal === bVal) {
      return 0;
    }
    return aVal > bVal ? direction : -direction;
  });
  const limit = Number.isFinite(state.ui.inspectorDetailLimit)
    ? state.ui.inspectorDetailLimit
    : sortedRows.length;
  const visible = sortedRows.slice(0, limit);
  const hasMore = visible.length < sortedRows.length;
  const body = visible
    .map(
      (row) => `
        <tr>
          <td class="sticky">
            <div class="name-stack">
              <span class="name-cell">
                ${escapeHtml(row.label)}
                <button class="copy-btn" data-copy="${escapeHtml(String(row.label || ""))}" aria-label="Copy name">
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <rect x="9" y="9" width="10" height="10" rx="2" />
                    <rect x="5" y="5" width="10" height="10" rx="2" />
                  </svg>
                </button>
              </span>
              ${
                row.campaignLabel
                  ? `<span class="chip campaign-chip">${escapeHtml(row.campaignLabel)}</span>`
                  : ""
              }
            </div>
          </td>
          <td class="num">${formatNumber(row.impressions)}</td>
          <td class="num">${formatNumber(row.clicks)}</td>
          <td class="num">${formatPercent(row.ctr)}</td>
          <td class="num">${formatCurrency(row.spend)}</td>
          <td class="num">${formatCurrency(row.sales)}</td>
          <td class="num">${formatNumber(row.orders)}</td>
          <td class="num">${formatNumber(row.units)}</td>
          <td class="num">${formatPercent(row.cvr)}</td>
          <td class="num">${formatPercent(row.acos)}</td>
          <td class="num">${formatCurrency(row.cpc)}</td>
          <td class="num">${formatRoas(row.roas)}</td>
        </tr>
      `
    )
    .join("");
  return `
    <tr class="detail-row">
      <td colspan="${colSpan}">
        <div class="detail-expanded">
          <div class="detail-title">${escapeHtml(detailEntry.title || "Breakdown")}</div>
          <div class="detail-table-wrap">
            <table class="detail-table">
              <thead>
                <tr>
                  <th data-detail-sort="label">Name</th>
                  <th class="num" data-detail-sort="impressions">Impr</th>
                  <th class="num" data-detail-sort="clicks">Clicks</th>
                  <th class="num" data-detail-sort="ctr">CTR</th>
                  <th class="num" data-detail-sort="spend">Spend</th>
                  <th class="num" data-detail-sort="sales">Sales</th>
                  <th class="num" data-detail-sort="orders">Orders</th>
                  <th class="num" data-detail-sort="units">Units</th>
                  <th class="num" data-detail-sort="cvr">CVR</th>
                  <th class="num" data-detail-sort="acos">ACoS</th>
                  <th class="num" data-detail-sort="cpc">CPC</th>
                  <th class="num" data-detail-sort="roas">ROAS</th>
                </tr>
              </thead>
              <tbody>${body}</tbody>
            </table>
          </div>
          <div class="table-footer detail-footer">
            <span>Showing ${visible.length} of ${sortedRows.length} rows</span>
            ${
              hasMore
                ? `<div class="row">
                    <button class="btn ghost" data-detail-more="more">Show 20 more</button>
                    <button class="btn ghost" data-detail-more="all">Show all</button>
                  </div>`
                : ""
            }
          </div>
        </div>
      </td>
    </tr>
  `;
}

function renderBucketTable(rows) {
  if (!rows.length) {
    return `<div class="card"><p class="muted">No grouped buckets found.</p></div>`;
  }
  const body = rows
    .map(
      (row) => `
        <tr class="${state.ui.selectedBucket === row.bucket ? "selected" : ""}" data-bucket="${escapeHtml(row.bucket)}">
          <td>${escapeHtml(row.bucket)}</td>
          <td class="num">${formatNumber(row.count)}</td>
          <td class="num">${formatPercent(row.spendSharePct)}</td>
          <td class="num">${formatPercent(row.salesSharePct)}</td>
          <td class="num">${formatCurrency(row.spend)}</td>
          <td class="num">${formatCurrency(row.sales)}</td>
          <td class="num">${formatNumber(row.clicks)}</td>
          <td class="num">${formatNumber(row.orders)}</td>
          <td class="num">${formatCurrency(row.cpc)}</td>
          <td class="num">${formatPercent(row.acos)}</td>
          <td class="num">${formatRoas(row.roas)}</td>
          <td class="num">${formatPercent(row.cvr)}</td>
        </tr>
        ${
          state.ui.selectedBucket === row.bucket && row.details
            ? renderDetailExpandedRow(row.details, 12)
            : ""
        }
      `
    )
    .join("");
  return `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Group</th>
            <th class="num">Count</th>
            <th class="num">Spend share %</th>
            <th class="num">Sales share %</th>
            <th class="num">Spend</th>
            <th class="num">Sales</th>
            <th class="num">Clicks</th>
            <th class="num">Orders</th>
            <th class="num">CPC</th>
            <th class="num">ACoS</th>
            <th class="num">ROAS</th>
            <th class="num">CVR</th>
          </tr>
        </thead>
        <tbody>${body}</tbody>
      </table>
    </div>
  `;
}

function renderNegativeCards(rows) {
  if (!rows.length) {
    return `<div class="card"><p class="muted">No negatives found.</p></div>`;
  }
  const search = state.ui.searchQuery.toLowerCase();
  const filtered = rows.filter((item) =>
    item.label.toLowerCase().includes(search)
  );
  const cards = filtered
    .map((item) => {
      const selected = state.ui.selectedEntity?.id === item.id;
      const matchType = item.raw?.matchType || "";
      return `
        <div class="card clickable ${selected ? "selected" : ""}" data-entity="${item.id}">
          <div class="row space-between">
            <strong>${escapeHtml(item.label)}</strong>
            <span class="chip">${escapeHtml(item.adType || "—")}</span>
          </div>
          <div class="row">
            ${
              matchType
                ? `<span class="chip">${escapeHtml(matchType)}</span>`
                : ""
            }
          </div>
        </div>
      `;
    })
    .join("");
  return `<div class="masonry">${cards}</div>`;
}

function attachBucketHandlers() {
  workspaceContent.querySelectorAll("[data-bucket]").forEach((row) => {
    row.addEventListener("click", () => {
      const bucket = row.dataset.bucket;
      if (!bucket) {
        return;
      }
      state.ui.selectedBucket =
        state.ui.selectedBucket === bucket ? null : bucket;
      state.ui.inspectorDetailLimit = 25;
      state.ui.detailSortKey = "spend";
      state.ui.detailSortDirection = "desc";
      renderWorkspaceContent();
    });
  });
}

function attachGroupHandlers() {
  workspaceContent.querySelectorAll("[data-entity]").forEach((card) => {
    card.addEventListener("click", () => {
      const id = card.dataset.entity;
      const entity = findEntityById(id);
      if (!entity) {
        return;
      }
      const isSame = state.ui.selectedEntity?.id === id;
      state.ui.selectedEntity = isSame ? null : entity;
      state.ui.inspectorDetailLimit = 25;
      state.ui.detailSortKey = "spend";
      state.ui.detailSortDirection = "desc";
      renderInspector();
      renderWorkspaceContent();
    });
  });
}

function attachTableHandlers() {
  workspaceContent.querySelectorAll("[data-entity]").forEach((row) => {
    row.addEventListener("click", () => {
      const id = row.dataset.entity;
      const entity = findEntityById(id);
      if (!entity) {
        return;
      }
      const isSame = state.ui.selectedEntity?.id === id;
      state.ui.selectedEntity = isSame ? null : entity;
      state.ui.inspectorDetailLimit = 25;
      state.ui.detailSortKey = "spend";
      state.ui.detailSortDirection = "desc";
      renderInspector();
      renderWorkspaceContent();
    });
  });
}

function findEntityById(id) {
  const sectionConfig = getSectionConfig(state.ui.activeSection);
  const groups = buildGroupEntities(sectionConfig);
  const tables = buildTableEntities(sectionConfig);
  return [...groups, ...tables].find((item) => item.id === id) || null;
}

function renderInspector() {
  if (!inspector || !inspectorBody) {
    return;
  }
  const shouldShow = state.ui.inspectorOpen || state.ui.inspectorPinned;
  inspector.classList.toggle("collapsed", !shouldShow);
  if (appBody) {
    appBody.classList.toggle("inspector-collapsed", !shouldShow);
  }
  if (!shouldShow) {
    return;
  }
  const entity = state.ui.selectedEntity;
  if (!entity) {
    inspectorTitle.textContent = "Inspector";
    inspectorType.textContent = "";
    inspectorBody.innerHTML = renderAiChatPanel();
    return;
  }
  inspectorTitle.textContent = entity.label;
  inspectorType.textContent = entity.type || "Entity";
  inspectorBody.innerHTML = `
    <div class="card">
      <h4 class="card-title">Summary</h4>
      <div class="kpi-grid">
        ${renderKpi("Spend", formatCurrency(entity.summary.spend))}
        ${renderKpi("Sales", formatCurrency(entity.summary.sales))}
        ${renderKpi("ACoS", formatPercent(entity.summary.acos))}
        ${renderKpi("ROAS", formatRoas(entity.summary.roas))}
        ${renderKpi("CVR", formatPercent(entity.summary.cvr))}
        ${renderKpi("Orders", formatNumber(entity.summary.orders))}
      </div>
    </div>
    <div class="card">
      <h4 class="card-title">AI Insights</h4>
      ${renderAiInsightsForEntity(entity)}
    </div>
  `;
}

function renderHealthWarnings() {
  if (!state.health.length) {
    return "";
  }
  const items = state.health
    .map(
      (issue) =>
        `<div class="chip">${escapeHtml(issue.sheet)} missing ${escapeHtml(
          issue.missing.join(", ")
        )}</div>`
    )
    .join("");
  return `<div class="row">${items}</div>`;
}

function renderAiInsightsForEntity() {
  if (!state.ai.report) {
    return `<p class="muted">Generate summaries to see AI insights.</p>`;
  }
  const insights = collectInsights().slice(0, 5);
  if (!insights.length) {
    return `<p class="muted">No AI insights available.</p>`;
  }
  return `
    <ul>
      ${insights
        .map(
          (insight) =>
            `<li><strong>${escapeHtml(insight.title)}</strong> — ${escapeHtml(
              insight.detail || insight.summary || ""
            )}</li>`
        )
        .join("")}
    </ul>
  `;
}

function collectInsights() {
  if (!state.ai.report?.sections) {
    return [];
  }
  return state.ai.report.sections.flatMap((section) =>
    (section.insights || []).map((insight) => ({
      title: insight.title,
      detail: insight.detail,
      summary: section.summary,
      severity: insight.severity || section.adType,
      metrics: (insight.evidence || []).map(
        (item) => `${item.label}: ${item.value}`
      ),
    }))
  );
}

function getSectionConfig(sectionKey) {
  const base = {
    defaultView: "groups",
    allowViewToggle: true,
  };
  const configs = {
    overview: {
      key: "overview",
      title: "Overview",
      allowViewToggle: false,
      defaultView: "groups",
    },
    campaigns: {
      ...base,
      key: "campaigns",
      title: "Campaigns",
      entityLabel: "Campaign",
      groupKey: (row) => row.campaignKey || row.campaignName || "Unmapped",
      groupLabel: (row, key) => row.campaignName || row.campaignId || key,
      listMode: "groups",
      groupedMode: "buckets",
    },
    "ad-groups": {
      ...base,
      key: "ad-groups",
      title: "Ad Groups",
      entityLabel: "Ad Group",
      groupKey: (row) => row.adGroupId || row.adGroupName || "Unmapped",
      groupLabel: (row, key) => row.adGroupName || row.adGroupId || key,
      listMode: "groups",
      groupedMode: "buckets",
    },
    "match-types": {
      ...base,
      key: "match-types",
      title: "Match Types",
      entityLabel: "Match Type",
      groupKey: (row) => row.matchType || "Unmapped",
      groupLabel: (_row, key) => key,
      listMode: "groups",
      allowViewToggle: false,
      defaultView: "table",
    },
    "match-keywords": {
      ...base,
      key: "match-keywords",
      title: "Keywords",
      entityLabel: "Keyword",
      groupKey: (row) => row.keywordText || "Unmapped",
      groupLabel: (row, key) => row.keywordText || key,
      listMode: "groups",
      groupedMode: "buckets",
    },
    "match-asins": {
      ...base,
      key: "match-asins",
      title: "ASINs",
      entityLabel: "ASIN",
      groupKey: (row) => row.asinTarget || "Unmapped",
      groupLabel: (row, key) => row.asinTarget || key,
      listMode: "groups",
      groupedMode: "buckets",
    },
    "match-asins-expanded": {
      ...base,
      key: "match-asins-expanded",
      title: "ASINs Expanded",
      entityLabel: "ASIN Expanded",
      groupKey: (row) => row.asinTarget || row.productTargetingExpression || "Unmapped",
      groupLabel: (row, key) =>
        row.asinTarget || row.productTargetingExpression || key,
      listMode: "groups",
      groupedMode: "buckets",
    },
    "match-auto": {
      ...base,
      key: "match-auto",
      title: "Auto",
      entityLabel: "Auto Target",
      groupKey: (row) => row.productTargetingExpression || row.matchType || "Auto",
      groupLabel: (row, key) => row.productTargetingExpression || key,
      listMode: "groups",
      groupedMode: "buckets",
    },
    "match-categories": {
      ...base,
      key: "match-categories",
      title: "Categories",
      entityLabel: "Category",
      groupKey: (row) => row.productTargetingExpression || "Category",
      groupLabel: (row, key) => row.productTargetingExpression || key,
      listMode: "groups",
      groupedMode: "buckets",
    },
    "match-related": {
      ...base,
      key: "match-related",
      title: "Related KWs",
      entityLabel: "Related Keyword",
      groupKey: (row) => row.productTargetingExpression || row.keywordText || "Related",
      groupLabel: (row, key) => row.productTargetingExpression || row.keywordText || key,
      listMode: "groups",
      groupedMode: "buckets",
    },
    "negative-keywords": {
      ...base,
      key: "negative-keywords",
      title: "Negative Keywords",
      entityLabel: "Negative",
      allowViewToggle: false,
      defaultView: "table",
      listMode: "rows",
      rowLabel: (row) => row.keywordText || row.asinTarget || "Negative",
    },
    "search-terms": {
      ...base,
      key: "search-terms",
      title: "Search Terms",
      entityLabel: "Search Term",
      allowViewToggle: false,
      defaultView: "table",
      listMode: "rows",
      rowLabel: (row) => row.customerSearchTerm || "Search term",
    },
    "bidding-strategies": {
      ...base,
      key: "bidding-strategies",
      title: "Campaign Bidding Strategies",
      entityLabel: "Strategy",
      groupKey: (row) => row.biddingStrategy || "Unknown",
      groupLabel: (row, key) => row.biddingStrategy || key,
      listMode: "groups",
    },
    placements: {
      ...base,
      key: "placements",
      title: "Placements",
      entityLabel: "Placement",
      groupKey: (row) => row.placement || "Unknown",
      groupLabel: (row, key) => row.placement || key,
      listMode: "groups",
    },
  };
  return configs[sectionKey] || configs.overview;
}

function filterRowsBySection(sectionConfig) {
  const campaignRows = state.datasets
    .filter((set) => set.def.kind === "campaign")
    .flatMap((set) => set.rows);
  const searchRows = state.datasets
    .filter((set) => set.def.kind === "searchTerm")
    .flatMap((set) => set.rows);
  const isAsinLike = (value) => String(value || "").toUpperCase().includes("B0");
  switch (sectionConfig.key) {
    case "campaigns":
      return campaignRows.filter((row) => row.entityNormalized === "campaign");
    case "ad-groups":
      return campaignRows.filter((row) => row.entityNormalized === "ad group");
    case "match-types":
      return campaignRows.filter(
        (row) =>
          ["keyword", "product targeting"].includes(row.entityNormalized) &&
          row.matchType
      );
    case "match-keywords":
      return campaignRows.filter((row) => row.entityNormalized === "keyword");
    case "match-asins":
      return campaignRows.filter(
        (row) => row.entityNormalized === "product targeting" && row.matchType === "ASINs"
      );
    case "match-asins-expanded":
      return campaignRows.filter(
        (row) =>
          row.entityNormalized === "product targeting" &&
          row.matchType === "ASINs Expanded"
      );
    case "match-auto":
      return campaignRows.filter(
        (row) => row.entityNormalized === "product targeting" && row.matchType === "Auto"
      );
    case "match-categories":
      return campaignRows.filter(
        (row) =>
          row.entityNormalized === "product targeting" && row.matchType === "Category"
      );
    case "match-related":
      return campaignRows.filter(
        (row) =>
          row.entityNormalized === "product targeting" &&
          row.matchType === "Related Keywords"
      );
    case "negative-keywords":
      return campaignRows.filter((row) => {
        if (!String(row.entityNormalized).toLowerCase().includes("negative")) {
          return false;
        }
        const keywordText = row.keywordText || "";
        const targetExpression = row.productTargetingExpression || row.asinTarget || "";
        if (state.ui.negativeKeywordFilter === "asins") {
          return isAsinLike(keywordText) || isAsinLike(targetExpression);
        }
        return !isAsinLike(keywordText) && !isAsinLike(targetExpression);
      });
    case "search-terms":
      return searchRows.filter((row) => {
        const term = String(row.customerSearchTerm || "");
        if (!term) {
          return false;
        }
        const isAsin = term.toUpperCase().includes("B0");
        if (state.ui.searchTermFilter === "asins") {
          return isAsin;
        }
        return !isAsin;
      });
    case "bidding-strategies":
      return campaignRows.filter((row) => row.biddingStrategy);
    case "placements":
      return campaignRows.filter((row) => row.placement);
    default:
      return campaignRows;
  }
}

function applyAdTypeFilter(rows) {
  if (state.ui.adTypeFilter === "All") {
    return rows;
  }
  return rows.filter((row) => row.adType === state.ui.adTypeFilter);
}

function applySorting(items) {
  const key = state.ui.sortKey;
  const direction = state.ui.sortDirection === "desc" ? -1 : 1;
  return [...items].sort((a, b) => {
    const aVal = a.summary?.[key] ?? 0;
    const bVal = b.summary?.[key] ?? 0;
    if (aVal === bVal) {
      return 0;
    }
    return aVal > bVal ? direction : -direction;
  });
}

function computeDetailMetricsFromRows(rows) {
  const totals = rows.reduce(
    (acc, row) => {
      acc.impressions += row.impressions || 0;
      acc.clicks += row.clicks || 0;
      acc.spend += row.spend || 0;
      acc.sales += row.sales || 0;
      acc.orders += row.orders || 0;
      acc.units += row.units || 0;
      return acc;
    },
    { impressions: 0, clicks: 0, spend: 0, sales: 0, orders: 0, units: 0 }
  );
  return {
    impressions: totals.impressions,
    clicks: totals.clicks,
    ctr: totals.impressions ? totals.clicks / totals.impressions : null,
    spend: totals.spend,
    sales: totals.sales,
    orders: totals.orders,
    units: totals.units,
    cvr: totals.clicks ? totals.orders / totals.clicks : null,
    acos: totals.sales ? totals.spend / totals.sales : null,
    cpc: totals.clicks ? totals.spend / totals.clicks : null,
    roas: totals.spend ? totals.sales / totals.spend : null,
  };
}

function getCampaignLabelFromRows(rows) {
  const labels = new Set(
    rows
      .map((row) => row.campaignName || row.campaignId || "")
      .filter(Boolean)
  );
  if (!labels.size) {
    return "Unknown campaign";
  }
  if (labels.size === 1) {
    return [...labels][0];
  }
  return "Multiple campaigns";
}

function computeSummary(rows) {
  const totals = rows.reduce(
    (acc, row) => {
      acc.spend += row.spend || 0;
      acc.sales += row.sales || 0;
      acc.clicks += row.clicks || 0;
      acc.orders += row.orders || 0;
      return acc;
    },
    { spend: 0, sales: 0, clicks: 0, orders: 0 }
  );
  return {
    spend: totals.spend,
    sales: totals.sales,
    clicks: totals.clicks,
    orders: totals.orders,
    acos: totals.sales ? totals.spend / totals.sales : null,
    cpc: totals.clicks ? totals.spend / totals.clicks : null,
    cvr: totals.clicks ? totals.orders / totals.clicks : null,
    roas: totals.spend ? totals.sales / totals.spend : null,
  };
}

function bucketLabelForSummary(summary, metric) {
  if (summary.sales === 0 && summary.spend > 0) {
    return "No Sales";
  }
  if (metric === "roas") {
    if (!summary.roas && summary.roas !== 0) {
      return "";
    }
    if (summary.roas >= 10) {
      return "10x+ RoAS";
    }
    const lower = Math.floor(summary.roas);
    const upper = lower + 1;
    return `${lower}-${upper}x RoAS`;
  }
  if (summary.acos || summary.acos === 0) {
    const pct = summary.acos * 100;
    if (pct >= 100) {
      return "100%+ ACoS";
    }
    const lower = Math.floor(pct / 10) * 10;
    const upper = lower + 10;
    return `${lower}-${upper}% ACoS`;
  }
  return "";
}

function bucketSortOrder(label, metric) {
  if (label === "No Sales") {
    return -1;
  }
  if (metric === "roas") {
    if (label === "10x+ RoAS") {
      return 999;
    }
    const match = label.match(/^(\d+)-/);
    return match ? Number(match[1]) : 998;
  }
  if (label === "100%+ ACoS") {
    return 999;
  }
  const match = label.match(/^(\d+)-/);
  if (!match) {
    return 998;
  }
  return Number(match[1]);
}

function sortDirectionMultiplier() {
  return state.ui.sortDirection === "desc" ? 1 : -1;
}

function renderKpi(label, value) {
  return `
    <div class="kpi">
      <div class="muted">${label}</div>
      <strong>${value}</strong>
    </div>
  `;
}

function formatCurrency(value) {
  if (value === null || value === undefined) {
    return "—";
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return "—";
  }
  const options =
    Math.abs(numeric) < 100
      ? { minimumFractionDigits: 2, maximumFractionDigits: 2 }
      : { minimumFractionDigits: 0, maximumFractionDigits: 0 };
  return `£${numeric.toLocaleString("en-GB", options)}`;
}

function formatDateRangeLabel(value) {
  if (!value) {
    return "";
  }
  if (value.includes("→")) {
    const [start, end] = value.split("→").map((part) => part.trim());
    return `${formatSingleDate(start)} → ${formatSingleDate(end)}`;
  }
  return formatSingleDate(value);
}

function formatSingleDate(value) {
  if (!value) {
    return "";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function formatPercent(value) {
  if (value === null || value === undefined) {
    return "—";
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return "—";
  }
  return `${(numeric * 100).toFixed(1)}%`;
}

function formatRoas(value) {
  if (value === null || value === undefined) {
    return "—";
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return "—";
  }
  return `${numeric.toFixed(1)}x`;
}

function formatNumber(value) {
  if (value === null || value === undefined) {
    return "—";
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return "—";
  }
  return Math.round(numeric).toLocaleString("en-GB");
}

function truncateLabel(value, maxLength) {
  const text = String(value || "");
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength - 1)}…`;
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

function groupBy(items, keyFn) {
  return items.reduce((acc, item) => {
    const key = keyFn(item);
    if (!acc[key]) {
      acc[key] = [];
    }
    acc[key].push(item);
    return acc;
  }, {});
}

function resetAiSummaries(message) {
  state.ai.bucketMap = {};
  state.ai.report = null;
  state.ai.status = message || "";
  renderReport();
  updateAiControls();
}

function updateAiControls() {
  if (aiGenerateBtn) {
    aiGenerateBtn.disabled = !state.results || !state.ai.apiKey;
  }
  if (aiPrintBtn) {
    aiPrintBtn.disabled = !state.ai.report;
  }
  if (aiStatus) {
    aiStatus.textContent = state.ai.status;
  }
}

async function generateSummaries() {
  if (!state.results) {
    state.ai.status = "Upload a bulk sheet before generating summaries.";
    updateAiControls();
    return;
  }
  if (!state.ai.apiKey) {
    state.ai.status = "Enter an OpenAI API key to generate summaries.";
    updateAiControls();
    return;
  }
  state.ai.status = "Generating summaries...";
  updateAiControls();
  try {
    const payload = buildAiPayload(state.results, state.datasets);
    const response = await requestAuditSummaries({
      apiKey: state.ai.apiKey,
      model: state.ai.model,
      systemText: payload.systemText,
      userText: payload.userText,
      jsonSchema: payload.schema,
    });
    state.ai.bucketMap = indexBucketSummaries(response.buckets);
    state.ai.report = response.report;
    state.ai.status = "Summaries generated.";
    renderReport();
    renderApp();
  } catch (error) {
    state.ai.status = error.message || "Summary generation failed.";
    updateAiControls();
  }
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
    ${report.sections.map((section) => renderReportSection(section)).join("")}
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
          ${evidence ? `<span class="ai-evidence">(${evidence})</span>` : ""}
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
                  .map((entry) => `<li>${escapeHtml(entry.actionText)}</li>`)
                  .join("")}
              </ul>
            </div>
          `;
        })
        .join("")}
    </div>
  `;
}

function buildAiPayload(results, datasets = []) {
  const adTypes = Object.keys(results.adTypes || {});
  const buckets = [];
  adTypes.forEach((adType) => {
    const data = results.adTypes[adType];
    if (!data) {
      return;
    }
    [
      ["campaignBuckets", "Campaigns"],
      ["keywordBuckets", "Keywords"],
      ["asinBuckets", "ASINs"],
      ["matchTypeBuckets", "Match Types"],
      ["pausedBuckets", "Paused"],
      ["placementBuckets", "Placements"],
      ["biddingStrategyBuckets", "Bidding Strategies"],
    ].forEach(([key, label]) => {
      const rows = data[key] || [];
      buckets.push({
        adType,
        bucket: key,
        label,
        rows,
      });
    });
  });

  return {
    systemText:
      "You are an Amazon Ads audit analyst. Produce concise insights and actions.",
    userText: JSON.stringify({
      generatedAt: results.generatedAt,
      adTypes,
      buckets,
      searchTermInsights: results.searchTermInsights || {},
      datasets: datasets.map((set) => ({
        adType: set.def.adType,
        kind: set.def.kind,
        rows: set.rows.length,
      })),
    }),
    schema: {
      name: "audit_summary",
      schema: {
        type: "object",
        properties: {
          buckets: {
            type: "array",
            items: {
              type: "object",
              properties: {
                adType: { type: "string" },
                bucket: { type: "string" },
                summary: { type: "string" },
                insights: { type: "array" },
              },
              required: ["adType", "bucket", "summary", "insights"],
            },
          },
          report: {
            type: "object",
            properties: {
              headline: { type: "string" },
              overview: { type: "string" },
              checklist: { type: "array" },
              sections: { type: "array" },
            },
            required: ["headline", "overview", "sections"],
          },
        },
        required: ["buckets", "report"],
      },
    },
  };
}

function indexBucketSummaries(items) {
  return (items || []).reduce((acc, item) => {
    acc[`${item.adType}:${item.bucket}`] = item;
    return acc;
  }, {});
}

updateAiControls();
renderReport();
renderApp();
