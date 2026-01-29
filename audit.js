export const SHEET_DEFS = [
  {
    name: "Sponsored Products Campaigns",
    adType: "SP",
    kind: "campaign",
  },
  {
    name: "Sponsored Brands campaigns",
    adType: "SB",
    kind: "campaign",
  },
  {
    name: "SB Multi Ad Group Campaigns",
    adType: "SB",
    kind: "campaign",
  },
  {
    name: "Sponsored Display campaigns",
    adType: "SD",
    kind: "campaign",
  },
  {
    name: "SP Search Term Report",
    adType: "SP",
    kind: "searchTerm",
  },
  {
    name: "SB Search Term Report",
    adType: "SB",
    kind: "searchTerm",
  },
];

export const DEFAULT_MAPPING = {
  entity: ["Entity"],
  state: ["State"],
  adFormat: ["Ad format", "Ad format (Informational only)"],
  campaignStateInfo: ["Campaign state (Informational only)"],
  adGroupStateInfo: [
    "Ad Group State (Informational only)",
    "Ad group state (Informational only)",
  ],
  adGroupServingStatusInfo: ["Ad group serving status (Informational only)"],
  placement: ["Placement"],
  biddingStrategy: ["Bidding strategy"],
  campaignName: ["Campaign name (Informational only)", "Campaign name"],
  adGroupName: ["Ad group name", "Ad group name (Informational only)"],
  campaignId: ["Campaign ID"],
  adGroupId: ["Ad group ID"],
  keywordText: ["Keyword text", "Native language keyword"],
  matchType: ["Match type"],
  customerSearchTerm: ["Customer search term"],
  productTargetingExpression: [
    "Product targeting expression",
    "Targeting expression",
    "Resolved product targeting expression (Informational only)",
    "Resolved targeting expression (Informational only)",
  ],
  impressions: ["Impressions", "Viewable impressions"],
  clicks: ["Clicks"],
  spend: ["Spend"],
  sales: ["Sales", "Sales (Views & Clicks)"],
  orders: ["Orders", "Orders (Views & Clicks)"],
  units: ["Units", "Units (Views & Clicks)"],
};

export const FIELD_DEFS = [
  { key: "entity", label: "Entity" },
  { key: "state", label: "State" },
  { key: "adFormat", label: "Ad format" },
  { key: "campaignStateInfo", label: "Campaign state (Informational only)" },
  { key: "adGroupStateInfo", label: "Ad Group State (Informational only)" },
  { key: "adGroupServingStatusInfo", label: "Ad group serving status (Informational only)" },
  { key: "placement", label: "Placement" },
  { key: "biddingStrategy", label: "Bidding strategy" },
  { key: "campaignName", label: "Campaign name" },
  { key: "adGroupName", label: "Ad group name" },
  { key: "campaignId", label: "Campaign ID" },
  { key: "adGroupId", label: "Ad group ID" },
  { key: "keywordText", label: "Keyword text" },
  { key: "matchType", label: "Match type" },
  { key: "customerSearchTerm", label: "Customer search term" },
  { key: "productTargetingExpression", label: "Product targeting expression" },
  { key: "impressions", label: "Impressions" },
  { key: "clicks", label: "Clicks" },
  { key: "spend", label: "Spend" },
  { key: "sales", label: "Sales" },
  { key: "orders", label: "Orders" },
  { key: "units", label: "Units" },
];

export const DEFAULT_BUCKETS = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];

export function getEffectiveSheetDefs(sheetData, sheetDefs) {
  const hasSbMulti = Boolean(sheetData["SB Multi Ad Group Campaigns"]);
  return sheetDefs.filter((def) => {
    if (def.name === "Sponsored Brands campaigns" && hasSbMulti) {
      return false;
    }
    return true;
  });
}

export function buildAutoMapping(columns) {
  const normalizedColumns = columns.map((column) => ({
    original: column,
    normalized: normalizeKey(column),
  }));
  const mapping = {};
  FIELD_DEFS.forEach((field) => {
    const candidates = DEFAULT_MAPPING[field.key] || [];
    let match = "";
    for (const candidate of candidates) {
      const normalizedCandidate = normalizeKey(candidate);
      const found = normalizedColumns.find(
        (entry) => entry.normalized === normalizedCandidate
      );
      if (found) {
        match = found.original;
        break;
      }
    }
    if (!match && candidates.length) {
      const candidateKeys = candidates.map((item) => normalizeKey(item));
      const fuzzy = normalizedColumns.find((entry) =>
        candidateKeys.some((candidate) => entry.normalized.includes(candidate))
      );
      if (fuzzy) {
        match = fuzzy.original;
      }
    }
    mapping[field.key] = match;
  });
  return mapping;
}

export function buildAuditResults(datasets, options = {}) {
  const results = {
    engineVersion: "1.0.0",
    generatedAt: new Date().toISOString(),
    adTypes: {},
  };
  const brandAliases = (options.brandAliases || [])
    .map((alias) => normalizeValue(alias))
    .filter(Boolean);

  const keywordTargets = new Set();
  const asinTargets = new Set();

  datasets.forEach(({ rows }) => {
    rows.forEach((row) => {
      if (row.keywordText) {
        keywordTargets.add(normalizeValue(row.keywordText));
      }
      const asins = extractAsins(row.productTargetingExpression);
      asins.forEach((asin) => asinTargets.add(asin));
    });
  });

  const datasetsByType = groupBy(datasets, (item) => item.def.adType);
  const allCampaignRows = datasets
    .filter((set) => set.def.kind === "campaign")
    .flatMap((set) => set.rows);
  const accountTotals = computeSummary(allCampaignRows);

  Object.entries(datasetsByType).forEach(([adType, typedSets]) => {
    const campaignRows = typedSets
      .filter((set) => set.def.kind === "campaign")
      .flatMap((set) => set.rows);
    const searchRows = typedSets
      .filter((set) => set.def.kind === "searchTerm")
      .flatMap((set) => set.rows);

    const pausedBucket = buildPausedBucketFromRows(
      campaignRows,
      adType,
      accountTotals
    );
    const enabledRows = filterPausedRows(campaignRows, pausedBucket.index, adType);
    const totals = computeSummary(campaignRows);
    const enabledSummary = computeSummary(enabledRows);
    const summary = {
      ...enabledSummary,
      spendSharePct: accountTotals.spend
        ? enabledSummary.spend / accountTotals.spend
        : null,
      salesSharePct: accountTotals.sales
        ? enabledSummary.sales / accountTotals.sales
        : null,
    };
    const campaignBuckets = bucketByEntityWithDetails(
      enabledRows,
      (row) => row.campaignKey,
      (row) => row.campaignName || row.campaignId || row.campaignKey || "Unmapped",
      accountTotals
    );
    const keywordBuckets = bucketByEntityWithDetails(
      enabledRows.filter((row) => row.keywordText),
      (row) => normalizeValue(row.keywordText),
      (row) => row.keywordText || "Unmapped",
      accountTotals
    );
    const asinBuckets = bucketByEntityWithDetails(
      enabledRows.filter((row) => row.asinTarget),
      (row) => row.asinTarget,
      (row) => row.asinTarget || "Unmapped",
      accountTotals
    );
    const matchTypeBuckets = bucketByMatchType(enabledRows, adType, accountTotals);
    const placementBuckets = bucketByPlacement(
      enabledRows,
      adType,
      accountTotals
    );
    const biddingStrategyBuckets =
      adType === "SP" ? bucketByBiddingStrategy(enabledRows, accountTotals) : [];
    const pausedBuckets = pausedBucket;

    const searchTermInsights = buildSearchTermInsights(
      searchRows,
      keywordTargets,
      asinTargets
    );
    const brandedBucket =
      adType === "SP" || adType === "SB"
        ? buildBrandedBucket(searchRows, brandAliases)
        : null;
    const matchTypeMixFlag =
      adType === "SP" || adType === "SB"
        ? detectMatchTypeMix(enabledRows)
        : null;
    const sbVideoPresence =
      adType === "SB" ? detectSbVideoPresence(campaignRows) : null;

    results.adTypes[adType] = {
      summary,
      campaignBuckets,
      keywordBuckets,
      asinBuckets,
      matchTypeBuckets,
      placementBuckets,
      biddingStrategyBuckets,
      pausedBuckets,
      brandedBucket,
      matchTypeMixFlag,
      sbVideoPresence,
      searchTermInsights,
    };
  });

  return results;
}

export function normalizeRow(row, mapping, adType, kind) {
  const entity = cleanText(row[mapping.entity]);
  const entityNormalized = normalizeValue(entity);
  const state = cleanText(row[mapping.state]);
  const adFormat = cleanText(row[mapping.adFormat]);
  const campaignStateInfo = cleanText(row[mapping.campaignStateInfo]);
  const adGroupStateInfo = cleanText(row[mapping.adGroupStateInfo]);
  const adGroupServingStatusInfo = cleanText(
    row[mapping.adGroupServingStatusInfo]
  );
  const placement = cleanText(row[mapping.placement]);
  const biddingStrategy = cleanText(row[mapping.biddingStrategy]);
  const spend = parseNumber(row[mapping.spend]);
  const sales = parseNumber(row[mapping.sales]);
  const clicks = parseNumber(row[mapping.clicks]);
  const orders = parseNumber(row[mapping.orders]);
  const impressions = parseNumber(row[mapping.impressions]);
  const units = parseNumber(row[mapping.units]);
  const keywordText = cleanText(row[mapping.keywordText]);
  const matchInfo = normalizeMatchType(
    cleanText(row[mapping.matchType]),
    row[mapping.productTargetingExpression],
    entityNormalized
  );
  const matchType =
    typeof matchInfo === "string" ? matchInfo : matchInfo.label;
  const autoSubType =
    typeof matchInfo === "string" ? "" : matchInfo.autoSubType;
  const productTargetingExpression = cleanText(
    row[mapping.productTargetingExpression]
  );
  const customerSearchTerm = cleanText(row[mapping.customerSearchTerm]);
  const campaignName = cleanText(row[mapping.campaignName]);
  const campaignId = cleanText(row[mapping.campaignId]);
  const adGroupName = cleanText(row[mapping.adGroupName]);
  const adGroupId = cleanText(row[mapping.adGroupId]);
  const campaignKey = campaignId || campaignName || "";
  const asinTarget = extractAsinTarget(productTargetingExpression);

  const acos = sales ? spend / sales : null;
  const cpc = clicks ? spend / clicks : null;
  const cvr = clicks ? orders / clicks : null;
  const roas = spend ? sales / spend : null;

  return {
    adType,
    kind,
    entity,
    entityNormalized,
    state,
    adFormat,
    campaignStateInfo,
    adGroupStateInfo,
    adGroupServingStatusInfo,
    placement,
    biddingStrategy,
    campaignId,
    adGroupId,
    adGroupName,
    campaignKey,
    campaignName,
    keywordText,
    matchType,
    autoSubType,
    productTargetingExpression,
    customerSearchTerm,
    asinTarget,
    spend,
    sales,
    clicks,
    orders,
    units,
    impressions,
    acos,
    cpc,
    cvr,
    roas,
  };
}

export function computeSummary(rows) {
  const totals = rows.reduce(
    (acc, row) => {
      acc.spend += row.spend;
      acc.sales += row.sales;
      acc.clicks += row.clicks;
      acc.orders += row.orders;
      acc.impressions += row.impressions;
      return acc;
    },
    { spend: 0, sales: 0, clicks: 0, orders: 0, impressions: 0 }
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

function buildPausedIndex(rows, adType) {
  const pausedCampaigns = new Set();
  const pausedAdGroups = new Set();
  const pausedTargets = new Set();

  rows.forEach((row) => {
    const entity = row.entityNormalized || normalizeValue(row.entity);
    if (adType === "SP" || adType === "SB") {
      if (entity === "campaign" && isPaused(row.campaignStateInfo)) {
        pausedCampaigns.add(buildCampaignKey(row));
      }
      if (entity === "ad group") {
        if (adType === "SB" && isAdGroupPausedSb(row.adGroupServingStatusInfo)) {
          pausedAdGroups.add(buildAdGroupKey(row));
        } else if (adType === "SP" && isPaused(row.adGroupStateInfo)) {
          pausedAdGroups.add(buildAdGroupKey(row));
        }
      }
      if (isTargetEntity(adType, entity) && isPaused(row.state)) {
        pausedTargets.add(buildTargetKey(row));
      }
    }
    if (adType === "SD") {
      if (entity === "campaign" && isPaused(row.campaignStateInfo)) {
        pausedCampaigns.add(buildCampaignKey(row));
      }
      if (entity === "ad group" && isPaused(row.adGroupStateInfo)) {
        pausedAdGroups.add(buildAdGroupKey(row));
      }
      if (isTargetEntity(adType, entity) && isPaused(row.state)) {
        pausedTargets.add(buildTargetKey(row));
      }
    }
  });

  return {
    pausedCampaigns,
    pausedAdGroups,
    pausedTargets,
  };
}

function filterPausedRows(rows, pausedIndex, adType) {
  return rows.filter((row) => {
    const entity = row.entityNormalized || normalizeValue(row.entity);
    const campaignKey = buildCampaignKey(row);
    const adGroupKey = buildAdGroupKey(row);
    const targetKey = buildTargetKey(row);

    if (pausedIndex.pausedCampaigns.has(campaignKey)) {
      return false;
    }
    if (pausedIndex.pausedAdGroups.has(adGroupKey)) {
      return false;
    }
    if (isTargetEntity(adType, entity) && pausedIndex.pausedTargets.has(targetKey)) {
      return false;
    }
    return true;
  });
}

function buildCampaignKey(row) {
  return row.campaignId || row.campaignName || row.campaignKey || "";
}

function buildAdGroupKey(row) {
  const campaignKey = buildCampaignKey(row);
  const adGroupKey = row.adGroupId || row.adGroupName || "";
  return `${campaignKey}::${adGroupKey}`;
}

function buildTargetKey(row) {
  const adGroupKey = buildAdGroupKey(row);
  const targetKey = row.keywordText || row.productTargetingExpression || "";
  return `${adGroupKey}::${targetKey}`;
}

function isPaused(value) {
  return normalizeValue(value).includes("paused");
}

function isAdGroupPausedSb(value) {
  const normalized = normalizeValue(value);
  return normalized.includes("paused");
}

function isTargetEntity(adType, entityNormalized) {
  if (adType === "SD") {
    return ["contextual targeting", "audience targeting"].includes(
      entityNormalized
    );
  }
  return ["keyword", "product targeting"].includes(entityNormalized);
}

function buildPausedBucketSummary(rows, predicate, keyFn) {
  const filtered = rows.filter(predicate);
  const summary = computeSummary(filtered);
  const count = new Set(filtered.map(keyFn)).size;
  return { count, summary };
}

function buildPausedBucketFromRows(rows, adType, shareTotals) {
  const pausedIndex = buildPausedIndex(rows, adType);
  const campaigns = buildPausedBucketSummary(
    rows,
    (row) =>
      normalizeValue(row.entity) === "campaign" &&
      isPaused(row.campaignStateInfo),
    (row) => buildCampaignKey(row)
  );
  const adGroups = buildPausedBucketSummary(
    rows,
    (row) => {
      const entity = normalizeValue(row.entity);
      if (entity !== "ad group") {
        return false;
      }
      if (adType === "SB") {
        return isAdGroupPausedSb(row.adGroupServingStatusInfo);
      }
      return isPaused(row.adGroupStateInfo);
    },
    (row) => buildAdGroupKey(row)
  );
  const targets = buildPausedBucketSummary(
    rows,
    (row) =>
      isTargetEntity(adType, normalizeValue(row.entity)) && isPaused(row.state),
    (row) => buildTargetKey(row)
  );
  const details = buildPausedDetails(rows, adType, shareTotals);
  return {
    campaigns,
    adGroups,
    targets,
    details,
    index: pausedIndex,
  };
}

function bucketByPlacement(rows, adType, shareTotals) {
  let placementEntity = "";
  if (adType === "SP") {
    placementEntity = "bidding adjustment";
  }
  if (adType === "SB") {
    placementEntity = "bidding adjustment by placement";
  }
  if (!placementEntity) {
    return [];
  }
  const filtered = rows.filter(
    (row) => normalizeValue(row.entity) === placementEntity
  );
  const grouped = groupBy(filtered, (row) => row.placement || "Unmapped");
  return buildShareRowsWithDetails(grouped, (items) =>
    buildCampaignDetails(items, shareTotals)
  );
}

function bucketByBiddingStrategy(rows, shareTotals) {
  const filtered = rows.filter(
    (row) => normalizeValue(row.entity) === "bidding adjustment"
  );
  const grouped = groupBy(
    filtered,
    (row) => row.biddingStrategy || "Unmapped"
  );
  return buildShareRowsWithDetails(grouped, (items) =>
    buildCampaignDetails(items, shareTotals)
  );
}

function buildShareRows(grouped) {
  const entries = Object.entries(grouped).map(([label, items]) => ({
    label,
    summary: computeSummary(items),
  }));
  const totalSpend = entries.reduce((sum, item) => sum + item.summary.spend, 0);
  const totalSales = entries.reduce((sum, item) => sum + item.summary.sales, 0);
  return entries.map((entry) => ({
    label: entry.label,
    spend: entry.summary.spend,
    sales: entry.summary.sales,
    spendPct: totalSpend ? entry.summary.spend / totalSpend : null,
    salesPct: totalSales ? entry.summary.sales / totalSales : null,
    avgCpc: entry.summary.cpc,
    acos: entry.summary.acos,
    roas: entry.summary.roas,
  }));
}

function buildShareRowsWithDetails(grouped, detailBuilder, shareTotals) {
  const entries = Object.entries(grouped).map(([label, items]) => ({
    label,
    summary: computeSummary(items),
    details: detailBuilder ? detailBuilder(items, shareTotals) : [],
  }));
  const totalSpend = entries.reduce((sum, item) => sum + item.summary.spend, 0);
  const totalSales = entries.reduce((sum, item) => sum + item.summary.sales, 0);
  return entries.map((entry) => ({
    label: entry.label,
    spend: entry.summary.spend,
    sales: entry.summary.sales,
    spendPct: totalSpend ? entry.summary.spend / totalSpend : null,
    salesPct: totalSales ? entry.summary.sales / totalSales : null,
    avgCpc: entry.summary.cpc,
    acos: entry.summary.acos,
    roas: entry.summary.roas,
    details: entry.details,
  }));
}

export function bucketByEntity(rows, keyFn) {
  const entities = groupBy(rows, keyFn);
  const entityTotals = Object.values(entities).map((entityRows) =>
    computeSummary(entityRows)
  );
  return bucketTotals(entityTotals);
}

export function bucketTotals(entityTotals) {
  const totals = entityTotals.reduce(
    (acc, entity) => {
      let bucket = "";
      if (entity.sales === 0 && entity.spend > 0) {
        bucket = "No Sales";
      } else if (entity.acos || entity.acos === 0) {
        bucket = bucketLabel(entity.acos);
      } else {
        return acc;
      }
      acc[bucket] = acc[bucket] || { spend: 0, sales: 0, clicks: 0 };
      acc[bucket].spend += entity.spend;
      acc[bucket].sales += entity.sales;
      acc[bucket].clicks += entity.clicks;
      return acc;
    },
    {}
  );

  const totalSpend = entityTotals.reduce((sum, item) => sum + item.spend, 0);
  const totalSales = entityTotals.reduce((sum, item) => sum + item.sales, 0);

  return Object.entries(totals)
    .map(([bucket, values]) => ({
      bucket,
      spend: values.spend,
      sales: values.sales,
      spendPct: totalSpend ? values.spend / totalSpend : null,
      salesPct: totalSales ? values.sales / totalSales : null,
      avgCpc: values.clicks ? values.spend / values.clicks : null,
    }))
    .sort((a, b) => bucketSort(a.bucket) - bucketSort(b.bucket));
}

function bucketByEntityWithDetails(rows, keyFn, labelFn, shareTotals) {
  const entities = buildEntitySummaries(rows, keyFn, labelFn);
  return buildBucketRowsWithDetails(entities, shareTotals);
}

function buildEntitySummaries(rows, keyFn, labelFn) {
  const grouped = groupBy(rows, keyFn);
  return Object.entries(grouped).map(([key, items]) => ({
    key,
    label: labelFn ? labelFn(items[0], key, items) : key,
    summary: computeSummary(items),
  }));
}

function bucketLabelForSummary(summary) {
  if (summary.sales === 0 && summary.spend > 0) {
    return "No Sales";
  }
  if (summary.acos || summary.acos === 0) {
    return bucketLabel(summary.acos);
  }
  return "";
}

function buildBucketRowsWithDetails(entities, shareTotals) {
  const totalsByBucket = {};
  entities.forEach((entity) => {
    const bucket = bucketLabelForSummary(entity.summary);
    if (!bucket) {
      return;
    }
    totalsByBucket[bucket] = totalsByBucket[bucket] || {
      spend: 0,
      sales: 0,
      clicks: 0,
      items: [],
    };
    totalsByBucket[bucket].spend += entity.summary.spend;
    totalsByBucket[bucket].sales += entity.summary.sales;
    totalsByBucket[bucket].clicks += entity.summary.clicks || 0;
    totalsByBucket[bucket].items.push(entity);
  });

  const totalSpend = entities.reduce((sum, item) => sum + item.summary.spend, 0);
  const totalSales = entities.reduce((sum, item) => sum + item.summary.sales, 0);
  const shareSpendTotal = shareTotals?.spend ?? totalSpend;
  const shareSalesTotal = shareTotals?.sales ?? totalSales;

  return Object.entries(totalsByBucket)
    .map(([bucket, values]) => ({
      bucket,
      spend: values.spend,
      sales: values.sales,
      spendPct: totalSpend ? values.spend / totalSpend : null,
      salesPct: totalSales ? values.sales / totalSales : null,
      avgCpc: values.clicks ? values.spend / values.clicks : null,
      details: buildDetailRowsFromEntities(
        values.items,
        shareSpendTotal,
        shareSalesTotal
      ),
    }))
    .sort((a, b) => bucketSort(a.bucket) - bucketSort(b.bucket));
}

function buildDetailRowsFromEntities(entities, shareSpendTotal, shareSalesTotal) {
  return entities
    .map((entity) => ({
      label: entity.label,
      spend: entity.summary.spend,
      sales: entity.summary.sales,
      acos: entity.summary.acos,
      roas: entity.summary.roas,
      spendSharePct: shareSpendTotal
        ? entity.summary.spend / shareSpendTotal
        : null,
      salesSharePct: shareSalesTotal
        ? entity.summary.sales / shareSalesTotal
        : null,
    }))
    .sort((a, b) => (b.spend || 0) - (a.spend || 0));
}

function buildCampaignDetails(rows, shareTotals) {
  const entities = buildEntitySummaries(
    rows,
    (row) => buildCampaignKey(row),
    (_row, key, items) => pickCampaignLabel(items, key)
  );
  const shareSpendTotal = shareTotals?.spend;
  const shareSalesTotal = shareTotals?.sales;
  const fallbackSpend = entities.reduce(
    (sum, item) => sum + item.summary.spend,
    0
  );
  const fallbackSales = entities.reduce(
    (sum, item) => sum + item.summary.sales,
    0
  );
  return buildDetailRowsFromEntities(
    entities,
    shareSpendTotal ?? fallbackSpend,
    shareSalesTotal ?? fallbackSales
  );
}

function buildTargetLabel(row) {
  if (row.keywordText) {
    return row.keywordText;
  }
  if (row.asinTarget) {
    return row.asinTarget;
  }
  if (row.productTargetingExpression) {
    return row.productTargetingExpression;
  }
  if (row.customerSearchTerm) {
    return row.customerSearchTerm;
  }
  return row.entity || "Unmapped";
}

function pickCampaignLabel(items, fallbackKey) {
  const named = items.find((item) => item.campaignName);
  if (named?.campaignName) {
    return named.campaignName;
  }
  const withId = items.find((item) => item.campaignId);
  if (withId?.campaignId) {
    return withId.campaignId;
  }
  return fallbackKey || "Unmapped";
}

function extractAsinTarget(expression) {
  if (!expression) {
    return "";
  }
  const normalized = String(expression).toLowerCase();
  if (!normalized.includes("asin")) {
    return "";
  }
  const asins = extractAsins(expression);
  return asins[0] || "";
}

function buildTargetDetails(rows, shareTotals) {
  const entities = buildEntitySummaries(
    rows,
    (row) => buildTargetLabel(row),
    (row) => buildTargetLabel(row)
  );
  const shareSpendTotal = shareTotals?.spend;
  const shareSalesTotal = shareTotals?.sales;
  const fallbackSpend = entities.reduce(
    (sum, item) => sum + item.summary.spend,
    0
  );
  const fallbackSales = entities.reduce(
    (sum, item) => sum + item.summary.sales,
    0
  );
  return buildDetailRowsFromEntities(
    entities,
    shareSpendTotal ?? fallbackSpend,
    shareSalesTotal ?? fallbackSales
  );
}

function buildPausedDetails(rows, adType, shareTotals) {
  const campaignRows = rows.filter(
    (row) =>
      normalizeValue(row.entity) === "campaign" &&
      isPaused(row.campaignStateInfo)
  );
  const adGroupRows = rows.filter((row) => {
    const entity = normalizeValue(row.entity);
    if (entity !== "ad group") {
      return false;
    }
    if (adType === "SB") {
      return isAdGroupPausedSb(row.adGroupServingStatusInfo);
    }
    return isPaused(row.adGroupStateInfo);
  });
  const targetRows = rows.filter(
    (row) =>
      isTargetEntity(adType, normalizeValue(row.entity)) && isPaused(row.state)
  );

  const campaignEntities = buildEntitySummaries(
    campaignRows,
    (row) => buildCampaignKey(row),
    (row) => row.campaignName || row.campaignId || row.campaignKey || "Unmapped"
  );
  const adGroupEntities = buildEntitySummaries(
    adGroupRows,
    (row) => buildAdGroupKey(row),
    (row) => row.adGroupName || row.adGroupId || "Unmapped"
  );
  const targetEntities = buildEntitySummaries(
    targetRows,
    (row) => buildTargetLabel(row),
    (row) => buildTargetLabel(row)
  );

  const shareSpendTotal = shareTotals?.spend;
  const shareSalesTotal = shareTotals?.sales;
  const campaignSpend = campaignEntities.reduce(
    (sum, item) => sum + item.summary.spend,
    0
  );
  const campaignSales = campaignEntities.reduce(
    (sum, item) => sum + item.summary.sales,
    0
  );
  const adGroupSpend = adGroupEntities.reduce(
    (sum, item) => sum + item.summary.spend,
    0
  );
  const adGroupSales = adGroupEntities.reduce(
    (sum, item) => sum + item.summary.sales,
    0
  );
  const targetSpend = targetEntities.reduce(
    (sum, item) => sum + item.summary.spend,
    0
  );
  const targetSales = targetEntities.reduce(
    (sum, item) => sum + item.summary.sales,
    0
  );

  return {
    campaigns: buildDetailRowsFromEntities(
      campaignEntities,
      shareSpendTotal ?? campaignSpend,
      shareSalesTotal ?? campaignSales
    ),
    adGroups: buildDetailRowsFromEntities(
      adGroupEntities,
      shareSpendTotal ?? adGroupSpend,
      shareSalesTotal ?? adGroupSales
    ),
    targets: buildDetailRowsFromEntities(
      targetEntities,
      shareSpendTotal ?? targetSpend,
      shareSalesTotal ?? targetSales
    ),
  };
}

export function bucketByMatchType(rows, adType, shareTotals) {
  if (adType === "SD") {
    const filtered = rows.filter((row) =>
      ["contextual targeting", "audience targeting"].includes(
        row.entityNormalized || normalizeValue(row.entity)
      )
    );
    const grouped = groupBy(filtered, (row) => {
      const normalized = row.entityNormalized || normalizeValue(row.entity);
      return normalized === "contextual targeting"
        ? "Contextual targeting"
        : "Audience targeting";
    });
    return buildMatchTypeRows(grouped, shareTotals);
  }

  const grouped = groupBy(
    rows.filter((row) => {
      const normalized = row.entityNormalized || normalizeValue(row.entity);
      if (!["keyword", "product targeting"].includes(normalized)) {
        return false;
      }
      const matchType = String(row.matchType || "").toLowerCase();
      if (!matchType) {
        return normalized === "product targeting";
      }
      return !matchType.startsWith("negative");
    }),
    (row) => row.matchType || "Unmapped"
  );
  return buildMatchTypeRows(grouped, shareTotals);
}

function buildMatchTypeRows(grouped, shareTotals) {
  const entries = Object.entries(grouped).map(([matchType, items]) => {
    const summary = computeSummary(items);
    const autoBreakdown =
      matchType === "Auto" ? buildAutoBreakdown(items) : [];
    const targetCount = new Set(items.map((item) => buildTargetKey(item))).size;
    const details = buildTargetDetails(items, shareTotals);
    return {
      matchType,
      summary,
      autoBreakdown,
      targetCount,
      details,
    };
  });
  const totalSpend = entries.reduce((sum, item) => sum + item.summary.spend, 0);
  const totalSales = entries.reduce((sum, item) => sum + item.summary.sales, 0);
  return entries.map((entry) => ({
    matchType: entry.matchType,
    targetCount: entry.targetCount,
    spend: entry.summary.spend,
    sales: entry.summary.sales,
    spendPct: totalSpend ? entry.summary.spend / totalSpend : null,
    salesPct: totalSales ? entry.summary.sales / totalSales : null,
    avgCpc: entry.summary.cpc,
    acos: entry.summary.acos,
    roas: entry.summary.roas,
    autoBreakdown: entry.autoBreakdown,
    details: entry.details,
  }));
}

function buildBrandedBucket(searchRows, brandAliases) {
  if (!brandAliases.length) {
    return {
      summary: computeSummary([]),
      spendSharePct: null,
      salesSharePct: null,
      count: 0,
    };
  }
  const totalSummary = computeSummary(searchRows);
  const brandedRows = searchRows.filter((row) =>
    isBrandedTerm(row.customerSearchTerm, brandAliases)
  );
  const summary = computeSummary(brandedRows);
  const spendSharePct = totalSummary.spend
    ? summary.spend / totalSummary.spend
    : null;
  const salesSharePct = totalSummary.sales
    ? summary.sales / totalSummary.sales
    : null;
  const count = new Set(
    brandedRows.map((row) => normalizeValue(row.customerSearchTerm))
  ).size;
  return { summary, spendSharePct, salesSharePct, count };
}

function isBrandedTerm(term, brandAliases) {
  const normalizedTerm = normalizeValue(term);
  return brandAliases.some((alias) => normalizedTerm.includes(alias));
}

function detectMatchTypeMix(rows) {
  const campaignMap = new Map();
  rows.forEach((row) => {
    const entity = row.entityNormalized || normalizeValue(row.entity);
    if (!["keyword", "product targeting"].includes(entity)) {
      return;
    }
    const campaignKey = buildCampaignKey(row);
    const matchType = row.matchType || "Unmapped";
    if (!campaignMap.has(campaignKey)) {
      campaignMap.set(campaignKey, new Set());
    }
    campaignMap.get(campaignKey).add(matchType);
  });

  const mixedCampaigns = [];
  campaignMap.forEach((types, campaignKey) => {
    if (types.size > 1) {
      mixedCampaigns.push({
        campaignKey,
        matchTypes: Array.from(types),
      });
    }
  });

  return {
    count: mixedCampaigns.length,
    campaigns: mixedCampaigns,
  };
}

function detectSbVideoPresence(rows) {
  const adFormatCount = rows.filter(
    (row) => normalizeValue(row.adFormat) === "video"
  ).length;
  const videoAdEntityCount = rows.filter(
    (row) => normalizeValue(row.entity) === "video ad"
  ).length;
  return {
    hasVideo: adFormatCount > 0 || videoAdEntityCount > 0,
    adFormatCount,
    videoAdEntityCount,
  };
}

export function buildSearchTermInsights(rows, keywordTargets, asinTargets) {
  const byTerm = groupBy(
    rows.filter((row) => row.customerSearchTerm),
    (row) => normalizeValue(row.customerSearchTerm)
  );

  const items = Object.entries(byTerm).map(([termKey, termRows]) => {
    const summary = computeSummary(termRows);
    const sample = termRows[0]?.customerSearchTerm || termKey;
    const normalizedTerm = normalizeValue(sample);
    const isAsin = isAsinValue(sample);
    const isTargeted = isAsin
      ? asinTargets.has(normalizedTerm)
      : keywordTargets.has(normalizedTerm);
    return {
      term: sample,
      isAsin,
      isTargeted,
      ...summary,
    };
  });

  const unique = items.filter(
    (item) => !item.isTargeted && item.sales > 0
  );
  const uniqueKeywords = unique.filter((item) => !item.isAsin);
  const uniqueAsins = unique.filter((item) => item.isAsin);

  return {
    uniqueKeywords: uniqueKeywords.sort((a, b) => b.spend - a.spend),
    uniqueAsins: uniqueAsins.sort((a, b) => b.spend - a.spend),
  };
}

export function normalizeMatchType(matchType, targetingExpression, entityNormalized) {
  if (matchType) {
    const lowered = matchType.toLowerCase();
    if (lowered.includes("exact")) return "Exact";
    if (lowered.includes("phrase")) return "Phrase";
    if (lowered.includes("broad")) return "Broad";
    if (lowered.includes("modified")) return "Modified Broad";
    return matchType;
  }
  if (entityNormalized === "product targeting") {
    return classifyTargetingExpression(targetingExpression);
  }
  if (!targetingExpression) {
    return "Unmapped";
  }
  const normalized = targetingExpression.toLowerCase();
  if (normalized.includes("asin-expanded") || normalized.includes("expanded")) {
    return "ASINs Expanded";
  }
  if (normalized.includes("asin")) {
    return "ASINs";
  }
  return "Targeting";
}

function classifyTargetingExpression(expression) {
  if (!expression) {
    return { label: "Unmapped", autoSubType: "" };
  }
  const normalized = String(expression)
    .toLowerCase()
    .replace(/_/g, "-")
    .replace(/\s+/g, "-");
  if (normalized.includes("asin-expanded")) {
    return { label: "ASINs Expanded", autoSubType: "" };
  }
  if (normalized.includes("asin=")) {
    return { label: "ASINs", autoSubType: "" };
  }
  if (normalized.includes("category=")) {
    return { label: "Category", autoSubType: "" };
  }
  if (normalized.includes("keyword-group=")) {
    return { label: "Related Keywords", autoSubType: "" };
  }
  const autoSubTypes = [
    { key: "close-match", label: "Close Match" },
    { key: "loose-match", label: "Loose Match" },
    { key: "substitutes", label: "Substitutes" },
    { key: "complements", label: "Complements" },
  ];
  const autoMatch = autoSubTypes.find((item) =>
    normalized.includes(item.key)
  );
  if (autoMatch) {
    return { label: "Auto", autoSubType: autoMatch.label };
  }
  return { label: "Product Targeting", autoSubType: "" };
}

function buildAutoBreakdown(rows) {
  const grouped = groupBy(
    rows.filter((row) => row.autoSubType),
    (row) => row.autoSubType
  );
  return Object.entries(grouped).map(([label, items]) => ({
    label,
    summary: computeSummary(items),
  }));
}

export function extractAsins(expression) {
  if (!expression) {
    return [];
  }
  const matches = expression.match(/[A-Z0-9]{10}/gi);
  if (!matches) {
    return [];
  }
  return matches.map((match) => match.toUpperCase());
}

export function isAsinValue(value) {
  return /^[A-Z0-9]{10}$/i.test(value.trim());
}

export function bucketLabel(acos) {
  const percent = acos * 100;
  for (let i = 0; i < DEFAULT_BUCKETS.length; i += 1) {
    const min = DEFAULT_BUCKETS[i];
    const max = DEFAULT_BUCKETS[i + 1];
    if (max === undefined) {
      break;
    }
    if (percent >= min && percent < max) {
      return `${min}-${max}%`;
    }
  }
  if (percent >= DEFAULT_BUCKETS[DEFAULT_BUCKETS.length - 1]) {
    return `${DEFAULT_BUCKETS[DEFAULT_BUCKETS.length - 1]}%+`;
  }
  return "Unbucketed";
}

export function bucketSort(label) {
  if (label === "Unbucketed") {
    return 9999;
  }
  if (label === "No Sales") {
    return 9998;
  }
  if (label.endsWith("%+")) {
    return parseInt(label, 10) + 0.5;
  }
  return parseInt(label, 10) || 0;
}

export function parseNumber(value) {
  if (value === null || value === undefined || value === "") {
    return 0;
  }
  if (typeof value === "number") {
    return value;
  }
  const cleaned = String(value)
    .replace(/[%,$]/g, "")
    .replace(/,/g, "")
    .trim();
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function cleanText(value) {
  if (!value) {
    return "";
  }
  return String(value).trim();
}

export function normalizeValue(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

export function normalizeKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

export function groupBy(items, keyFn) {
  return items.reduce((acc, item) => {
    const key = keyFn(item) || "Unmapped";
    acc[key] = acc[key] || [];
    acc[key].push(item);
    return acc;
  }, {});
}
