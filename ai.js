const INSIGHT_SCHEMA = {
  type: "object",
  properties: {
    type: {
      type: "string",
      enum: ["winner", "issue", "discrepancy", "opportunity", "efficiency", "waste"],
    },
    title: { type: "string" },
    detail: { type: "string" },
    action: { type: "string" },
    evidence: {
      type: "array",
      items: {
        type: "object",
        properties: {
          label: { type: "string" },
          value: { type: "string" },
        },
        required: ["label", "value"],
        additionalProperties: false,
      },
    },
  },
  required: ["type", "title", "detail", "action", "evidence"],
  additionalProperties: false,
};

const CHECKLIST_ITEM_SCHEMA = {
  type: "object",
  properties: {
    adType: { type: "string", enum: ["SP", "SB", "SD"] },
    bucketKey: { type: "string" },
    entityName: { type: "string" },
    actionText: { type: "string" },
    evidence: {
      type: "array",
      items: { type: "string" },
    },
  },
  required: ["adType", "bucketKey", "entityName", "actionText", "evidence"],
  additionalProperties: false,
};

export const SUMMARY_SCHEMA = {
  type: "object",
  properties: {
    summaryVersion: { type: "string" },
    buckets: {
      type: "array",
      items: {
        type: "object",
        properties: {
          adType: { type: "string", enum: ["SP", "SB", "SD"] },
          bucketKey: { type: "string" },
          bucketLabel: { type: "string" },
          summary: { type: "string" },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          insights: {
            type: "array",
            items: INSIGHT_SCHEMA,
          },
        },
        required: [
          "adType",
          "bucketKey",
          "bucketLabel",
          "summary",
          "confidence",
          "insights",
        ],
        additionalProperties: false,
      },
    },
    report: {
      type: "object",
      properties: {
        headline: { type: "string" },
        overview: { type: "string" },
        checklist: {
          type: "array",
          items: CHECKLIST_ITEM_SCHEMA,
        },
        sections: {
          type: "array",
          items: {
            type: "object",
            properties: {
              adType: { type: "string", enum: ["SP", "SB", "SD"] },
              summary: { type: "string" },
              insights: {
                type: "array",
                items: INSIGHT_SCHEMA,
              },
            },
            required: ["adType", "summary", "insights"],
            additionalProperties: false,
          },
        },
      },
      required: ["headline", "overview", "sections", "checklist"],
      additionalProperties: false,
    },
  },
  required: ["summaryVersion", "buckets", "report"],
  additionalProperties: false,
};

export async function requestAuditSummaries({ apiKey, model, systemText, userText }) {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "audit_summary",
          schema: SUMMARY_SCHEMA,
          strict: true,
        },
      },
      messages: [
        { role: "system", content: systemText },
        { role: "user", content: userText },
      ],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI API error (${response.status}): ${errorText}`);
  }

  const payload = await response.json();
  const content = payload?.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("OpenAI response missing content.");
  }

  try {
    return JSON.parse(content);
  } catch (error) {
    throw new Error("Failed to parse AI summary JSON.");
  }
}
