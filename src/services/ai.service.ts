import { AppError } from '../utils/errors';
import { logger } from '../utils/logger';
import {
  MetaApiError,
  assertResponseCompleted,
  describeUpstreamBody,
  isRecord,
  postMetaJson,
} from './meta.client';

export const META_RESPONSES_URL = 'https://api.meta.ai/v1/responses';
export const META_TEST_MODEL = 'muse-spark-1.3';

const REQUEST_TIMEOUT_MS = 30_000;

/**
 * Concatenates generated text from a Responses API payload, following the
 * documented shape: `output[]` -> `message` items -> `content[]` parts of
 * type `output_text` (`text`) or `refusal` (`refusal`). Reasoning items,
 * tool calls and other item types carry no user-facing text and are skipped.
 * Returns undefined when no text part exists.
 */
export function extractAnswerText(payload: unknown): string | undefined {
  if (!isRecord(payload)) {
    return undefined;
  }
  const output = payload['output'];
  if (!Array.isArray(output)) {
    return undefined;
  }
  const chunks: string[] = [];
  for (const item of output) {
    if (!isRecord(item) || item['type'] !== 'message') {
      continue;
    }
    const content = item['content'];
    if (!Array.isArray(content)) {
      continue;
    }
    for (const part of content) {
      if (!isRecord(part)) {
        continue;
      }
      if (part['type'] === 'output_text' && typeof part['text'] === 'string') {
        chunks.push(part['text']);
      } else if (part['type'] === 'refusal' && typeof part['refusal'] === 'string') {
        chunks.push(part['refusal']);
      }
    }
  }
  if (chunks.length === 0) {
    return undefined;
  }
  return chunks.join('');
}

export interface AiTestResult {
  model: string;
  answer: string;
}

/**
 * Sends one prompt to Meta Muse AI (Responses API) and returns the generated
 * text. The API key travels in the Authorization header only and is never
 * logged or returned.
 */
export async function runAiTest(
  prompt: string,
  apiKey: string | undefined,
  metaApiBase: string,
  signal?: AbortSignal,
): Promise<AiTestResult> {
  if (!apiKey) {
    throw new AppError(503, 'AI_NOT_CONFIGURED', 'Meta AI is not configured on this server');
  }

  const payload = await postMetaJson(
    metaApiBase,
    '/responses',
    { model: META_TEST_MODEL, input: prompt },
    apiKey,
    REQUEST_TIMEOUT_MS,
    { operation: 'ai-test', signal, modelSource: 'hardcoded:META_TEST_MODEL' },
  );
  assertResponseCompleted(payload, {
    endpoint: '/responses',
    operation: 'ai-test',
    requestedModel: META_TEST_MODEL,
    modelSource: 'hardcoded:META_TEST_MODEL',
  });

  const answer = extractAnswerText(payload);
  if (!answer) {
    logger.warn('meta ai returned no text output', { model: META_TEST_MODEL });
    const described = describeUpstreamBody(payload);
    throw new MetaApiError(502, 'AI_UPSTREAM_ERROR', 'Meta AI returned no text output', {
      provider: 'meta',
      operation: 'ai-test',
      requestedModel: META_TEST_MODEL,
      configuredModelSource: 'hardcoded:META_TEST_MODEL',
      upstreamEndpoint: '/responses',
      upstreamHost: null,
      upstreamStatus: null,
      upstreamStatusText: null,
      upstreamError: described.error,
      upstreamBody: described.body,
      bodyTruncated: described.truncated,
      networkError: null,
      reason: 'no-text-output',
    });
  }
  const model =
    isRecord(payload) && typeof payload['model'] === 'string' ? payload['model'] : META_TEST_MODEL;
  return { model, answer };
}
