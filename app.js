import {
  SHEET_DEFS,
  FIELD_DEFS,
  buildAutoMapping,
  buildAuditResults,
  getEffectiveSheetDefs,
  normalizeRow,
} from "./audit.js";
import { requestAuditSummaries, requestChatResponse } from "./ai.js";

const REQUIRED_FIELDS = ["spend", "sales", "clicks", "orders"];
const AD_TYPE_OPTIONS = ["All", "SP", "SB", "SD"];
const AI_CHAT_MAX_CONTEXT_CHARS = 60000;
const AI_CHAT_MAX_HISTORY = 10;
const ACTION_PLAN_MAX_ITEMS = 20;

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
    recommendations: [],
    recommendationRules: null,
    recommendationRulesStatus: "",
    actionPlan: null,
    actionPlanStatus: "",
    actionPlanError: "",
    actionPlanAiStatus: "",
    actionPlanAiError: "",
    chat: {
      messages: [],
      isBusy: false,
      draft: "",
      contextTrimmed: false,
      trimReason: "",
    },
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
    inspectorDismissed: false,
    tableLimit: 20,
    inspectorDetailLimit: 25,
    detailSortKey: "spend",
    detailSortDirection: "desc",
    searchTermFilter: "terms",
    searchTermShowCampaignChips: false,
    negativeKeywordFilter: "keywords",
    showCampaignChips: true,
    noSalesFilter: "all",
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
const campaignChipToggle = document.getElementById("campaign-chip-toggle");
const campaignChipWrap = document.getElementById("campaign-chip-wrap");
const noSalesFilter = document.getElementById("no-sales-filter");
const noSalesFilterWrap = document.getElementById("no-sales-filter-wrap");

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
  resetActionPlan("Session changed. Generate a new action plan.");
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
    state.ui.searchQuery = "";
    if (!state.ui.inspectorPinned && state.ui.activeSection !== "overview") {
      state.ui.inspectorOpen = false;
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

if (campaignChipToggle) {
  campaignChipToggle.addEventListener("change", () => {
    const shouldShow = campaignChipToggle.value !== "off";
    if (state.ui.activeSection === "search-terms") {
      state.ui.searchTermShowCampaignChips = shouldShow;
    } else {
      state.ui.showCampaignChips = shouldShow;
    }
    renderApp();
  });
}

if (noSalesFilter) {
  noSalesFilter.addEventListener("change", () => {
    state.ui.noSalesFilter = noSalesFilter.value;
    renderApp();
  });
}

if (workspaceContent) {
  workspaceContent.addEventListener("click", (event) => {
    const sortHeader = event.target.closest("th[data-sort-key]");
    if (sortHeader) {
      const key = sortHeader.dataset.sortKey;
      if (key) {
        if (state.ui.sortKey === key) {
          state.ui.sortDirection =
            state.ui.sortDirection === "desc" ? "asc" : "desc";
        } else {
          state.ui.sortKey = key;
          state.ui.sortDirection = "desc";
        }
        renderWorkspaceContent();
      }
      return;
    }
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
    state.ui.inspectorDismissed = !state.ui.inspectorOpen;
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
      .filter((row) => String(row.entityNormalized) === "campaign")
  );
  resetAiSummaries("Data updated. Generate summaries to refresh AI insights.");
  resetActionPlan("Data updated. Generate a new action plan.");
  renderApp();
}

function syncNav() {
  navItems.forEach((item) => {
    item.classList.toggle("active", item.dataset.section === state.ui.activeSection);
  });
  const matchParent = document.querySelector('[data-section="match-types"]');
  const isMatchChild =
    state.ui.activeSection?.startsWith("match-") &&
    state.ui.activeSection !== "match-types";
  if (matchParent) {
    matchParent.classList.toggle("nav-parent-active", isMatchChild);
  }
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
  const showCampaignChipToggle =
    sectionConfig.key === "search-terms" ||
    (sectionConfig.key.startsWith("match-") &&
      (sectionConfig.allowViewToggle ? state.ui.viewMode : sectionConfig.defaultView) ===
        "groups");
  if (campaignChipWrap) {
    campaignChipWrap.style.display = showCampaignChipToggle ? "flex" : "none";
  }
  if (campaignChipToggle) {
    const isSearchTerms = sectionConfig.key === "search-terms";
    const isOn = isSearchTerms
      ? state.ui.searchTermShowCampaignChips
      : state.ui.showCampaignChips;
    campaignChipToggle.value = isOn ? "on" : "off";
  }
  if (noSalesFilterWrap) {
    noSalesFilterWrap.style.display = sectionConfig.key === "overview" ? "none" : "flex";
  }
  if (noSalesFilter) {
    noSalesFilter.value = state.ui.noSalesFilter;
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
  if (isGroupedView) {
    if (!["spendSharePct", "salesSharePct", "group"].includes(state.ui.sortKey)) {
      state.ui.sortKey = "group";
      state.ui.sortDirection = "asc";
    }
    return;
  }
  if (
    !["label", "spend", "sales", "clicks", "orders", "cpc", "acos", "roas", "cvr", "spendSharePct", "salesSharePct"].includes(state.ui.sortKey) ||
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
    ${renderActionHub()}
  `;
}

function buildAiRecommendations() {
  const rules = Array.isArray(state.ai.recommendationRules)
    ? state.ai.recommendationRules.filter((rule) => rule?.enabled)
    : [];
  if (rules.length) {
    const fromRules = rules
      .map((rule) => buildRecommendationFromRule(rule))
      .filter(Boolean);
    if (fromRules.length) {
      return sortRecommendationsByPriority(fromRules);
    }
  }

  const fallback = [
    {
      title: "Spend Share Risk",
      description: "Flag top spenders with weak CVR.",
      tag: "Insight",
      disabled: true,
    },
    {
      title: "Search Term Gold",
      description: "Highlight winning queries to harvest.",
      tag: "Insight",
      disabled: true,
    },
    {
      title: "A+ Optimization",
      description: "Pinpoint high ACoS pockets to fix.",
      tag: "Strategy",
      disabled: true,
    },
  ];

  if (!state.results?.adTypes) {
    return fallback;
  }

  const recommendations = [];
  const spendRisk = buildSpendShareRiskRecommendation();
  const searchTermGold = buildSearchTermGoldRecommendation();
  const acosOptimization = buildAcosOptimizationRecommendation();

  recommendations.push(spendRisk || fallback[0]);
  recommendations.push(searchTermGold || fallback[1]);
  recommendations.push(acosOptimization || fallback[2]);

  return recommendations;
}

function buildRecommendationFromRule(rule) {
  const title = String(rule.title || "").trim();
  const descriptionTemplate = String(rule.description || "").trim();
  const tag = String(rule.tag || "Insight").trim() || "Insight";
  const priority = String(rule.priority || "Medium").trim() || "Medium";
  const click = rule.click || null;
  const section = rule.section || "";

  if (!title) {
    return null;
  }

  if (!state.results?.adTypes) {
    return {
      title,
      description: descriptionTemplate || "No data available yet.",
      tag,
      priority,
      disabled: true,
    };
  }

  const candidate = evaluateRecommendationRule(rule);
  if (!candidate) {
    return {
      title,
      description: descriptionTemplate || "No matching data found.",
      tag,
      priority,
      disabled: true,
    };
  }

  const formattedValue = formatRecommendationMetric(
    candidate.metric,
    candidate.value
  );
  const description = applyRecommendationTemplate(descriptionTemplate, {
    ...candidate,
    value: formattedValue,
  });

  return {
    title: applyRecommendationTemplate(title, candidate),
    description: description || "Insight available.",
    tag,
    priority,
    target: click ? buildRecommendationTarget(click, section, candidate) : null,
  };
}

function evaluateRecommendationRule(rule) {
  const ruleDef = rule.rule || {};
  const source = String(ruleDef.source || "").trim();
  if (!source) {
    return null;
  }
  const adTypes = resolveRuleAdTypes(rule.adType);
  if (!adTypes.length) {
    return null;
  }

  if (source === "pausedBuckets") {
    return evaluatePausedBucketRule(ruleDef, adTypes, rule.sort);
  }

  if (source === "searchTermInsights") {
    return evaluateSearchTermRule(ruleDef, adTypes, rule.sort);
  }

  return evaluateBucketRule(ruleDef, adTypes, rule.sort);
}

function resolveRuleAdTypes(adType) {
  if (!state.results?.adTypes) {
    return [];
  }
  if (!adType || adType === "All") {
    return Object.keys(state.results.adTypes || {});
  }
  return state.results.adTypes[adType] ? [adType] : [];
}

function evaluateBucketRule(ruleDef, adTypes, sort = {}) {
  const source = String(ruleDef.source || "").trim();
  const bucketFilter = ruleDef.bucket ? String(ruleDef.bucket) : "";
  const metric = String(ruleDef.metric || sort?.by || "").trim() || "spend";
  const min = Number.isFinite(ruleDef.min) ? ruleDef.min : null;
  const direction = String(
    ruleDef.direction || sort?.direction || ruleDef.sort || "desc"
  ).toLowerCase();
  const candidates = [];

  adTypes.forEach((adType) => {
    const buckets = state.results.adTypes?.[adType]?.[source] || [];
    buckets.forEach((bucket) => {
      if (bucketFilter && bucket.bucket !== bucketFilter && bucket.label !== bucketFilter) {
        return;
      }
      const value = resolveBucketMetric(bucket, metric);
      if (min !== null && value < min) {
        return;
      }
      candidates.push({
        adType,
        bucket: bucket.bucket || bucket.label || "",
        metric,
        value,
      });
    });
  });

  if (!candidates.length) {
    return null;
  }
  candidates.sort((a, b) =>
    direction === "asc" ? a.value - b.value : b.value - a.value
  );
  return candidates[0];
}

function evaluatePausedBucketRule(ruleDef, adTypes, sort = {}) {
  const bucketKey = String(ruleDef.bucket || "campaigns").trim();
  const metric = String(ruleDef.metric || sort?.by || "summary.spend").trim();
  const candidates = [];
  adTypes.forEach((adType) => {
    const paused = state.results.adTypes?.[adType]?.pausedBuckets;
    const bucket = paused?.[bucketKey];
    if (!bucket) {
      return;
    }
    const value =
      metric === "count"
        ? bucket.count || 0
        : bucket.summary?.spend || 0;
    candidates.push({
      adType,
      bucket: bucketKey,
      metric,
      value,
    });
  });
  if (!candidates.length) {
    return null;
  }
  const direction = String(sort?.direction || "desc").toLowerCase();
  candidates.sort((a, b) =>
    direction === "asc" ? a.value - b.value : b.value - a.value
  );
  return candidates[0];
}

function evaluateSearchTermRule(ruleDef, adTypes, sort = {}) {
  const listKey = String(ruleDef.bucket || "uniqueKeywords").trim();
  const metric = String(ruleDef.metric || sort?.by || "sales").trim();
  const candidates = [];
  adTypes.forEach((adType) => {
    const insights = state.results.adTypes?.[adType]?.searchTermInsights;
    const list = insights?.[listKey] || [];
    list.forEach((item) => {
      const value = Number(item?.[metric] || 0);
      candidates.push({
        adType,
        term: item.term,
        metric,
        value,
        isAsin: Boolean(item.isAsin),
      });
    });
  });
  if (!candidates.length) {
    return null;
  }
  const direction = String(sort?.direction || "desc").toLowerCase();
  candidates.sort((a, b) =>
    direction === "asc" ? a.value - b.value : b.value - a.value
  );
  return candidates[0];
}

function resolveBucketMetric(bucket, metric) {
  if (!bucket || !metric) {
    return 0;
  }
  if (metric === "acos") {
    return bucket.acos ?? (bucket.sales ? bucket.spend / bucket.sales : 0);
  }
  if (metric === "roas") {
    return bucket.roas ?? (bucket.spend ? bucket.sales / bucket.spend : 0);
  }
  return Number(bucket[metric] || 0);
}

function formatRecommendationMetric(metric, value) {
  if (metric.includes("Pct") || metric === "acos" || metric === "cvr") {
    return formatPercent(value);
  }
  if (metric === "roas") {
    return formatRoas(value);
  }
  if (metric === "avgCpc" || metric === "cpc" || metric === "spend" || metric === "sales") {
    return formatCurrency(value);
  }
  return formatNumber(value);
}

function applyRecommendationTemplate(template, data) {
  if (!template) {
    return "";
  }
  return template.replace(/\{(\w+)\}/g, (_match, key) => {
    if (data[key] === undefined || data[key] === null) {
      return "";
    }
    return String(data[key]);
  });
}

function buildRecommendationTarget(click, sectionFallback, candidate) {
  if (!click || typeof click !== "object") {
    return null;
  }
  const target = { ...click };
  if (!target.section && sectionFallback) {
    target.section = sectionFallback;
  }
  if (!target.adTypeFilter && candidate?.adType) {
    target.adTypeFilter = candidate.adType;
  }
  if (!target.selectedBucket && candidate?.bucket) {
    target.selectedBucket = candidate.bucket;
  }
  if (!target.searchQuery && candidate?.term) {
    target.searchQuery = candidate.term;
  }
  return target;
}

function sortRecommendationsByPriority(recommendations) {
  const weights = { high: 3, medium: 2, low: 1 };
  return [...recommendations].sort((a, b) => {
    const aWeight = weights[String(a.priority || "").toLowerCase()] || 0;
    const bWeight = weights[String(b.priority || "").toLowerCase()] || 0;
    if (bWeight !== aWeight) {
      return bWeight - aWeight;
    }
    return String(a.title || "").localeCompare(String(b.title || ""));
  });
}

async function loadRecommendationRules() {
  if (state.ai.recommendationRules !== null) {
    return;
  }
  state.ai.recommendationRulesStatus = "loading";
  try {
    const response = await fetch("recommendations.json", { cache: "no-store" });
    if (!response.ok) {
      state.ai.recommendationRulesStatus = `error (${response.status})`;
      console.warn("Failed to load recommendations.json", response.status);
      return;
    }
    const data = await response.json();
    const rules = Array.isArray(data?.recommendations) ? data.recommendations : [];
    state.ai.recommendationRules = rules;
    state.ai.recommendationRulesStatus = rules.length ? "loaded" : "empty";
    renderApp();
  } catch (error) {
    state.ai.recommendationRulesStatus = "error";
    console.warn("Failed to parse recommendations.json", error);
  }
}

function buildSpendShareRiskRecommendation() {
  const candidates = [];
  Object.entries(state.results.adTypes || {}).forEach(([adType, data]) => {
    const bucket = (data.campaignBuckets || []).find(
      (item) => item.bucket === "No Sales"
    );
    if (!bucket || !bucket.spend) {
      return;
    }
    candidates.push({
      adType,
      spend: bucket.spend,
      bucketLabel: bucket.bucket,
    });
  });
  if (!candidates.length) {
    return null;
  }
  candidates.sort((a, b) => b.spend - a.spend);
  const best = candidates[0];
  return {
    title: `Spend Share Risk (${best.adType})`,
    description: `${formatCurrency(best.spend)} spend with no sales in ${best.adType} campaigns.`,
    tag: "Insight",
    target: {
      section: "campaigns",
      adTypeFilter: best.adType,
      groupedBy: "acos",
      viewMode: "groups",
      selectedBucket: best.bucketLabel,
      noSalesFilter: "all",
    },
  };
}

function buildSearchTermGoldRecommendation() {
  const candidates = [];
  Object.entries(state.results.adTypes || {}).forEach(([adType, data]) => {
    const insights = data.searchTermInsights;
    if (!insights) {
      return;
    }
    const all = []
      .concat(insights.uniqueKeywords || [])
      .concat(insights.uniqueAsins || []);
    all.forEach((item) => {
      if (!item?.term) {
        return;
      }
      candidates.push({
        adType,
        term: item.term,
        isAsin: Boolean(item.isAsin),
        sales: item.sales || 0,
        spend: item.spend || 0,
      });
    });
  });
  if (!candidates.length) {
    return null;
  }
  candidates.sort((a, b) => {
    if (b.sales !== a.sales) {
      return b.sales - a.sales;
    }
    return b.spend - a.spend;
  });
  const best = candidates[0];
  const typeLabel = best.isAsin ? "ASIN" : "keyword";
  return {
    title: "Search Term Gold",
    description: `Top untargeted ${typeLabel}: "${best.term}" (${formatCurrency(
      best.sales
    )} sales).`,
    tag: "Insight",
    target: {
      section: "search-terms",
      adTypeFilter: best.adType,
      searchTermFilter: best.isAsin ? "asins" : "terms",
      searchQuery: best.term,
      viewMode: "table",
    },
  };
}

function buildAcosOptimizationRecommendation() {
  const candidates = [];
  Object.entries(state.results.adTypes || {}).forEach(([adType, data]) => {
    (data.campaignBuckets || []).forEach((bucket) => {
      if (!bucket?.bucket || bucket.bucket === "No Sales") {
        return;
      }
      const order = bucketSortOrder(bucket.bucket, "acos");
      candidates.push({
        adType,
        bucketLabel: bucket.bucket,
        spend: bucket.spend || 0,
        order,
      });
    });
  });
  if (!candidates.length) {
    return null;
  }
  candidates.sort((a, b) => {
    if (b.order !== a.order) {
      return b.order - a.order;
    }
    return b.spend - a.spend;
  });
  const worst = candidates[0];
  return {
    title: `A+ Optimization (${worst.adType})`,
    description: `Highest ACoS bucket: ${worst.bucketLabel} (${formatCurrency(
      worst.spend
    )} spend).`,
    tag: "Strategy",
    target: {
      section: "campaigns",
      adTypeFilter: worst.adType,
      groupedBy: "acos",
      viewMode: "groups",
      selectedBucket: worst.bucketLabel,
      noSalesFilter: "all",
    },
  };
}

function renderAiRecommendationsHub(useGrid) {
  const tilesClass = useGrid ? "ai-tiles ai-tiles-grid" : "ai-tiles";
  const recommendations = buildAiRecommendations();
  state.ai.recommendations = recommendations;
  const tiles = recommendations
    .map((rec, index) => {
      const clickable = Boolean(rec.target) && !rec.disabled;
      const classes = ["ai-tile", clickable ? "clickable" : "", rec.disabled ? "disabled" : ""]
        .filter(Boolean)
        .join(" ");
      const dataAttr = clickable ? `data-recommendation-index="${index}"` : "";
      const tagLabel = rec.tag || "Insight";
      const tagClass = tagLabel.toLowerCase() === "strategy" ? "strategy" : "insight";
      return `
        <div class="${classes}" ${dataAttr}>
          <div class="ai-dot"></div>
          <div>
            <div class="row space-between">
              <div class="ai-title">${escapeHtml(rec.title)}</div>
              <span class="chip ai-tag ${tagClass}">${escapeHtml(tagLabel)}</span>
            </div>
            <div class="muted">${escapeHtml(rec.description)}</div>
          </div>
        </div>
      `;
    })
    .join("");
  return `
    <div class="card ai-spotlight">
      <div class="row space-between">
        <strong>Insights Hub</strong>
        <span class="chip">Priority Insights</span>
      </div>
      <p class="muted">
        This panel will surface your highest-impact opportunities, tailored to the
        current upload. Think of it as your daily mission brief.
      </p>
      <div class="${tilesClass}">
        ${tiles}
      </div>
      ${renderHealthWarnings()}
    </div>
  `;
}

function renderActionHub() {
  const hasData = Boolean(state.results);
  const plan = state.ai.actionPlan;
  const status = state.ai.actionPlanStatus;
  const error = state.ai.actionPlanError;
  const aiStatus = state.ai.actionPlanAiStatus;
  const aiError = state.ai.actionPlanAiError;
  const items = plan?.items || [];
  const isBusy = status === "loading" || aiStatus === "loading";
  const buttonLabel = plan ? "Regenerate Action Plan" : "Generate Action Plan";
  const canGenerate = hasData && !isBusy;
  const generatedAt = plan?.generatedAt
    ? new Date(plan.generatedAt).toLocaleString("en-GB", {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";
  const statusLine = (() => {
    if (!hasData) {
      return "Upload a bulk sheet to generate an action plan.";
    }
    if (status === "loading") {
      return "Generating action plan...";
    }
    if (status === "empty") {
      return "No high-priority actions found.";
    }
    if (status === "error") {
      return error || "Action plan generation failed.";
    }
    if (aiStatus === "loading") {
      return "Enriching actions with AI...";
    }
    if (aiStatus === "error") {
      return aiError || "AI enrichment failed. Showing deterministic reasons.";
    }
    if (plan && generatedAt) {
      return `Generated ${generatedAt}.`;
    }
    return "Generate a prioritized action queue from the current upload.";
  })();

  const actionCards = items.length
    ? items.map(renderActionCard).join("")
    : `
      <div class="card ai-action-empty">
        <p class="muted">No action plan yet. Generate one to see prioritized fixes.</p>
      </div>
    `;

  return `
    <div class="card ai-action-hub ai-actions">
      <div class="row space-between">
        <strong>Action Queue</strong>
        <span class="chip">Action Plan</span>
      </div>
      <div class="row space-between ai-actions-header">
        <div class="muted">${escapeHtml(statusLine)}</div>
        <button id="ai-action-generate" class="btn primary" ${
          canGenerate ? "" : "disabled"
        }>${buttonLabel}</button>
      </div>
      ${plan?.summary ? `<p class="muted">${escapeHtml(plan.summary)}</p>` : ""}
      <div class="ai-action-list">
        ${actionCards}
      </div>
    </div>
  `;
}

function renderAiChatPanel() {
  const draft = state.ai.chat.draft || "";
  const hasMessages = state.ai.chat.messages.length > 0;
  const isBusy = state.ai.chat.isBusy;
  const hasKey = Boolean(state.ai.apiKey);
  const canSend = hasKey && !isBusy && draft.trim().length > 0;
  const threadContent = hasMessages
    ? state.ai.chat.messages.map(renderAiChatMessage).join("")
    : `
      <p class="muted">
        Ask a question to explore your upload. Insights can reference campaigns,
        ad groups, keywords, placements, and search terms.
      </p>
    `;
  const thinking = isBusy
    ? `<div class="ai-chat-message assistant thinking">Thinking...</div>`
    : "";

  return `
    <div class="card ai-chat">
      <div class="ai-chat-header">
        <div>
          <div class="ai-chat-title">AI Workspace</div>
          <div class="muted">Ask about performance, actions, and what to fix next.</div>
        </div>
      </div>
      <div class="ai-chat-chips" id="ai-chat-chips">
        <button class="chip" type="button">Summarize top spend risks</button>
        <button class="chip" type="button">Explain ACoS outliers</button>
        <button class="chip" type="button">Which campaigns to pause?</button>
        <button class="chip" type="button">Where is wasted spend?</button>
        <button class="chip" type="button">Best keywords to scale</button>
        <button class="chip" type="button">Branded vs non???branded split</button>
      </div>
      <div class="ai-chat-thread" id="ai-chat-thread">
        ${threadContent}
        ${thinking}
      </div>
      <div class="ai-chat-input">
        <textarea
          id="ai-chat-textarea"
          rows="3"
          placeholder="Ask the AI to analyze your account..."
        >${escapeHtml(draft)}</textarea>
        <button id="ai-chat-send" class="btn primary" ${canSend ? "" : "disabled"}>
          Send
        </button>
      </div>
    </div>
  `;
}

function renderAiChatMessage(message) {
  const role = message.role === "user" ? "user" : "assistant";
  const errorClass = message.isError ? " error" : "";
  return `
    <div class="ai-chat-message ${role}${errorClass}">
      ${escapeHtml(message.content || "")}
    </div>
  `;
}

function renderActionCard(item) {
  const statusClass =
    item.status === "done"
      ? " done"
      : item.status === "dismissed"
        ? " dismissed"
        : "";
  const typeLabel = formatActionTypeLabel(item.type);
  const priority = Number.isFinite(item.priority) ? Math.round(item.priority) : 0;
  const confidence = Number.isFinite(item.confidence)
    ? Math.round(item.confidence * 100)
    : 0;
  const metrics = renderActionMetrics(item.metrics);
  const rationale = item.rationale || item.summary || "";
  const doneDisabled = item.status === "done" ? "disabled" : "";
  const dismissDisabled = item.status === "dismissed" ? "disabled" : "";
  return `
    <div class="card ai-action-card${statusClass}">
      <div class="row space-between">
        <strong>${escapeHtml(item.title)}</strong>
        <span class="chip ai-action-type type-${item.type}">${escapeHtml(
          typeLabel
        )}</span>
      </div>
      ${rationale ? `<p class="muted">${escapeHtml(rationale)}</p>` : ""}
      ${metrics}
      <div class="row space-between ai-action-footer">
        <div class="row ai-action-meta">
          <span class="chip">Priority ${priority}</span>
          <span class="chip">Conf ${confidence}%</span>
          <span class="chip">Status ${escapeHtml(item.status || "proposed")}</span>
        </div>
        <div class="row ai-action-controls">
          <button class="btn ghost" data-action-jump="${escapeHtml(item.id)}">Jump to data</button>
          <button class="btn ghost" data-action-done="${escapeHtml(
            item.id
          )}" ${doneDisabled}>Mark done</button>
          <button class="btn ghost" data-action-dismiss="${escapeHtml(
            item.id
          )}" ${dismissDisabled}>Dismiss</button>
        </div>
      </div>
    </div>
  `;
}

const ACTION_TYPE_LABELS = {
  reduce_bid: "Reduce bid",
  pause: "Pause",
  add_negative: "Add negative",
  scale: "Scale",
  investigate: "Investigate",
};

function formatActionTypeLabel(type) {
  return ACTION_TYPE_LABELS[type] || "Action";
}

function renderActionMetrics(metrics = {}) {
  const chips = [];
  if (Number.isFinite(metrics.spend)) {
    chips.push(`Spend ${formatCurrency(metrics.spend)}`);
  }
  if (Number.isFinite(metrics.sales)) {
    chips.push(`Sales ${formatCurrency(metrics.sales)}`);
  }
  if (Number.isFinite(metrics.acos)) {
    chips.push(`ACoS ${formatPercent(metrics.acos)}`);
  }
  if (Number.isFinite(metrics.roas)) {
    chips.push(`ROAS ${formatRoas(metrics.roas)}`);
  }
  if (Number.isFinite(metrics.cvr)) {
    chips.push(`CVR ${formatPercent(metrics.cvr)}`);
  }
  if (Number.isFinite(metrics.clicks)) {
    chips.push(`Clicks ${formatNumber(metrics.clicks)}`);
  }
  if (!chips.length) {
    return "";
  }
  return `
    <div class="row ai-action-metrics">
      ${chips.map((chip) => `<span class="chip">${escapeHtml(chip)}</span>`).join("")}
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

function updateActionStatus(id, status) {
  if (!id || !state.ai.actionPlan?.items?.length) {
    return;
  }
  const item = state.ai.actionPlan.items.find((entry) => entry.id === id);
  if (!item) {
    return;
  }
  item.status = status;
  renderApp();
}

function generateActionPlan() {
  if (!state.results) {
    state.ai.actionPlanStatus = "error";
    state.ai.actionPlanError = "Upload a bulk sheet before generating actions.";
    renderApp();
    return;
  }

  state.ai.actionPlanStatus = "loading";
  state.ai.actionPlanError = "";
  state.ai.actionPlanAiStatus = "";
  state.ai.actionPlanAiError = "";
  renderApp();

  try {
    const plan = buildActionPlan();
    state.ai.actionPlan = plan;
    state.ai.actionPlanStatus = plan.items.length ? "ready" : "empty";
    renderApp();
    if (state.ai.apiKey && plan.items.length) {
      enrichActionPlanWithAi(plan.items.slice(0, 3));
    }
  } catch (error) {
    state.ai.actionPlanStatus = "error";
    state.ai.actionPlanError = error?.message || "Action plan generation failed.";
    renderApp();
  }
}

function buildActionPlan() {
  const thresholds = getActionThresholds();
  const items = [
    ...buildSearchTermActions(thresholds),
    ...buildTargetActions(thresholds),
  ];
  const sorted = items.sort((a, b) => (b.priority || 0) - (a.priority || 0));
  const trimmed = sorted.slice(0, ACTION_PLAN_MAX_ITEMS);
  const summary = trimmed.length
    ? `Generated ${trimmed.length} prioritized actions from the latest upload.`
    : "No actions met the current thresholds.";
  return {
    generatedAt: Date.now(),
    summary,
    items: trimmed,
  };
}

function buildSearchTermActions(thresholds) {
  const rows = getSearchTermRows();
  if (!rows.length) {
    return [];
  }
  const grouped = groupBy(rows, (row) => {
    const term = String(row.customerSearchTerm || "").trim();
    if (!term) {
      return "";
    }
    return `${row.adType || "All"}::${term}`;
  });
  return Object.entries(grouped)
    .filter(([key]) => key)
    .map(([_key, items]) => {
      const term = String(items[0].customerSearchTerm || "").trim();
      const adType = items[0].adType || "All";
      const summary = computeSummary(items);
      const actionType =
        summary.spend >= thresholds.spendNoSales && summary.sales === 0
          ? "add_negative"
          : null;
      if (!actionType) {
        return null;
      }
      const target = buildActionTarget({
        section: "search-terms",
        label: term,
        adType,
        actionType,
      });
      return buildActionItem({
        idPrefix: "search",
        label: term,
        entityLabel: "Search Term",
        type: actionType,
        summary,
        thresholds,
        target,
      });
    })
    .filter(Boolean);
}

function buildTargetActions(thresholds) {
  const rows = getCampaignRows().filter((row) =>
    ["keyword", "product targeting"].includes(row.entityNormalized)
  );
  if (!rows.length) {
    return [];
  }
  const grouped = groupBy(rows, (row) => {
    const sectionKey = getMatchSectionKey(row);
    const label = getTargetLabelForRow(row);
    if (!sectionKey || !label) {
      return "";
    }
    return `${sectionKey}::${row.adType || "All"}::${label}`;
  });

  return Object.entries(grouped)
    .filter(([key]) => key)
    .map(([_key, items]) => {
      const row = items[0];
      const sectionKey = getMatchSectionKey(row);
      const label = getTargetLabelForRow(row);
      if (!sectionKey || !label) {
        return null;
      }
      const summary = computeSummary(items);
      const actionType = selectActionForSummary(summary, thresholds);
      if (!actionType) {
        return null;
      }
      const adType = row.adType || "All";
      const target = buildActionTarget({
        section: sectionKey,
        label,
        adType,
        actionType,
      });
      const entityLabel = getSectionConfig(sectionKey).entityLabel || "Target";
      return buildActionItem({
        idPrefix: sectionKey,
        label,
        entityLabel,
        type: actionType,
        summary,
        thresholds,
        target,
      });
    })
    .filter(Boolean);
}

function buildActionItem({
  idPrefix,
  label,
  entityLabel,
  type,
  summary,
  thresholds,
  target,
}) {
  const priority = scoreAction(type, summary, thresholds);
  const confidence = computeActionConfidence(type, summary, thresholds);
  return {
    id: `${idPrefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    title: buildActionTitle(type, label, entityLabel),
    type,
    priority,
    confidence,
    status: "proposed",
    target,
    metrics: {
      spend: summary.spend,
      sales: summary.sales,
      acos: summary.acos,
      roas: summary.roas,
      cvr: summary.cvr,
      clicks: summary.clicks,
    },
    evidence: buildActionEvidence(summary),
    rationale: buildActionRationale(type, summary, thresholds),
  };
}

function getActionThresholds() {
  const totalSpend = state.accountTotals?.spend || 0;
  const totalSales = state.accountTotals?.sales || 0;
  return {
    spendNoSales: Math.max(25, totalSpend * 0.005),
    spendHighAcos: Math.max(50, totalSpend * 0.01),
    acosTarget: 0.4,
    roasTarget: 3,
    salesHigh: Math.max(100, totalSales * 0.01),
    clicksLowCvr: 80,
    cvrTarget: 0.08,
  };
}

function selectActionForSummary(summary, thresholds) {
  if (summary.spend >= thresholds.spendNoSales && summary.sales === 0) {
    return "pause";
  }
  if (
    summary.spend >= thresholds.spendHighAcos &&
    Number.isFinite(summary.acos) &&
    summary.acos >= thresholds.acosTarget
  ) {
    return "reduce_bid";
  }
  if (
    summary.sales >= thresholds.salesHigh &&
    Number.isFinite(summary.roas) &&
    summary.roas >= thresholds.roasTarget
  ) {
    return "scale";
  }
  if (
    summary.clicks >= thresholds.clicksLowCvr &&
    Number.isFinite(summary.cvr) &&
    summary.cvr <= thresholds.cvrTarget
  ) {
    return "investigate";
  }
  return null;
}

function scoreAction(type, summary, thresholds) {
  const spend = summary.spend || 0;
  const sales = summary.sales || 0;
  const clicks = summary.clicks || 0;
  const acos = summary.acos || 0;
  const roas = summary.roas || 0;
  const cvr = summary.cvr || 0;
  let score = 0;
  if (type === "pause" || type === "add_negative") {
    score = Math.log10(spend + 1) * 100;
  } else if (type === "reduce_bid") {
    score = (acos / thresholds.acosTarget) * Math.log10(spend + 1) * 60;
  } else if (type === "scale") {
    score = roas * Math.log10(sales + 1) * 40;
  } else if (type === "investigate") {
    score =
      (1 - cvr / thresholds.cvrTarget) * Math.log10(clicks + 1) * 30;
  }
  return Number.isFinite(score) ? score : 0;
}

function computeActionConfidence(type, summary, thresholds) {
  const clamp = (value) => Math.min(0.95, Math.max(0.4, value));
  const ratio = (value, threshold) =>
    threshold ? Math.min(1, value / threshold) : 0;
  if (type === "pause" || type === "add_negative") {
    return clamp(0.4 + 0.6 * ratio(summary.spend || 0, thresholds.spendNoSales));
  }
  if (type === "reduce_bid") {
    return clamp(0.4 + 0.6 * ratio(summary.spend || 0, thresholds.spendHighAcos));
  }
  if (type === "scale") {
    return clamp(0.4 + 0.6 * ratio(summary.sales || 0, thresholds.salesHigh));
  }
  if (type === "investigate") {
    return clamp(
      0.4 + 0.6 * ratio(summary.clicks || 0, thresholds.clicksLowCvr)
    );
  }
  return 0.5;
}

function buildActionTitle(type, label, entityLabel) {
  const safeLabel = label || "Item";
  if (type === "pause") {
    return `Pause ${entityLabel}: ${safeLabel}`;
  }
  if (type === "add_negative") {
    return `Add negative: ${safeLabel}`;
  }
  if (type === "reduce_bid") {
    return `Reduce bid: ${safeLabel}`;
  }
  if (type === "scale") {
    return `Scale: ${safeLabel}`;
  }
  if (type === "investigate") {
    return `Investigate: ${safeLabel}`;
  }
  return `Action: ${safeLabel}`;
}

function buildActionRationale(type, summary, thresholds) {
  if (type === "pause" || type === "add_negative") {
    return `Spend ${formatCurrency(
      summary.spend
    )} with no sales detected.`;
  }
  if (type === "reduce_bid") {
    return `ACoS ${formatPercent(summary.acos)} exceeds target ${formatPercent(
      thresholds.acosTarget
    )}.`;
  }
  if (type === "scale") {
    return `ROAS ${formatRoas(summary.roas)} on ${formatCurrency(
      summary.sales
    )} sales indicates strong efficiency.`;
  }
  if (type === "investigate") {
    return `CVR ${formatPercent(summary.cvr)} below target ${formatPercent(
      thresholds.cvrTarget
    )} with ${formatNumber(summary.clicks)} clicks.`;
  }
  return "";
}

function buildActionEvidence(summary) {
  const evidence = [];
  if (Number.isFinite(summary.spend)) {
    evidence.push(`Spend ${formatCurrency(summary.spend)}`);
  }
  if (Number.isFinite(summary.sales)) {
    evidence.push(`Sales ${formatCurrency(summary.sales)}`);
  }
  if (Number.isFinite(summary.acos)) {
    evidence.push(`ACoS ${formatPercent(summary.acos)}`);
  }
  if (Number.isFinite(summary.cvr)) {
    evidence.push(`CVR ${formatPercent(summary.cvr)}`);
  }
  if (Number.isFinite(summary.clicks)) {
    evidence.push(`${formatNumber(summary.clicks)} clicks`);
  }
  return evidence.slice(0, 3);
}

function buildActionTarget({ section, label, adType, actionType }) {
  const target = {
    section,
    viewMode: "table",
    searchQuery: label,
  };
  if (adType && adType !== "All") {
    target.adTypeFilter = adType;
  }
  if (actionType === "pause" || actionType === "add_negative") {
    target.noSalesFilter = "no-sales";
  }
  if (section === "search-terms") {
    const term = String(label || "");
    target.searchTermFilter = term.toUpperCase().includes("B0")
      ? "asins"
      : "terms";
  }
  return target;
}

function getMatchSectionKey(row) {
  if (!row) {
    return null;
  }
  if (row.entityNormalized === "keyword") {
    return "match-keywords";
  }
  if (row.entityNormalized !== "product targeting") {
    return null;
  }
  const matchType = String(row.matchType || "");
  if (matchType === "ASINs") {
    return "match-asins";
  }
  if (matchType === "ASINs Expanded") {
    return "match-asins-expanded";
  }
  if (matchType === "Auto") {
    return "match-auto";
  }
  if (matchType === "Category") {
    return "match-categories";
  }
  if (matchType === "Related Keywords") {
    return "match-related";
  }
  return null;
}

function getTargetLabelForRow(row) {
  if (!row) {
    return "";
  }
  return (
    row.keywordText ||
    row.asinTarget ||
    row.productTargetingExpression ||
    ""
  );
}

function getCampaignRows() {
  return state.datasets
    .filter((set) => set.def.kind === "campaign")
    .flatMap((set) => set.rows);
}

function getSearchTermRows() {
  return state.datasets
    .filter((set) => set.def.kind === "searchTerm")
    .flatMap((set) => set.rows);
}

async function enrichActionPlanWithAi(items) {
  state.ai.actionPlanAiStatus = "loading";
  state.ai.actionPlanAiError = "";
  renderApp();
  try {
    const payload = items.map((item) => ({
      id: item.id,
      title: item.title,
      type: item.type,
      metrics: item.metrics,
      evidence: item.evidence,
    }));
    const instructions =
      "You are an Amazon Ads audit analyst. For each action, write a single concise 'why now' sentence (max 20 words). Return JSON array of {id, explanation}.";
    const responseText = await requestChatResponse({
      apiKey: state.ai.apiKey,
      model: state.ai.model,
      instructions,
      messages: [
        {
          role: "user",
          content: `Actions:\n${JSON.stringify(payload)}`,
        },
      ],
    });
    const parsed = parseJsonArray(responseText);
    if (!Array.isArray(parsed)) {
      throw new Error("AI response missing JSON array.");
    }
    const map = new Map(
      parsed
        .filter((item) => item && item.id && item.explanation)
        .map((item) => [item.id, String(item.explanation)])
    );
    if (state.ai.actionPlan?.items?.length) {
      state.ai.actionPlan.items = state.ai.actionPlan.items.map((item) =>
        map.has(item.id)
          ? { ...item, rationale: map.get(item.id) }
          : item
      );
    }
    state.ai.actionPlanAiStatus = "ready";
    renderApp();
  } catch (error) {
    state.ai.actionPlanAiStatus = "error";
    state.ai.actionPlanAiError =
      error?.message || "AI enrichment failed.";
    renderApp();
  }
}

function parseJsonArray(text) {
  const raw = String(text || "");
  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]");
  if (start === -1 || end === -1) {
    return null;
  }
  const slice = raw.slice(start, end + 1);
  try {
    return JSON.parse(slice);
  } catch (_error) {
    return null;
  }
}

function attachOverviewHandlers() {
  workspaceContent.querySelectorAll("[data-insight]").forEach((card) => {
    card.addEventListener("click", () => {
      state.ui.selectedEntity = {
        label: card.dataset.insight,
        type: "Insight",
      };
      state.ui.inspectorOpen = true;
      state.ui.inspectorDismissed = false;
      renderInspector();
    });
  });
  attachAiRecommendationHandlers();
  attachActionPlanHandlers(workspaceContent);
}

function attachActionPlanHandlers(container) {
  const scope = container || document;
  const generateButton = scope.querySelector("#ai-action-generate");
  if (generateButton) {
    generateButton.addEventListener("click", () => {
      if (generateButton.disabled) {
        return;
      }
      generateActionPlan();
    });
  }

  scope.querySelectorAll("[data-action-jump]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.dataset.actionJump;
      const item = state.ai.actionPlan?.items?.find((entry) => entry.id === id);
      if (!item?.target) {
        return;
      }
      applyRecommendationTarget(item.target);
    });
  });

  scope.querySelectorAll("[data-action-done]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.dataset.actionDone;
      updateActionStatus(id, "done");
    });
  });

  scope.querySelectorAll("[data-action-dismiss]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.dataset.actionDismiss;
      updateActionStatus(id, "dismissed");
    });
  });
}

function attachAiRecommendationHandlers() {
  workspaceContent.querySelectorAll("[data-recommendation-index]").forEach((tile) => {
    tile.addEventListener("click", () => {
      const index = Number(tile.dataset.recommendationIndex);
      const recommendation = state.ai.recommendations?.[index];
      if (!recommendation?.target) {
        return;
      }
      applyRecommendationTarget(recommendation.target);
    });
  });
}

function applyRecommendationTarget(target) {
  if (!target?.section) {
    return;
  }
  state.ui.activeSection = target.section;
  const sectionConfig = getSectionConfig(target.section);
  state.ui.viewMode = target.viewMode || sectionConfig.defaultView;
  if (target.adTypeFilter) {
    state.ui.adTypeFilter = target.adTypeFilter;
  }
  if (target.groupedBy) {
    state.ui.groupedBy = target.groupedBy;
  }
  if (target.noSalesFilter) {
    state.ui.noSalesFilter = target.noSalesFilter;
  }
  if (target.searchTermFilter) {
    state.ui.searchTermFilter = target.searchTermFilter;
  }
  if (target.searchQuery !== undefined) {
    state.ui.searchQuery = target.searchQuery;
  }
  state.ui.selectedBucket = target.selectedBucket || null;
  state.ui.selectedEntity = null;
  state.ui.inspectorOpen = false;
  renderApp();
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
  const noSalesFiltered =
    state.ui.noSalesFilter === "no-sales"
      ? filtered.filter(
          (row) => (row.spend || 0) > 0 && (row.sales || 0) === 0
        )
      : filtered;
  if (!noSalesFiltered.length) {
    return [];
  }
  const grouped = groupBy(noSalesFiltered, (row) => {
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
  const noSalesFiltered =
    state.ui.noSalesFilter === "no-sales"
      ? filtered.filter(
          (row) => (row.spend || 0) > 0 && (row.sales || 0) === 0
        )
      : filtered;
  if (!noSalesFiltered.length) {
    return [];
  }
  const showCampaignChip =
    sectionConfig.key.startsWith("match-") && state.ui.showCampaignChips;
  const useCampaignScopedGrouping =
    sectionConfig.key.startsWith("match-") && sectionConfig.key !== "match-types";
  const grouped = groupBy(noSalesFiltered, (row) => {
    const baseKey = sectionConfig.groupKey(row);
    if (!useCampaignScopedGrouping) {
      return baseKey;
    }
    const campaignKey = getCampaignKeyForRow(row);
    return `${campaignKey}::${baseKey}`;
  });
  const entities = Object.entries(grouped).map(([key, items]) => {
    const displayKey = useCampaignScopedGrouping
      ? sectionConfig.groupKey(items[0])
      : key;
    return {
      key,
      label: sectionConfig.groupLabel(items[0], displayKey, items),
      summary: computeSummary(items),
      rows: items,
    };
  });
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
  const baseFiltered = rows.filter((item) =>
    item.label.toLowerCase().includes(search)
  );
  const noSalesFiltered =
    state.ui.noSalesFilter === "no-sales"
      ? baseFiltered.filter(
          (item) => (item.summary?.spend || 0) > 0 && (item.summary?.sales || 0) === 0
        )
      : baseFiltered;
  const sorted = applySorting(noSalesFiltered);
  const limit = Number.isFinite(state.ui.tableLimit)
    ? state.ui.tableLimit
    : sorted.length;
  const visible = sorted.slice(0, limit);
  const isSearchTerms = state.ui.activeSection === "search-terms";
  const isMatchTypes = state.ui.activeSection === "match-types";
  const showCopyIcon = state.ui.activeSection !== "match-types";
  const columnCount = 8 + (isSearchTerms ? 2 : 0) + (isMatchTypes ? 2 : 0);
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
      const shareCells = isMatchTypes
        ? `<td class="num">${formatPercent(item.spendSharePct)}</td>
           <td class="num">${formatPercent(item.salesSharePct)}</td>`
        : "";
      const label =
        isSearchTerms && state.ui.searchTermFilter === "asins"
          ? String(item.label).toUpperCase()
          : item.label;
      const campaignLabel = isSearchTerms
        ? item.raw?.campaignName || item.raw?.campaignId || ""
        : "";
      const showCampaignChip =
        isSearchTerms && state.ui.searchTermShowCampaignChips && campaignLabel;
      const copyValue = String(label || "");
      const copyButton = showCopyIcon
        ? `<button class="copy-btn" data-copy="${escapeHtml(copyValue)}" aria-label="Copy name">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <rect x="9" y="9" width="10" height="10" rx="2" />
              <rect x="5" y="5" width="10" height="10" rx="2" />
            </svg>
          </button>`
        : "";
      const nameCell = showCampaignChip
        ? `<div class="name-stack">
            <span class="name-cell">
              ${escapeHtml(label)}
              ${copyButton}
            </span>
            <span class="chip campaign-chip">${escapeHtml(campaignLabel)}</span>
          </div>`
        : `<span class="name-cell">
            ${escapeHtml(label)}
            ${copyButton}
          </span>`;
      return `
        <tr class="${selected ? "selected" : ""}" data-entity="${item.id}">
          <td>
            ${nameCell}
          </td>
          <td>${escapeHtml(item.adType || "—")}</td>
          <td class="num">${formatCurrency(item.summary.spend)}</td>
          <td class="num">${formatCurrency(item.summary.sales)}</td>
          ${clickCells}
          ${shareCells}
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
  const sortIndicator = (key) =>
    state.ui.sortKey === key
      ? `<span class="sort-indicator">${
          state.ui.sortDirection === "desc" ? "↓" : "↑"
        }</span>`
      : "";
  const clickHeaders = isSearchTerms
    ? `<th class="num" data-sort-key="clicks">Clicks${sortIndicator("clicks")}</th>
       <th class="num" data-sort-key="cpc">CPC${sortIndicator("cpc")}</th>`
    : "";
  const shareHeaders = isMatchTypes
    ? `<th class="num" data-sort-key="spendSharePct">Spend share %${sortIndicator("spendSharePct")}</th>
       <th class="num" data-sort-key="salesSharePct">Sales share %${sortIndicator("salesSharePct")}</th>`
    : "";
  return `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th data-sort-key="label">Name${sortIndicator("label")}</th>
            <th>Ad type</th>
            <th class="num" data-sort-key="spend">Spend${sortIndicator("spend")}</th>
            <th class="num" data-sort-key="sales">Sales${sortIndicator("sales")}</th>
            ${clickHeaders}
            ${shareHeaders}
            <th class="num" data-sort-key="acos">ACoS${sortIndicator("acos")}</th>
            <th class="num" data-sort-key="roas">ROAS${sortIndicator("roas")}</th>
            <th class="num" data-sort-key="cvr">CVR${sortIndicator("cvr")}</th>
            <th class="num" data-sort-key="orders">Orders${sortIndicator("orders")}</th>
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
                row.campaignLabel &&
                state.ui.showCampaignChips &&
                state.ui.activeSection.startsWith("match-")
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
                  <th data-detail-sort="label">Name${state.ui.detailSortKey === "label" ? `<span class="sort-indicator">${state.ui.detailSortDirection === "desc" ? "↓" : "↑"}</span>` : ""}</th>
                  <th class="num" data-detail-sort="impressions">Impr${state.ui.detailSortKey === "impressions" ? `<span class="sort-indicator">${state.ui.detailSortDirection === "desc" ? "↓" : "↑"}</span>` : ""}</th>
                  <th class="num" data-detail-sort="clicks">Clicks${state.ui.detailSortKey === "clicks" ? `<span class="sort-indicator">${state.ui.detailSortDirection === "desc" ? "↓" : "↑"}</span>` : ""}</th>
                  <th class="num" data-detail-sort="ctr">CTR${state.ui.detailSortKey === "ctr" ? `<span class="sort-indicator">${state.ui.detailSortDirection === "desc" ? "↓" : "↑"}</span>` : ""}</th>
                  <th class="num" data-detail-sort="spend">Spend${state.ui.detailSortKey === "spend" ? `<span class="sort-indicator">${state.ui.detailSortDirection === "desc" ? "↓" : "↑"}</span>` : ""}</th>
                  <th class="num" data-detail-sort="sales">Sales${state.ui.detailSortKey === "sales" ? `<span class="sort-indicator">${state.ui.detailSortDirection === "desc" ? "↓" : "↑"}</span>` : ""}</th>
                  <th class="num" data-detail-sort="orders">Orders${state.ui.detailSortKey === "orders" ? `<span class="sort-indicator">${state.ui.detailSortDirection === "desc" ? "↓" : "↑"}</span>` : ""}</th>
                  <th class="num" data-detail-sort="units">Units${state.ui.detailSortKey === "units" ? `<span class="sort-indicator">${state.ui.detailSortDirection === "desc" ? "↓" : "↑"}</span>` : ""}</th>
                  <th class="num" data-detail-sort="cvr">CVR${state.ui.detailSortKey === "cvr" ? `<span class="sort-indicator">${state.ui.detailSortDirection === "desc" ? "↓" : "↑"}</span>` : ""}</th>
                  <th class="num" data-detail-sort="acos">ACoS${state.ui.detailSortKey === "acos" ? `<span class="sort-indicator">${state.ui.detailSortDirection === "desc" ? "↓" : "↑"}</span>` : ""}</th>
                  <th class="num" data-detail-sort="cpc">CPC${state.ui.detailSortKey === "cpc" ? `<span class="sort-indicator">${state.ui.detailSortDirection === "desc" ? "↓" : "↑"}</span>` : ""}</th>
                  <th class="num" data-detail-sort="roas">ROAS${state.ui.detailSortKey === "roas" ? `<span class="sort-indicator">${state.ui.detailSortDirection === "desc" ? "↓" : "↑"}</span>` : ""}</th>
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
  const sorted = [...rows].sort((a, b) => {
    if (state.ui.sortKey === "group") {
      return (
        bucketSortOrder(a.bucket, state.ui.groupedBy) -
        bucketSortOrder(b.bucket, state.ui.groupedBy)
      );
    }
    const key = state.ui.sortKey;
    const direction = state.ui.sortDirection === "desc" ? -1 : 1;
    const aVal = a[key] ?? 0;
    const bVal = b[key] ?? 0;
    if (aVal === bVal) {
      return 0;
    }
    return aVal > bVal ? direction : -direction;
  });
  const sortIndicator = (key) =>
    state.ui.sortKey === key
      ? `<span class="sort-indicator">${
          state.ui.sortDirection === "desc" ? "↓" : "↑"
        }</span>`
      : "";
  const body = sorted
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
            <th data-sort-key="group">Group${sortIndicator("group")}</th>
            <th class="num" data-sort-key="count">Count${sortIndicator("count")}</th>
            <th class="num" data-sort-key="spendSharePct">Spend share %${sortIndicator("spendSharePct")}</th>
            <th class="num" data-sort-key="salesSharePct">Sales share %${sortIndicator("salesSharePct")}</th>
            <th class="num" data-sort-key="spend">Spend${sortIndicator("spend")}</th>
            <th class="num" data-sort-key="sales">Sales${sortIndicator("sales")}</th>
            <th class="num" data-sort-key="clicks">Clicks${sortIndicator("clicks")}</th>
            <th class="num" data-sort-key="orders">Orders${sortIndicator("orders")}</th>
            <th class="num" data-sort-key="cpc">CPC${sortIndicator("cpc")}</th>
            <th class="num" data-sort-key="acos">ACoS${sortIndicator("acos")}</th>
            <th class="num" data-sort-key="roas">ROAS${sortIndicator("roas")}</th>
            <th class="num" data-sort-key="cvr">CVR${sortIndicator("cvr")}</th>
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
            <span class="chip">${escapeHtml(item.adType || "???")}</span>
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
    attachAiChatHandlers();
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
      title: "Negated Targets",
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
    if (key === "label") {
      return direction * String(a.label || "").localeCompare(String(b.label || ""));
    }
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

function getCampaignKeyForRow(row) {
  return row.campaignId || row.campaignName || row.campaignKey || "";
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

function resetActionPlan(message) {
  state.ai.actionPlan = null;
  state.ai.actionPlanStatus = "";
  state.ai.actionPlanError = message || "";
  state.ai.actionPlanAiStatus = "";
  state.ai.actionPlanAiError = "";
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
  updateAiChatControls();
}

function updateAiChatControls() {
  const textarea = inspectorBody?.querySelector("#ai-chat-textarea");
  const sendButton = inspectorBody?.querySelector("#ai-chat-send");
  if (!textarea || !sendButton) {
    return;
  }
  const hasText = textarea.value.trim().length > 0;
  sendButton.disabled = !state.ai.apiKey || state.ai.chat.isBusy || !hasText;
}

function buildLeanResults(results) {
  if (!results || !results.adTypes) {
    return results || null;
  }
  const stripBucketDetails = (items = []) =>
    items.map((item) => {
      const cleaned = {};
      if (Object.prototype.hasOwnProperty.call(item, "bucket")) {
        cleaned.bucket = item.bucket;
      }
      if (Object.prototype.hasOwnProperty.call(item, "label")) {
        cleaned.label = item.label;
      }
      ["spend", "sales", "spendPct", "salesPct", "avgCpc", "acos", "roas"].forEach(
        (key) => {
          if (Object.prototype.hasOwnProperty.call(item, key)) {
            cleaned[key] = item[key];
          }
        }
      );
      return cleaned;
    });
  const summarizePausedBuckets = (pausedBuckets) => {
    if (!pausedBuckets) {
      return null;
    }
    return {
      campaigns: pausedBuckets.campaigns,
      adGroups: pausedBuckets.adGroups,
      targets: pausedBuckets.targets,
    };
  };
  const summarizeMatchTypeMix = (flag) => {
    if (!flag) {
      return null;
    }
    return { count: flag.count };
  };
  const summarizeSearchTermInsights = (insights) => {
    if (!insights) {
      return null;
    }
    return {
      uniqueKeywordsCount: insights.uniqueKeywords?.length || 0,
      uniqueAsinsCount: insights.uniqueAsins?.length || 0,
    };
  };
  const adTypes = Object.entries(results.adTypes).reduce((acc, [adType, data]) => {
    acc[adType] = {
      summary: data.summary,
      campaignBuckets: stripBucketDetails(data.campaignBuckets),
      keywordBuckets: stripBucketDetails(data.keywordBuckets),
      asinBuckets: stripBucketDetails(data.asinBuckets),
      matchTypeBuckets: stripBucketDetails(data.matchTypeBuckets),
      placementBuckets: stripBucketDetails(data.placementBuckets),
      biddingStrategyBuckets: stripBucketDetails(data.biddingStrategyBuckets),
      pausedBuckets: summarizePausedBuckets(data.pausedBuckets),
      brandedBucket: data.brandedBucket,
      matchTypeMixFlag: summarizeMatchTypeMix(data.matchTypeMixFlag),
      sbVideoPresence: data.sbVideoPresence,
      searchTermInsights: summarizeSearchTermInsights(data.searchTermInsights),
    };
    return acc;
  }, {});
  return {
    engineVersion: results.engineVersion,
    generatedAt: results.generatedAt,
    adTypes,
  };
}

function trimChatContext(context, maxChars, mode = "auto") {
  const limit = maxChars || AI_CHAT_MAX_CONTEXT_CHARS;

  if (mode === "minimal") {
    const minimal = {
      session: context.session,
      brandAliases: context.brandAliases,
      accountTotals: context.accountTotals,
      results: buildLeanResults(context.results),
      contextTrimmed: true,
      trimReason: "Context trimmed to summary-only.",
    };
    return { text: JSON.stringify(minimal), trimmed: true, reason: minimal.trimReason };
  }

  let text = JSON.stringify(context);
  if (text.length <= limit) {
    return { text, trimmed: false, reason: "" };
  }

  const minimal = {
    session: context.session,
    brandAliases: context.brandAliases,
    accountTotals: context.accountTotals,
    results: buildLeanResults(context.results),
    contextTrimmed: true,
    trimReason: "Context trimmed to summary-only.",
  };
  text = JSON.stringify(minimal);
  return { text, trimmed: true, reason: minimal.trimReason };
}

function buildAiChatContextText(options = {}) {
  const { maxChars, mode = "auto" } = options;
  const session = state.sessions.find((entry) => entry.id === state.activeSessionId);
  const context = {
    session: session
      ? {
          id: session.id,
          name: session.name,
          date: session.date,
          notes: session.notes,
        }
      : null,
    brandAliases: state.brandAliases,
    accountTotals: state.accountTotals,
    results: buildLeanResults(state.results),
  };
  const { text, trimmed, reason } = trimChatContext(context, maxChars, mode);
  state.ai.chat.contextTrimmed = trimmed;
  state.ai.chat.trimReason = reason || "";
  return text;
}

function buildChatMessages(history, options = {}) {
  const { historyLimit = AI_CHAT_MAX_HISTORY, maxChars, mode } = options;
  const contextText = buildAiChatContextText({ maxChars, mode });
  const contextMessage = {
    role: "user",
    content: `Context data (JSON). Use this as the source of truth for analysis:
${contextText}`,
  };
  const trimmedHistory = (history || [])
    .filter((item) => !item.isError)
    .slice(-historyLimit)
    .map((item) => ({ role: item.role, content: item.content }));
  return [contextMessage, ...trimmedHistory];
}

function attachAiChatHandlers() {
  const textarea = inspectorBody?.querySelector("#ai-chat-textarea");
  const sendButton = inspectorBody?.querySelector("#ai-chat-send");
  const chips = inspectorBody?.querySelectorAll("#ai-chat-chips .chip");
  if (!textarea || !sendButton) {
    return;
  }

  textarea.addEventListener("input", () => {
    state.ai.chat.draft = textarea.value;
    updateAiChatControls();
  });

  sendButton.addEventListener("click", () => {
    sendAiChatMessage();
  });

  chips?.forEach((chip) => {
    chip.addEventListener("click", () => {
      state.ai.chat.draft = chip.textContent || "";
      textarea.value = state.ai.chat.draft;
      textarea.focus();
      updateAiChatControls();
    });
  });

  updateAiChatControls();
  requestAnimationFrame(() => {
    const thread = inspectorBody?.querySelector("#ai-chat-thread");
    if (thread) {
      thread.scrollTop = thread.scrollHeight;
    }
  });
}

async function sendAiChatMessage() {
  const textarea = inspectorBody?.querySelector("#ai-chat-textarea");
  const message = textarea?.value.trim() || "";
  if (!message || !state.ai.apiKey || state.ai.chat.isBusy) {
    return;
  }

  state.ai.chat.messages.push({ role: "user", content: message });
  state.ai.chat.draft = "";
  state.ai.chat.isBusy = true;
  renderInspector();

  try {
    const instructions =
      "You are an Amazon Ads audit analyst. Provide concise, actionable insights.";
    let responseText = "";
    try {
      responseText = await requestChatResponse({
        apiKey: state.ai.apiKey,
        model: state.ai.model,
        instructions,
        messages: buildChatMessages(state.ai.chat.messages),
      });
    } catch (error) {
      if (!isContextLengthError(error)) {
        throw error;
      }
      responseText = await requestChatResponse({
        apiKey: state.ai.apiKey,
        model: state.ai.model,
        instructions,
        messages: buildChatMessages(state.ai.chat.messages, {
          mode: "minimal",
          historyLimit: 6,
          maxChars: 25000,
        }),
      });
      responseText = `${responseText}\n\n(Context trimmed to fit model limits.)`;
    }
    state.ai.chat.messages.push({ role: "assistant", content: responseText });
  } catch (error) {
    const messageText = error?.message || "AI request failed.";
    state.ai.chat.messages.push({
      role: "assistant",
      content: `Error: ${messageText}`,
      isError: true,
    });
  } finally {
    state.ai.chat.isBusy = false;
    renderInspector();
  }
}

function isContextLengthError(error) {
  const message = String(error?.message || "");
  return (
    message.includes("context_length_exceeded") ||
    message.includes("context window")
  );
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
loadRecommendationRules();
renderApp();
