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

const DTI_SYSTEM_PROMPT = `You are DTI (Don't Trash It), an expert in creative upcycling, practical reuse, sustainable design, and beginner-friendly DIY projects.

Analyze the uploaded photograph and identify the main discarded object, its likely material, visible condition, and relevant physical characteristics.

Generate exactly three distinct, realistic, safe, and useful ideas for transforming this object into new everyday items.

Prioritize ideas that:
- Can genuinely be made from the photographed object.
- Require affordable and accessible additional materials.
- Are useful, attractive, and reasonably easy to make.
- Are meaningfully different from each other.
- Avoid unnecessary complexity and unsafe transformations.

For each idea, provide an appealing English title, a short emotionally engaging description, the intended use, additional materials, required tools, difficulty, estimated crafting time, detailed beginner-friendly tutorial steps, safety precautions, and an English image-generation prompt.

Do not invent market prices, listings, sellers, URLs, or claims of online research. If no verified price information is supplied, indicate that no verified market price is available.

Return only valid JSON matching the required response schema. Do not include Markdown or additional commentary.`;

// Strict-subset compliant: root object, additionalProperties:false on every
// object, required lists every key. Sent via text.format (Responses API).
const IDEAS_JSON_SCHEMA = {
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
      minItems: 3,
      maxItems: 3,
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
        },
      },
    },
  },
};

const tutorialStepSchema = z.object({
  step: z.number().int().min(1),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().min(1).max(2000),
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
});

const sparkOutputSchema = z.object({
  sourceObject: z.object({
    name: z.string().trim().min(1).max(120),
    material: z.string().trim().min(1).max(120),
    condition: z.string().trim().min(1).max(120),
  }),
  ideas: z.array(rawIdeaSchema).length(3),
});

type SparkOutput = z.infer<typeof sparkOutputSchema>;
type RawIdea = SparkOutput['ideas'][number];

export interface GeneratedIdeaImage {
  url: string | null;
  status: 'completed' | 'failed';
}

export interface MarketPriceInfo {
  status: 'not_found';
  amount: null;
  currency: null;
  sourceUrl: null;
  listingTitle: null;
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
  /**
   * When provided, the generation is persisted (source object + three ideas
   * in one transaction) and database IDs are merged into the result.
   */
  ownership?: GenerationOwnership;
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

const NO_MARKET_PRICE: MarketPriceInfo = {
  status: 'not_found',
  amount: null,
  currency: null,
  sourceUrl: null,
  listingTitle: null,
};

const FAILED_IMAGE: GeneratedIdeaImage = { url: null, status: 'failed' };

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
  );
  const image = firstImageBytes(payload);
  if (!image) {
    throw new Error('Meta returned no image data');
  }
  const bytes =
    image.kind === 'b64'
      ? Buffer.from(image.data, 'base64')
      : await downloadImage(image.url, IMAGE_TIMEOUT_MS, MAX_IMAGE_BYTES);
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
      instructions: DTI_SYSTEM_PROMPT,
      input: [
        {
          role: 'user',
          content: [
            { type: 'input_text', text: 'Analyze this photo and generate three upcycling ideas.' },
            { type: 'input_image', image_url: referenceDataUrl },
          ],
        },
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'upcycling_ideas',
          schema: IDEAS_JSON_SCHEMA,
        },
      },
    },
    apiKey,
    SPARK_TIMEOUT_MS,
  );
  assertResponseCompleted(sparkPayload);

  const answerText = extractAnswerText(sparkPayload);
  if (!answerText) {
    logger.warn('meta ai returned no text output', { model: SPARK_MODEL });
    throw new AppError(502, 'AI_UPSTREAM_ERROR', 'Meta AI returned no text output');
  }
  const parsed = sparkOutputSchema.safeParse(parseModelJson(answerText));
  if (!parsed.success) {
    // Model text only (no secrets): safe to log a sample for debugging.
    logger.warn('meta ideas failed validation', { issues: parsed.error.issues.slice(0, 3) });
    throw new AppError(502, 'AI_UPSTREAM_ERROR', 'Meta returned an unusable response');
  }
  const sparkOutput: SparkOutput = parsed.data;

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
        marketPrice: NO_MARKET_PRICE,
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
  sparkOutput: SparkOutput;
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
 * Stores the source photo on disk, then the source object and its three
 * ideas in a single transaction (a failure rolls everything back). Only
 * storage keys are persisted, never image bytes or credentials.
 */
async function persistGeneration(input: PersistGenerationInput): Promise<PersistedIdeasResult> {
  const [raw0, raw1, raw2] = input.sparkOutput.ideas;
  const [idea0, idea1, idea2] = input.ideas;
  const [image0, image1, image2] = input.images;
  if (
    !raw0 ||
    !raw1 ||
    !raw2 ||
    !idea0 ||
    !idea1 ||
    !idea2 ||
    !image0 ||
    !image1 ||
    !image2 ||
    input.sparkOutput.ideas.length !== 3
  ) {
    // Unreachable: the Spark schema enforces exactly three ideas.
    throw new Error('Cannot persist a generation without exactly three ideas');
  }
  const aligned = [
    { raw: raw0, idea: idea0, image: image0 },
    { raw: raw1, idea: idea1, image: image1 },
    { raw: raw2, idea: idea2, image: image2 },
  ];

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
        marketPrice: { ...NO_MARKET_PRICE },
      })),
      { transaction: t },
    );
    const [row0, row1, row2] = rows;
    if (!row0 || !row1 || !row2 || rows.length !== 3) {
      throw new Error('Idea persistence returned an unexpected row count');
    }
    return { source, ideaIds: [row0.id, row1.id, row2.id] as [string, string, string] };
  });

  return {
    sourceObject: { id: persisted.source.id, ...input.sparkOutput.sourceObject },
    // Literal tuple indexes stay total under noUncheckedIndexedAccess.
    ideas: [
      { ...idea0, ideaId: persisted.ideaIds[0] },
      { ...idea1, ideaId: persisted.ideaIds[1] },
      { ...idea2, ideaId: persisted.ideaIds[2] },
    ],
    anonymousOwnerId:
      input.ownership.kind === 'anonymous' ? input.ownership.anonymousOwnerId : null,
  };
}
