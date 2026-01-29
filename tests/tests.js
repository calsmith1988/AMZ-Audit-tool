import { buildAuditResults } from "../audit.js";

const resultsPanel = document.getElementById("test-results");
const results = [];

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function formatResult(name, status, details = "") {
  return { name, status, details };
}

async function run() {
  try {
    const fixture = await loadFixture();
    const audit = buildAuditResults(fixture.datasets, {
      brandAliases: ["chaos"],
    });

    assert(Object.keys(audit.adTypes).length > 0, "No ad types in results.");
    assert(audit.adTypes.SP, "Missing SP results.");
    assert(audit.adTypes.SB, "Missing SB results.");
    assert(audit.adTypes.SD, "Missing SD results.");

    const spBuckets = audit.adTypes.SP.campaignBuckets;
    assert(Array.isArray(spBuckets), "SP campaign buckets not an array.");
    assert(
      audit.adTypes.SP.summary.spendSharePct !== null,
      "SP spend share missing."
    );
    assert(
      audit.adTypes.SP.summary.salesSharePct !== null,
      "SP sales share missing."
    );

    const uniqueKeywords = audit.adTypes.SP.searchTermInsights.uniqueKeywords;
    assert(Array.isArray(uniqueKeywords), "Unique keyword list missing.");
    assert(
      uniqueKeywords.every((item) => item.sales > 0),
      "Unique keywords should exclude 0 sales."
    );

    const spMatchBuckets = audit.adTypes.SP.matchTypeBuckets;
    const byLabel = Object.fromEntries(
      spMatchBuckets.map((bucket) => [bucket.matchType, bucket])
    );
    assert(byLabel.Exact?.spend === 120, "Exact spend should exclude campaigns.");
    assert(byLabel["ASINs"]?.spend === 50, "ASIN bucket missing or wrong.");
    assert(
      byLabel["ASINs Expanded"]?.spend === 30,
      "ASINs Expanded bucket missing or wrong."
    );
    assert(byLabel.Auto?.spend === 40, "Auto bucket missing or wrong.");
    assert(byLabel.Category?.spend === 25, "Category bucket missing or wrong.");
    assert(
      byLabel["Related Keywords"]?.spend === 20,
      "Related Keywords bucket missing or wrong."
    );
    assert(
      byLabel.Auto?.autoBreakdown?.[0]?.label === "Close Match",
      "Auto breakdown missing Close Match."
    );
    assert(
      byLabel.Auto?.autoBreakdown?.[0]?.summary?.spend === 40,
      "Auto breakdown spend mismatch."
    );
    assert(byLabel.Exact?.targetCount === 1, "Target count missing.");
    assert(byLabel.Exact?.acos !== null, "ACoS missing on match type.");
    assert(byLabel.Exact?.roas !== null, "RoAS missing on match type.");

    assert(
      audit.adTypes.SP.pausedBuckets.campaigns.count === 1,
      "Paused campaigns count mismatch."
    );
    assert(
      audit.adTypes.SP.pausedBuckets.adGroups.count === 1,
      "Paused ad groups count mismatch."
    );
    assert(
      audit.adTypes.SP.pausedBuckets.targets.count === 1,
      "Paused targets count mismatch."
    );

    const spPlacements = audit.adTypes.SP.placementBuckets;
    assert(spPlacements.length > 0, "SP placement buckets missing.");
    const spBidding = audit.adTypes.SP.biddingStrategyBuckets;
    assert(spBidding.length > 0, "SP bidding strategy buckets missing.");

    const sdMatchTypes = audit.adTypes.SD.matchTypeBuckets.map(
      (bucket) => bucket.matchType
    );
    assert(
      sdMatchTypes.includes("Contextual targeting"),
      "SD contextual targeting missing."
    );
    assert(
      sdMatchTypes.includes("Audience targeting"),
      "SD audience targeting missing."
    );

    const spBranded = audit.adTypes.SP.brandedBucket;
    assert(spBranded?.summary?.spend > 0, "SP branded bucket missing.");
    const sbBranded = audit.adTypes.SB.brandedBucket;
    assert(sbBranded?.summary?.spend > 0, "SB branded bucket missing.");

    const spMix = audit.adTypes.SP.matchTypeMixFlag;
    assert(spMix?.count === 1, "SP mixed match type count missing.");
    const sbMix = audit.adTypes.SB.matchTypeMixFlag;
    assert(sbMix?.count === 1, "SB mixed match type count missing.");

    const sbVideo = audit.adTypes.SB.sbVideoPresence;
    assert(sbVideo?.hasVideo, "SB video presence not detected.");

    results.push(formatResult("Fixture: results shape", "pass"));
  } catch (error) {
    results.push(formatResult("Fixture: results shape", "fail", error.message));
  }

  try {
    const synthetic = buildAuditResults(buildSyntheticDatasets());
    const buckets = synthetic.adTypes.SP.campaignBuckets;
    const noSales = buckets.find((bucket) => bucket.bucket === "No Sales");
    assert(noSales, "Expected No Sales bucket.");
    results.push(formatResult("Synthetic: No Sales bucket", "pass"));
  } catch (error) {
    results.push(formatResult("Synthetic: No Sales bucket", "fail", error.message));
  }

  renderResults();
}

async function loadFixture() {
  const response = await fetch("./fixtures/sample-fixture.json");
  if (!response.ok) {
    throw new Error("Unable to load fixture JSON.");
  }
  return response.json();
}

function buildSyntheticDatasets() {
  return [
    {
      def: { name: "Synthetic SP", adType: "SP", kind: "campaign" },
      rows: [
        {
          adType: "SP",
          kind: "campaign",
          campaignKey: "C1",
          campaignName: "Test Campaign",
          keywordText: "test keyword",
          matchType: "Exact",
          productTargetingExpression: "",
          customerSearchTerm: "",
          asinTarget: "",
          spend: 100,
          sales: 0,
          clicks: 10,
          orders: 0,
          units: 0,
          impressions: 100,
        },
      ],
    },
  ];
}

function renderResults() {
  resultsPanel.innerHTML = "";
  results.forEach((result) => {
    const item = document.createElement("div");
    item.className = `health-item ${result.status === "pass" ? "ok" : ""}`;
    item.innerHTML = `
      <strong>${result.status.toUpperCase()}</strong> ${result.name}
      ${result.details ? `<div class="muted">${result.details}</div>` : ""}
    `;
    resultsPanel.appendChild(item);
  });
}

run();
