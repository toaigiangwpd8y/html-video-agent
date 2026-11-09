export const VIDEO_PROJECT_SCHEMA_VERSION = "1.0" as const;

const nonemptyString = {type: "string", minLength: 1} as const;
const stringArray = {type: "array", items: nonemptyString} as const;
const hexColor = {type: "string", pattern: "^#[0-9A-Fa-f]{6}(?:[0-9A-Fa-f]{2})?$"} as const;

export const VIDEO_PROJECT_JSON_SCHEMA: Record<string, unknown> = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "VideoProject",
  description: "Canonical renderer-neutral semantic video contract. Top-level keys are exactly meta and scenes.",
  type: "object",
  additionalProperties: false,
  required: ["meta", "scenes"],
  properties: {
    meta: {
      type: "object",
      additionalProperties: false,
      required: ["title", "width", "height", "durationsInFrames", "fps", "theme", "constraints"],
      properties: {
        title: nonemptyString,
        width: {type: "integer", minimum: 1},
        height: {type: "integer", minimum: 1},
        durationsInFrames: {type: "integer", minimum: 1, description: "Final composition frame budget. Harness validation requires this to equal the sum of scene durationInFrames values. Derive narrated scene minima from measured Script-stage TTS, not the approximate Video Brief duration."},
        fps: {type: "integer", minimum: 1},
        theme: {
          type: "object",
          additionalProperties: false,
          required: ["palette", "font"],
          properties: {
            palette: {type: "array", minItems: 1, uniqueItems: true, items: hexColor},
            font: nonemptyString,
            mode: {type: "string", enum: ["dark", "light"], description: "Canvas polarity. Defaults to dark: the darkest palette color becomes the page."},
            roles: {
              type: "object",
              additionalProperties: false,
              description: "Optional pins for renderer color roles. Each value must be a member of palette; unpinned roles are derived.",
              properties: {page: hexColor, text: hexColor, accent: hexColor},
            },
          },
        },
        constraints: {
          type: "object",
          additionalProperties: false,
          required: ["style", "disallowed", "motionTone"],
          properties: {style: nonemptyString, disallowed: stringArray, motionTone: nonemptyString},
        },
      },
    },
    scenes: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "durationInFrames", "screenText", "visualConcept"],
        properties: {
          id: nonemptyString,
          durationInFrames: {type: "integer", minimum: 1, description: "Sequential scene frame budget. For narration, cover measured Script-stage TTS rounded up to a frame; use that minimum by default and add time only for purposeful visual pacing."},
          audio: {
            type: "object",
            additionalProperties: false,
            required: ["voiceoverText"],
            properties: {voiceoverText: nonemptyString,voiceSegmentId:{type:"string",minLength:1}},
          },
          screenText: nonemptyString,
          visualConcept: {
            ...nonemptyString,
            description: "Semantic visual intent: what the viewer must understand, including relationships, change, evidence, and constraints. Do not encode asset paths, geometry, components, layout recipes, or animation instructions.",
          },
        },
      },
    },
  },
};

export function getContractSchemaPayload(): {name: string; version: string; jsonSchema: Record<string, unknown>} {
  return {name: "VideoProject", version: VIDEO_PROJECT_SCHEMA_VERSION, jsonSchema: VIDEO_PROJECT_JSON_SCHEMA};
}
