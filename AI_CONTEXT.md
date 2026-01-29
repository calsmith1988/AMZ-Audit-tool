# AI Layer Context

This document captures the AI integration context so a new session can resume
without rereading the entire codebase.

## Files
- `ai.js`: OpenAI client + JSON schema for structured summaries.
- `snippets.json`: Insight template library keyed by bucket/adType.

## ai.js overview
Exports:
- `SUMMARY_SCHEMA`: Strict JSON schema for AI output (buckets + report).
- `requestAuditSummaries({ apiKey, model, systemText, userText })`:
  - Calls `https://api.openai.com/v1/chat/completions`.
  - Uses `response_format` with strict `json_schema`.
  - Parses response JSON or throws error.

Expected response shape:
- `summaryVersion`
- `buckets[]` (per adType + bucketKey, with insights)
- `report` (headline, overview, sections, checklist)

## snippets.json overview
Array of insight snippets:
- Keys: `bucketKey`, `adType`, `snippet`, `tags`
- Many entries are TODO placeholders.
- Intended use: seed prompts or fallback insights.

## Data payload expectation
The AI prompt should be built from:
- Output of `buildAuditResults()` in `audit.js`
- Bucket‑level stats + flags (paused, branded, matchTypeMix, sbVideoPresence)
- Optionally lists of entities (keywords/ASINs/campaigns) for evidence

## Suggested next steps
1) Decide prompt strategy:
   - Use `snippets.json` as prompt seeds or ignored.
2) Define which buckets are sent to AI (all vs selected).
3) Decide how AI output is displayed:
   - Inline per bucket
   - Summary report view
4) Add API key handling (secure input field or server proxy).

