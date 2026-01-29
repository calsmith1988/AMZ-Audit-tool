# Amazon Ads Audit Tool Logic Guide

This guide is a durable reference for how calculations and buckets are built.
Use it to add new metrics or columns without re-deriving rules.

## Where logic lives
- `audit.js`: parsing, normalization, calculations, and bucket logic.
- `app.js`: table structure + column rendering.
- `tests/tests.js`: checks for expected buckets and metrics.
- `tests/fixtures/sample-fixture.json`: fixture coverage for rules.

## Canonical fields (per row)
Key fields normalized in `audit.js`:
- `entity`, `entityNormalized`
- `state`, `campaignStateInfo`, `adGroupStateInfo`, `adGroupServingStatusInfo`
- `placement`, `biddingStrategy`
- `campaignId`, `campaignName`, `adGroupId`, `adGroupName`
- `keywordText`, `productTargetingExpression`, `matchType`, `autoSubType`
- `spend`, `sales`, `clicks`, `orders`, `impressions`, `units`
- Derived: `acos`, `cpc`, `cvr`, `roas`

## Summary KPIs
Computed per ad type (SP/SB/SD) from **enabled** campaign rows:
- Spend, Sales, ACoS, Avg CPC, CVR, RoAS
- Spend Share %, Sales Share %: enabled spend/sales ÷ total account spend/sales

## Match Type Buckets
### SP/SB
Include only `Entity` in {`Keyword`, `Product Targeting`}.
Exclude negative match types.
If `Match type` is blank and `Entity` is `Product Targeting`, classify using
`Product targeting expression`:
- `asin=` → ASINs
- `asin-expanded=` → ASINs Expanded
- `category=` → Category
- `keyword-group=` → Related Keywords
- Auto signals: close/loose/substitutes/complements → Auto (+ expandable breakdown)

Match type rows include:
- Targets count
- Spend/Sales/Spend%/Sales%/Avg CPC
- ACoS, RoAS

### SD
Match type buckets are derived from `Entity`:
- Contextual targeting
- Audience targeting

## ACoS Buckets
Computed for:
- Campaigns, Keywords, ASINs
Based on entity rollups then bucketing ACoS:
0-10%, 10-20%, ..., 90-100%, 100%+

## Unique Search Terms
Built from search term sheets:
- Unique keywords: not targeted + sales > 0
- Unique ASINs: not targeted + sales > 0

## Paused Bucket (with dedupe)
Paused items are excluded from all other buckets.
Paused detection:
- SP Campaigns: `Entity` = Campaign and `Campaign state (Informational only)` = paused
- SP Ad Groups: `Entity` = Ad group and `Ad Group State (Informational only)` = paused
- SP Targets: `Entity` in {Keyword, Product Targeting} and `State` = paused

- SB Campaigns: `Entity` = Campaign and `Campaign state (Informational only)` = paused
- SB Ad Groups: `Entity` = Ad group and `Ad group serving status (Informational only)` = Ad group status paused
- SB Targets: `Entity` in {Keyword, Product Targeting} and `State` = paused

- SD Campaigns: `Entity` = Campaign and `Campaign state (Informational only)` = paused
- SD Ad Groups: `Entity` = Ad group and `Ad Group State (Informational only)` = paused
- SD Targets: `Entity` in {Contextual targeting, Audience targeting} and `State` = paused

Paused bucket reports (per sub-bucket):
- Count (unique items)
- Spend, Sales, ACoS, Avg CPC, RoAS

## Placement Buckets
### SP
`Entity` = Bidding adjustment
`Placement` in:
- Placement top
- Placement product page
- Placement rest of search
- Placement Amazon Business

### SB (SB Multi Ad Group Campaigns)
`Entity` = Bidding adjustment by placement
`Placement` in:
- Detail page
- Home
- Other
- Top of search

Each row shows Spend %, Sales %, Spend, Sales, Avg CPC, ACoS, RoAS.

## SP Campaign Bidding Strategies
`Entity` = Bidding adjustment
`Bidding strategy` in:
- Dynamic bids – down only
- Dynamic bids – up and down
- Dynamic bids – fixed

Each row shows Spend %, Sales %, Spend, Sales, Avg CPC, ACoS, RoAS.

## How to add a metric or column
1. Add the derived metric to `audit.js` (if not already present).
2. Add the column in `app.js` table renderer.
3. Update `tests/tests.js` if the change affects calculations.
4. Extend `tests/fixtures/sample-fixture.json` to cover the new logic.

