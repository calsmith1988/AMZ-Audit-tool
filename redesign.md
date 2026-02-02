
# Amazon Ads Audit Dashboard — UI Redesign Spec (Mission-Control Style)

## 0) Context + non-negotiables

### What we are redesigning

* All visual layout and UI components:

  * App shell
  * Navigation
  * Upload browser screen
  * Section pages (overview, campaigns, etc.)
  * Groups view (masonry cards)
  * Table view
  * Right inspector panel
  * AI insights panels/cards
  * Filters / search / chips
  * Empty states / loading states

### Design intent

Recreate a “quiet mission control” dashboard feel:

* light canvas, soft borders, muted typography
* cards and tables look “clean + premium”
* no loud gradients, no heavy shadows, no neon accents
* UI feels like a calm admin cockpit

### Success criteria

* User can browse an upload session → navigate audit sections → switch groups/table → click an entity → see inspector details + AI recommendations.
* UI must be scalable to large datasets (virtualization later; structure should support it).
* Right inspector must show “deep context” without forcing page changes.

---

## 1) Information architecture (IA) & routing model

### 1.1 Primary app states

1. **Uploads Library (Home)**

   * If no uploads: show “Add Upload” empty state card.
   * If uploads exist: show masonry grid of upload cards.
2. **Audit Session View**

   * When an upload is opened, user sees the three-pane dashboard:

     * left nav sections
     * main workspace content
     * right inspector (context panel)

### 1.2 Section navigation list (left sidebar)

* Overview
* Campaigns
* Ad Groups
* Match Types (collapsible)

  * Keywords
  * ASINs
  * ASINs Expanded
  * Auto
  * Categories
  * Related KWs
* Negative Keywords
* Search Terms
* Campaign Bidding Strategies
* Placements

### 1.3 Entity selection model (shared across all sections)

* Main workspace always shows a **list-like surface** (either:

  * Groups view = cards in masonry grid, or
  * Table view = data table)
* Clicking a card or table row sets a global `selectedEntity`
* Right inspector reads from `selectedEntity` and shows:

  * entity summary
  * related metrics
  * AI insights/recommendations
  * actions (export/filter/drill-down)

**Important:** do NOT navigate away for details. The inspector is the detail view.

---

## 2) App shell layout (exact grid + behavior)

### 2.1 Global shell structure

The app uses a persistent layout wrapper:

* **Top Bar** (fixed)
* **Body** (3-column):

  1. Left sidebar (sections)
  2. Main workspace (content)
  3. Right inspector (collapsible)

### 2.2 Exact dimensions

* Top bar height: `56px`
* Left sidebar width: `280px`
* Right inspector width: `400px` (range 360–420px)
* Main workspace: flexible width, min width recommended `640px`

### 2.3 Responsiveness rules

* Under `1100px` viewport:

  * Right inspector becomes a slide-over drawer (overlay from right)
  * Still triggered by selecting an entity
* Under `900px` viewport:

  * Left sidebar collapses to icon rail (`72px`) OR becomes slide-over drawer
  * The icon rail must still highlight active section

### 2.4 Scroll rules

* Top bar: fixed (no scroll)
* Left sidebar: independently scrollable if long
* Main workspace: scrolls normally
* Right inspector: independently scrollable

No nested scrolling inside cards. Cards are fixed height or content-wrapped.

---

## 3) Design tokens (CSS variables) — use these everywhere

Create `styles/tokens.css` and load globally.

```css
:root {
  /* Canvas */
  --bg: #fbfbfc;

  /* Surfaces */
  --surface: #ffffff;
  --surface-2: #f6f7f9;
  --surface-3: #f1f3f6;

  /* Lines */
  --border: rgba(15, 23, 42, 0.10);
  --border-strong: rgba(15, 23, 42, 0.16);

  /* Text */
  --text: rgba(15, 23, 42, 0.92);
  --text-muted: rgba(15, 23, 42, 0.62);
  --text-faint: rgba(15, 23, 42, 0.45);

  /* Accent (swap later) */
  --accent: #d97706;
  --accent-soft: rgba(217, 119, 6, 0.16);

  /* Status */
  --good: #16a34a;
  --warn: #d97706;
  --bad: #dc2626;
  --info: #2563eb;

  /* Elevation */
  --shadow-1: 0 1px 2px rgba(15,23,42,0.06);
  --shadow-2: 0 8px 24px rgba(15,23,42,0.08);

  /* Radius */
  --r-sm: 10px;
  --r-md: 14px;
  --r-lg: 18px;

  /* Spacing */
  --sp-1: 4px;
  --sp-2: 8px;
  --sp-3: 12px;
  --sp-4: 16px;
  --sp-5: 20px;
  --sp-6: 24px;

  /* Focus */
  --focus-ring: 0 0 0 3px rgba(59,130,246,0.25);

  /* Table */
  --row-hover: rgba(15, 23, 42, 0.04);
  --row-selected: rgba(217, 119, 6, 0.10);
}
```

### 3.1 Typography rules

* Base: `14px`
* Titles: `18px` weight 600
* Card titles: `14px` weight 600
* Labels/meta: `12px` weight 500
* Use muted colors for meta labels and secondary values

---

## 4) Component system (build these first)

This redesign should be implemented as reusable components so existing logic hooks can plug in.

### 4.1 `AppShell`

**Props**

* `topbar`
* `sidebar`
* `content`
* `inspector`

**Behavior**

* Responsible for 3-pane layout and responsive switch to drawers.

### 4.2 `TopBar`

**Required elements**

* Left: App title + current upload session selector
* Center: compact metric pills (optional but recommended)
* Right: actions (Upload +, Docs, Settings)

**Session selector behavior**

* Dropdown list of uploads (name + date)
* Selecting switches the active session and refreshes data

### 4.3 `SidebarNav`

**Required**

* Title: “Audit Sections”
* Items list + collapsible Match Types group
* Active item highlight rules:

  * left rail `3px` accent
  * background `--accent-soft`
* Optional count badges

### 4.4 `WorkspaceHeader`

Sits at top of main workspace content for every section.

**Left**

* Breadcrumb: `Uploads / {UploadName}`
* Section title: `{ActiveSection}`

**Right controls**

* Search input (filters within section)
* Filter chips (optional)
* View toggle:

  * Groups (default)
  * Table
* Sort dropdown (Spend desc default)

### 4.5 `Card` (base primitive)

All cards (upload cards, group cards, insight cards) derive from this primitive.

**Default style**

* Background: `--surface`
* Border: `1px solid --border`
* Radius: `--r-md`
* Padding: `16px`
* Shadow: none by default

**Hover**

* Border → `--border-strong`
* Shadow → `--shadow-1`
* Cursor pointer if clickable

**Selected**

* Border tinted (use accent)
* Soft background highlight: `--row-selected` OR `--accent-soft` (very subtle)

### 4.6 `MasonryGrid`

Used for:

* Upload library grid
* Groups view cards
* AI insight cards

**Rules**

* Use CSS columns OR a grid that simulates masonry.
* Spacing: `16px` gaps
* Card widths:

  * On desktop: 3–4 columns depending on available width
  * On smaller: 2 columns
  * On mobile: 1 column

### 4.7 `DataTable`

Used for table view in every section.

**Required**

* Sticky header
* Row hover highlight
* Row selected highlight
* Click row → sets selected entity → opens inspector
* Numeric columns right-aligned
* First column left aligned

**Style**

* Very clean: no heavy zebra striping
* Use thin separators only

### 4.8 `InspectorPanel` (right sidebar)

The inspector is the key “mission control” detail viewer.

**States**

* Collapsed (hidden)
* Empty (nothing selected)
* Populated (entity selected)

**Content structure**

1. Header:

   * entity name
   * entity type badge (Campaign / Keyword / Placement / etc.)
   * close/collapse button
2. Summary KPIs:

   * Spend, Sales, ACoS, ROAS, CVR, Orders
3. Tabs OR sections:

   * “Details” (raw fields + metadata)
   * “AI Insights” (recommendations + rationale)
   * “History” (later: compare across uploads)
4. Actions:

   * “Filter to this”
   * “Export CSV”
   * “Copy ID” (if relevant)

**Important:** inspector never shows huge tables. Keep it readable and vertically stacked.

---

## 5) Screen-by-screen UI structure

## 5.1 Uploads Library (home)

### 5.1.1 Empty state (no uploads)

Centered content area with:

* A single large “Add Upload” card
* plus icon
* short explanation: “Upload an Amazon Ads bulksheet to generate an audit session.”

Card specs:

* Width: `360–480px`
* Padding: `20–24px`
* Icon: 28–32px
* Primary button: “Upload bulksheet”

### 5.1.2 Uploads exist (masonry grid)

Display upload sessions as cards in a masonry grid.

**Upload Card layout**

* Top row: upload name (bold) + date (muted)
* Middle: small meta chips

  * Marketplace, Account, Optional file ID
* Bottom row: primary metrics preview (optional)

  * Spend / Sales / ACoS
* Click opens the audit session (3-pane view)

**Upload create flow**

* Clicking Upload + opens a modal:

  * file picker
  * name input
  * date input (default today)
  * optional notes
  * CTA: “Create session”
* On submit: triggers existing upload + parse pipeline

---

## 5.2 Audit Session — Overview section

Main workspace content order:

### Section Header Row (WorkspaceHeader)

* Title: “Overview”
* View toggle still exists but Overview defaults to “Cards” layout.

### Row 1: Ad Type Breakdown (SP/SB/SD)

Three equal cards horizontally:

* Sponsored Products
* Sponsored Brands
* Sponsored Display

Each card shows a tight KPI grid:

* Spend
* Sales
* ACoS
* ROAS

Card style:

* Compact
* No charts initially
* Optional icon top-left

### Row 2: AI Insights Masonry Grid

Masonry cards, each one is a single insight.

**Insight Card layout**

* Title: 1 line (bold)
* Summary: 2–4 lines max
* “Why” bullet (1 line)
* Severity chip: Good/Watch/Action
* KPI chips (2–4):

  * “High Spend Share”
  * “Low CVR”
  * “ACoS above target”
* Click sets inspector focus to that insight and/or the related entity.

---

## 5.3 All other sections (Campaigns, Ad Groups, etc.)

These pages follow a standard pattern:

### 1) WorkspaceHeader (always)

* Section title
* Search field (filters entities)
* Sort dropdown (Spend desc default)
* Toggle: Groups | Table

### 2) Content area shows:

#### Default: Groups view

Masonry grid of “Group Cards”

**Group Card required fields**

* Group name (campaign name, keyword text, placement label, etc.)
* Entity count (e.g., “12 keywords”)
* Metrics:

  * Spend share %
  * Sales share %
  * Spend
  * Sales
  * ACoS
  * ROAS
  * CVR
* Optional: trend chip (“CPC rising”, “CVR falling”)

Click card → selects entity → inspector opens with full breakdown + AI.

#### Optional: Table view

Clean table with the same metrics plus other columns relevant to section.

Row click → selects entity → inspector updates.

---

## 6) AI integration — how to show existing outputs (UI rules)

Because AI logic already exists, we must standardize how it renders.

### 6.1 AI Insight objects (display rules)

Assume you already have insight objects with fields like:

* `title`
* `summary`
* `severity`
* `recommendedAction`
* `reasoning`
* `relatedEntityIds`
* `metricsUsed`

**Render rules**

* Never show long paragraphs by default.
* Always show:

  * Title
  * Summary (2–4 lines)
  * Severity indicator
  * 2–4 metric chips (derived from insight)
* “Show more” expands inside inspector only, not inside the card.

### 6.2 AI placement

* Overview: AI insights grid is prominent.
* Other sections:

  * top row has optional “AI Highlights” strip (3–5 insight chips)
  * full list of insights appears either:

    * as a secondary masonry grid under the main group/table, OR
    * inside inspector when entity selected (preferred to reduce clutter)

**Preferred approach (cleanest):**

* The main workspace is “data first”
* AI insights appear in the inspector for the selected entity

---

## 7) Interaction model (exact behaviors)

### 7.1 Selection behavior

* Clicking a Group Card or Table Row sets `selectedEntity`
* Selected state must be visible:

  * Card border tinted
  * Table row has subtle selected background
* Inspector opens automatically when selection changes (unless pinned closed)

### 7.2 Inspector behavior

* Inspector has three modes:

  * **Collapsed**: hidden
  * **Open**: showing current selection
  * **Pinned**: stays open and does not auto-close
* When nothing selected:

  * show placeholder text: “Select a card or row to see details.”

### 7.3 View toggle behavior

* Groups and Table view are different presentations of the same underlying dataset
* Switching view preserves:

  * filters
  * search
  * sort
  * selection if possible (keep selected entity highlighted)

### 7.4 Filtering pattern

* Search filters by label/name (campaign name, keyword text, etc.)
* Filter chips show active filters (e.g. “ACoS > 30%”, “Spend share > 10%”)
* Clicking a filter chip removes it

---

## 8) Tables and metrics formatting

### 8.1 Number formatting

* Currency: `£12,345` (0 decimals unless < £100 → 2 decimals)
* Percent: `27.4%` (1 decimal)
* ROAS: `3.2x`
* CVR: `%` 1 decimal
* Spend share/sales share: 1 decimal

### 8.2 Alignment

* Metric labels left
* Values right where in tables
* In cards: 2-column KPI grid:

  * label (muted) above value (strong)

### 8.3 Status indicators (subtle)

* Severity uses:

  * small dot + label chip
  * never large banners

---

## 9) Loading, empty, and error states

### 9.1 Loading states

* Use skeleton cards for masonry grids
* Use skeleton rows for tables
* Show subtle “Processing upload…” status when parse pipeline runs

### 9.2 Empty states

* If a section has no data:

  * show a card-like empty state: “No entities found for this section”
  * show “Clear filters” button if filters active

### 9.3 Error states

* Minimal but clear:

  * small red text
  * “Retry” button
  * show error context in inspector if relevant

---

## 10) Implementation plan (Cursor tasks)

### Phase 1 — UI shell + primitives

1. Implement tokens.css and apply to app background + typography
2. Build AppShell layout with fixed TopBar and 3-pane body
3. Build Card primitive + Button + Chip components
4. Build SidebarNav with your exact audit list and active item states
5. Build InspectorPanel skeleton with collapsed/open states

### Phase 2 — Main workspace patterns

1. Build WorkspaceHeader (title, search, sort, toggle)
2. Build MasonryGrid component
3. Build DataTable component (sticky header, selection highlight)

### Phase 3 — Wire to existing logic

1. Plug existing data hooks into Groups view and Table view
2. Implement `selectedEntity` state (global or route-level)
3. Populate InspectorPanel from existing entity detail outputs
4. Render AI insights in inspector using existing AI result objects

### Phase 4 — Upload library

1. Create Uploads Library screen
2. Implement empty state + masonry upload cards
3. Wire Upload modal to existing upload/parse logic

---

## 11) Styling “do and don’t” list

**DO**

* Use thin borders
* Use muted text
* Use whitespace
* Keep chips soft and subtle
* Keep animations short and calm

**DON’T**

* No heavy shadows on everything
* No bright saturated colors for large surfaces
* No dense tables without spacing
* No multi-level nested cards inside cards (avoid clutter)

