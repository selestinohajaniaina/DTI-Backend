import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { sequelize } from '../config/database';
import {
  GeneratedIdea as GeneratedIdeaModel,
  SourceObject as SourceObjectModel,
} from '../models/index';
import type { GenerationOwnership } from '../types/ownership';
import { AppError } from '../utils/errors';
import {
  IMAGE_EXTENSION,
  IMAGE_MIME,
  detectImageKind,
  type SupportedImageKind,
} from '../utils/image';
import { logger } from '../utils/logger';
import { extractAnswerText } from './ai.service';
import { assertResponseCompleted, downloadImage, isRecord, postMetaJson } from './meta.client';

export const SPARK_MODEL = 'muse-spark-1.3';
export const IMAGE_MODEL = 'muse-image-1.0';

const SPARK_TIMEOUT_MS = 180_000;
const IMAGE_TIMEOUT_MS = 180_000;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

const PRICE_GUIDANCE = `Price estimate (US dollars — USD only):
- estimatedCost: a rough, easy-to-understand estimate in USD of what it would cost to make the product (materials plus a share of the assembly effort).
- estimatedSellingPrice: a rough, easy-to-understand estimate in USD of what the finished item could sell for.
Always express both amounts in US dollars (USD); never use another currency. Keep both plausible and familiar: simple amounts such as 2.5, 5, or 8 — never precise-looking figures such as 7.83. Base them on the required materials, the manufacturing or assembly cost, and the time and complexity involved. These are approximate estimates, never verified market prices or guaranteed profits. If you cannot estimate a reasonable price, return null for that field rather than inventing one. Do not search the Internet, look up market prices online, or invent listings, sellers, URLs, or claims of online research.`;

function buildSystemPrompt(ideasCount: number): string {
  return `You are DTI (Don't Trash It), an expert in creative upcycling, practical reuse, sustainable design, and beginner-friendly DIY projects.

Analyze the uploaded photograph and identify the main discarded object, its likely material, visible condition, and relevant physical characteristics.

Generate exactly ${ideasCount} distinct, realistic, safe, and useful ideas for transforming this object into new everyday items.

Prioritize ideas that:
- Can genuinely be made from the photographed object.
- Require affordable and accessible additional materials.
- Are useful, attractive, and reasonably easy to make.
- Are meaningfully different from each other.
- Avoid unnecessary complexity and unsafe transformations.

For each idea, provide an appealing English title, a short emotionally engaging description, the intended use, additional materials, required tools, difficulty, estimated crafting time, detailed beginner-friendly tutorial steps, safety precautions, an English image-generation prompt, and a price estimate.

${PRICE_GUIDANCE}

Return only valid JSON matching the required response schema. Do not include Markdown or additional commentary.`;
}

// Strict-subset compliant: root object, additionalProperties:false on every
// object, required lists every key. Sent via text.format (Responses API).
// The price fields use standard `['number', 'null']` unions (no request
// sets `strict: true`, so the schema is accepted as-is and output stays
// schema-constrained). US dollar (USD) amounts with optional cents. The
// schema carries no currency field on purpose: the model never chooses the
// currency, the server always stamps 'USD' (see toMarketPrice).
const MAX_PRICE_USD = 1_000_000;

function buildIdeasJsonSchema(ideasCount: number): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['sourceObject', 'ideas'],
    properties: {
      sourceObject: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'material', 'condition'],
        properties: {
          name: { type: 'string', minLength: 1 },
          material: { type: 'string', minLength: 1 },
          condition: { type: 'string', minLength: 1 },
        },
      },
      ideas: {
        type: 'array',
        minItems: ideasCount,
        maxItems: ideasCount,
        items: {
          type: 'object',
          additionalProperties: false,
          required: [
            'title',
            'description',
            'intendedUse',
            'additionalMaterials',
            'tools',
            'difficulty',
            'estimatedMinutes',
            'tutorialSteps',
            'safetyNotes',
            'imagePrompt',
            'priceEstimate',
          ],
          properties: {
            title: { type: 'string', minLength: 1 },
            description: { type: 'string', minLength: 1 },
            intendedUse: { type: 'string', minLength: 1 },
            additionalMaterials: {
              type: 'array',
              minItems: 1,
              items: { type: 'string', minLength: 1 },
            },
            tools: { type: 'array', minItems: 1, items: { type: 'string', minLength: 1 } },
            difficulty: { type: 'string', enum: ['Easy', 'Medium', 'Hard'] },
            estimatedMinutes: { type: 'integer', minimum: 1, maximum: 1440 },
            tutorialSteps: {
              type: 'array',
              minItems: 1,
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['step', 'title', 'description'],
                properties: {
                  step: { type: 'integer', minimum: 1 },
                  title: { type: 'string', minLength: 1 },
                  description: { type: 'string', minLength: 1 },
                },
              },
            },
            safetyNotes: { type: 'array', items: { type: 'string' } },
            imagePrompt: { type: 'string', minLength: 1 },
            priceEstimate: {
              type: 'object',
              additionalProperties: false,
              required: ['estimatedCost', 'estimatedSellingPrice'],
              properties: {
                estimatedCost: { type: ['number', 'null'], minimum: 0, maximum: MAX_PRICE_USD },
                estimatedSellingPrice: {
                  type: ['number', 'null'],
                  minimum: 0,
                  maximum: MAX_PRICE_USD,
                },
              },
            },
          },
        },
      },
    },
  };
}

const tutorialStepSchema = z.object({
  step: z.number().int().min(1),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().min(1).max(2000),
});

// The model is asked for simple dollar amounts; round defensively to cents
// so 12.476 becomes 12.48 instead of storing fractions of a cent. Unknown
// keys (a rogue `currency` included) are stripped: the server owns the
// currency, never the model response.
const usdAmount = z
  .number()
  .min(0)
  .max(MAX_PRICE_USD)
  .nullable()
  .transform((value) => (value === null ? null : Math.round(value * 100) / 100));

const priceEstimateSchema = z.object({
  estimatedCost: usdAmount,
  estimatedSellingPrice: usdAmount,
});

const rawIdeaSchema = z.object({
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().min(1).max(600),
  intendedUse: z.string().trim().min(1).max(300),
  additionalMaterials: z.array(z.string().trim().min(1).max(200)).min(1).max(30),
  tools: z.array(z.string().trim().min(1).max(200)).min(1).max(30),
  difficulty: z.enum(['Easy', 'Medium', 'Hard']),
  estimatedMinutes: z.number().int().min(1).max(1440),
  tutorialSteps: z.array(tutorialStepSchema).min(1).max(30),
  safetyNotes: z.array(z.string().trim().max(300)).max(30),
  imagePrompt: z.string().trim().min(1).max(1200),
  priceEstimate: priceEstimateSchema,
});

const sourceObjectSchema = z.object({
  name: z.string().trim().min(1).max(120),
  material: z.string().trim().min(1).max(120),
  condition: z.string().trim().min(1).max(120),
});

// Root shape only; ideas are validated item by item so one bad entry cannot
// discard the whole response (see parseSparkOutput).
const sparkRootSchema = z.object({
  sourceObject: sourceObjectSchema,
  ideas: z.array(z.unknown()),
});

type RawIdea = z.infer<typeof rawIdeaSchema>;

interface ParsedSparkOutput {
  sourceObject: z.infer<typeof sourceObjectSchema>;
  ideas: RawIdea[];
}

/**
 * Validates the model's JSON, keeping every usable idea: entries are checked
 * individually, duplicates (case-insensitive title match) are dropped, and
 * the result is capped at the requested count. Returns undefined when
 * nothing usable remains. Never pads or duplicates entries to reach the
 * requested count.
 */
function parseSparkOutput(data: unknown, ideasCount: number): ParsedSparkOutput | undefined {
  const root = sparkRootSchema.safeParse(data);
  if (!root.success) {
    return undefined;
  }
  const seenTitles = new Set<string>();
  const ideas: RawIdea[] = [];
  let dropped = 0;
  for (const candidate of root.data.ideas) {
    if (ideas.length >= ideasCount) {
      break;
    }
    const item = rawIdeaSchema.safeParse(candidate);
    if (!item.success) {
      dropped += 1;
      continue;
    }
    const key = item.data.title.trim().toLowerCase();
    if (seenTitles.has(key)) {
      dropped += 1;
      continue;
    }
    seenTitles.add(key);
    ideas.push(item.data);
  }
  if (ideas.length === 0) {
    return undefined;
  }
  if (ideas.length < ideasCount) {
    logger.warn('meta returned fewer valid ideas than requested', {
      requested: ideasCount,
      valid: ideas.length,
      dropped,
    });
  }
  return { sourceObject: root.data.sourceObject, ideas };
}

export interface GeneratedIdeaImage {
  url: string | null;
  status: 'completed' | 'failed';
}

export interface PriceEstimate {
  estimatedCost: number | null;
  estimatedSellingPrice: number | null;
}

export interface MarketPriceInfo extends PriceEstimate {
  status: 'estimated';
  currency: 'USD';
}

export interface IdeaTutorialStep {
  step: number;
  title: string;
  description: string;
}

export interface IdeaTutorial {
  materials: string[];
  tools: string[];
  steps: IdeaTutorialStep[];
  safetyNotes: string[];
}

export interface GeneratedIdea {
  id: string;
  title: string;
  description: string;
  difficulty: string;
  estimatedMinutes: number;
  image: GeneratedIdeaImage;
  marketPrice: MarketPriceInfo;
  tutorial: IdeaTutorial;
}

export interface GenerateIdeasResult {
  sourceObject: { name: string; material: string; condition: string };
  ideas: GeneratedIdea[];
}

export interface IdeasDeps {
  apiKey: string | undefined;
  metaApiBase: string;
  uploadDir: string;
  /** Ideas requested from the model (validated `GENERATED_IDEAS_COUNT`). */
  ideasCount: number;
  /**
   * When provided, the generation is persisted (source object plus every
   * valid idea in one transaction) and database IDs are merged into the
   * result.
   */
  ownership?: GenerationOwnership;
  /** Aborts in-flight Meta requests (client disconnect). Never retried. */
  signal?: AbortSignal;
}

/** Public result plus database IDs; anonymousOwnerId is null for signed-in callers. */
export interface PersistedIdeasResult extends GenerateIdeasResult {
  sourceObject: GenerateIdeasResult['sourceObject'] & { id: string };
  ideas: (GeneratedIdea & { ideaId: string })[];
  anonymousOwnerId: string | null;
}

/** Public URL prefix for files served from the upload directory. */
export const UPLOADS_URL_PREFIX = '/uploads/';

const SOURCE_IMAGES_DIR = 'source';

const FAILED_IMAGE: GeneratedIdeaImage = { url: null, status: 'failed' };

function toMarketPrice(estimate: PriceEstimate): MarketPriceInfo {
  return {
    status: 'estimated',
    currency: 'USD',
    estimatedCost: estimate.estimatedCost,
    estimatedSellingPrice: estimate.estimatedSellingPrice,
  };
}

function parseModelJson(text: string): unknown {
  // json_schema mode returns raw JSON; strip fences defensively anyway.
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  try {
    const parsed: unknown = JSON.parse(cleaned);
    return parsed;
  } catch {
    return undefined;
  }
}

function firstImageBytes(
  payload: unknown,
): { kind: 'b64'; data: string } | { kind: 'url'; url: string } | undefined {
  if (!isRecord(payload)) {
    return undefined;
  }
  const data = payload['data'];
  if (!Array.isArray(data) || data.length === 0) {
    return undefined;
  }
  const first: unknown = data[0];
  if (!isRecord(first)) {
    return undefined;
  }
  if (typeof first['b64_json'] === 'string' && first['b64_json'].length > 0) {
    return { kind: 'b64', data: first['b64_json'] };
  }
  if (typeof first['url'] === 'string' && first['url'].length > 0) {
    return { kind: 'url', url: first['url'] };
  }
  return undefined;
}

async function generateAndStoreImage(
  imagePrompt: string,
  referenceDataUrl: string,
  deps: IdeasDeps,
  apiKey: string,
): Promise<string> {
  // One retry for no-response failures and rate limits only: a 5xx may
  // already have generated (and billed) an image, so it is never retried.
  const payload = await postMetaJson(
    deps.metaApiBase,
    '/images/edits',
    {
      model: IMAGE_MODEL,
      prompt: imagePrompt,
      images: [{ image_url: referenceDataUrl }],
      response_format: 'b64_json',
    },
    apiKey,
    IMAGE_TIMEOUT_MS,
    {
      operation: 'generate-image',
      signal: deps.signal,
      maxRetries: 1,
      retryServerError: false,
      modelSource: 'hardcoded:IMAGE_MODEL',
    },
  );
  const image = firstImageBytes(payload);
  if (!image) {
    throw new Error('Meta returned no image data');
  }
  const bytes =
    image.kind === 'b64'
      ? Buffer.from(image.data, 'base64')
      : await downloadImage(image.url, IMAGE_TIMEOUT_MS, MAX_IMAGE_BYTES, {
          operation: 'download-image',
          signal: deps.signal,
        });
  const kind = detectImageKind(bytes);
  if (!kind || bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) {
    throw new Error('Meta returned an unusable image');
  }
  const dir = path.join(deps.uploadDir, 'generated');
  await fs.mkdir(dir, { recursive: true });
  const filename = `idea-${crypto.randomUUID()}.${IMAGE_EXTENSION[kind]}`;
  await fs.writeFile(path.join(dir, filename), bytes);
  return `${UPLOADS_URL_PREFIX}generated/${filename}`;
}

export function generateIdeasFromPhoto(
  image: Buffer,
  deps: IdeasDeps & { ownership: GenerationOwnership },
): Promise<PersistedIdeasResult>;
export function generateIdeasFromPhoto(
  image: Buffer,
  deps: IdeasDeps,
): Promise<GenerateIdeasResult>;
export async function generateIdeasFromPhoto(
  image: Buffer,
  deps: IdeasDeps,
): Promise<GenerateIdeasResult | PersistedIdeasResult> {
  const apiKey = deps.apiKey;
  if (!apiKey) {
    throw new AppError(503, 'AI_NOT_CONFIGURED', 'Meta AI is not configured on this server');
  }
  const kind = detectImageKind(image);
  if (!kind) {
    throw new AppError(
      400,
      'VALIDATION_ERROR',
      'Unsupported image format (JPEG, PNG, WebP or GIF)',
    );
  }

  const referenceDataUrl = `data:${IMAGE_MIME[kind]};base64,${image.toString('base64')}`;
  const sparkPayload = await postMetaJson(
    deps.metaApiBase,
    '/responses',
    {
      model: SPARK_MODEL,
      instructions: buildSystemPrompt(deps.ideasCount),
      input: [
        {
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: `Analyze this photo and generate ${deps.ideasCount} upcycling ideas.`,
            },
            { type: 'input_image', image_url: referenceDataUrl },
          ],
        },
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'upcycling_ideas',
          schema: buildIdeasJsonSchema(deps.ideasCount),
        },
      },
    },
    apiKey,
    SPARK_TIMEOUT_MS,
    { operation: 'generate-ideas', signal: deps.signal, modelSource: 'hardcoded:SPARK_MODEL' },
  );
  assertResponseCompleted(sparkPayload, {
    endpoint: '/responses',
    operation: 'generate-ideas',
    requestedModel: SPARK_MODEL,
    modelSource: 'hardcoded:SPARK_MODEL',
  });

  const answerText = extractAnswerText(sparkPayload);
  if (!answerText) {
    logger.warn('meta ai returned no text output', { model: SPARK_MODEL });
    throw new AppError(502, 'AI_UPSTREAM_ERROR', 'Meta AI returned no text output');
  }
  const sparkOutput = parseSparkOutput(parseModelJson(answerText), deps.ideasCount);
  if (!sparkOutput) {
    logger.warn('meta ideas failed validation', { requested: deps.ideasCount });
    throw new AppError(502, 'AI_UPSTREAM_ERROR', 'Meta returned an unusable response');
  }

  const images = await Promise.all(
    sparkOutput.ideas.map((idea: RawIdea, index: number) =>
      generateAndStoreImage(idea.imagePrompt, referenceDataUrl, deps, apiKey).then(
        (url) => ({ url, status: 'completed' as const }),
        () => {
          // Per-idea failure: never log the error itself (image URLs may be
          // signed); keep the other results.
          logger.warn('idea image generation failed', { index });
          return FAILED_IMAGE;
        },
      ),
    ),
  );

  const ideas: GeneratedIdea[] = sparkOutput.ideas.map(
    (idea: RawIdea, index: number): GeneratedIdea => {
      const generated = images[index] ?? FAILED_IMAGE;
      return {
        id: `idea-${index + 1}`,
        title: idea.title,
        description: idea.description,
        difficulty: idea.difficulty,
        estimatedMinutes: idea.estimatedMinutes,
        image: generated,
        marketPrice: toMarketPrice(idea.priceEstimate),
        tutorial: {
          materials: idea.additionalMaterials,
          tools: idea.tools,
          steps: idea.tutorialSteps,
          safetyNotes: idea.safetyNotes,
        },
      };
    },
  );

  if (!deps.ownership) {
    return {
      sourceObject: sparkOutput.sourceObject,
      ideas,
    };
  }
  return persistGeneration({
    photo: image,
    kind,
    sparkOutput,
    ideas,
    images,
    ownership: deps.ownership,
    uploadDir: deps.uploadDir,
  });
}

interface PersistGenerationInput {
  photo: Buffer;
  kind: SupportedImageKind;
  sparkOutput: ParsedSparkOutput;
  ideas: GeneratedIdea[];
  images: GeneratedIdeaImage[];
  ownership: GenerationOwnership;
  uploadDir: string;
}

function toStorageKey(publicUrl: string | null): string | null {
  if (publicUrl === null) {
    return null;
  }
  if (!publicUrl.startsWith(UPLOADS_URL_PREFIX)) {
    // Unreachable: every stored image URL is built with this prefix above.
    throw new Error('Generated image URL has an unexpected format');
  }
  return publicUrl.slice(UPLOADS_URL_PREFIX.length);
}

/**
 * Stores the source photo on disk, then the source object and every valid
 * idea in a single transaction (a failure rolls everything back). Only
 * storage keys are persisted, never image bytes or credentials.
 */
async function persistGeneration(input: PersistGenerationInput): Promise<PersistedIdeasResult> {
  const aligned = input.sparkOutput.ideas.map((raw, index) => {
    const idea = input.ideas[index];
    const image = input.images[index];
    if (!idea || !image) {
      // Unreachable: all three arrays are built from the same parsed ideas.
      throw new Error('Cannot persist misaligned generation results');
    }
    return { raw, idea, image };
  });
  if (aligned.length === 0) {
    throw new Error('Cannot persist a generation without ideas');
  }

  const dir = path.join(input.uploadDir, SOURCE_IMAGES_DIR);
  await fs.mkdir(dir, { recursive: true });
  const filename = `source-${crypto.randomUUID()}.${IMAGE_EXTENSION[input.kind]}`;
  await fs.writeFile(path.join(dir, filename), input.photo);
  const sourceKey = `${SOURCE_IMAGES_DIR}/${filename}`;

  const persisted = await sequelize.transaction(async (t) => {
    const source = await SourceObjectModel.create(
      {
        ownerId: input.ownership.kind === 'user' ? input.ownership.userId : null,
        anonymousOwnerId:
          input.ownership.kind === 'anonymous' ? input.ownership.anonymousOwnerId : null,
        imagePath: sourceKey,
        name: input.sparkOutput.sourceObject.name,
        material: input.sparkOutput.sourceObject.material,
        condition: input.sparkOutput.sourceObject.condition,
      },
      { transaction: t },
    );
    const rows = await GeneratedIdeaModel.bulkCreate(
      aligned.map(({ raw, image }) => ({
        sourceObjectId: source.id,
        title: raw.title,
        description: raw.description,
        intendedUse: raw.intendedUse,
        additionalMaterials: raw.additionalMaterials,
        tools: raw.tools,
        difficulty: raw.difficulty,
        estimatedMinutes: raw.estimatedMinutes,
        tutorialSteps: raw.tutorialSteps,
        safetyNotes: raw.safetyNotes,
        imagePath: toStorageKey(image.url),
        imageStatus: image.status,
        marketPrice: toMarketPrice(raw.priceEstimate),
      })),
      { transaction: t },
    );
    if (rows.length !== aligned.length) {
      throw new Error('Idea persistence returned an unexpected row count');
    }
    return { source, rows };
  });

  return {
    sourceObject: { id: persisted.source.id, ...input.sparkOutput.sourceObject },
    ideas: aligned.map(({ idea }, index) => {
      const row = persisted.rows[index];
      if (!row) {
        // Unreachable: the row count was verified above.
        throw new Error('Idea persistence returned an unexpected row count');
      }
      return { ...idea, ideaId: row.id };
    }),
    anonymousOwnerId:
      input.ownership.kind === 'anonymous' ? input.ownership.anonymousOwnerId : null,
  };
}
