# Core Engine Contract

This document defines the stable contract for the audit engine. Treat
`audit.js` as the source of truth for calculations.

## Engine identity
- Engine: `audit.js`
- Version: `engineVersion` (emitted in output)

## Input
The engine consumes normalized row data derived from the uploaded bulk sheets.
Normalization happens in `audit.js` based on mapped columns.

Key normalized fields (non‑exhaustive):
- `entity`, `entityNormalized`
- `state`, `campaignStateInfo`, `adGroupStateInfo`, `adGroupServingStatusInfo`
- `placement`, `biddingStrategy`, `adFormat`
- `campaignId`, `campaignName`, `adGroupId`, `adGroupName`
- `keywordText`, `productTargetingExpression`, `matchType`, `autoSubType`
- `customerSearchTerm`
- Metrics: `spend`, `sales`, `clicks`, `orders`, `impressions`, `units`
- Derived: `acos`, `cpc`, `cvr`, `roas`

## Output
`buildAuditResults(datasets, options)` returns:
- `engineVersion`
- `generatedAt`
- `adTypes[SP|SB|SD]` with:
  - `summary` (Spend, Sales, ACoS, RoAS, Avg CPC, CVR, Spend/Sales Share %)
  - Buckets: campaign/keyword/ASIN ACoS, match types, placements, bidding
  - `pausedBuckets`
  - `searchTermInsights`
  - Phase 2A flags: `brandedBucket`, `matchTypeMixFlag`, `sbVideoPresence`

## Options
`brandAliases` (array of strings) is used to compute branded metrics.

## Change policy
If you change `audit.js` logic:
1) update tests in `tests/tests.js`
2) update fixtures in `tests/fixtures`
3) update `LOGIC_GUIDE.md` if rules change
4) bump `engineVersion`

