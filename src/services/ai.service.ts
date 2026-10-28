import { AppError } from '../utils/errors';
import { logger } from '../utils/logger';

export const META_RESPONSES_URL = 'https://api.meta.ai/v1/responses';
export const META_TEST_MODEL = 'muse-spark-1.3';

const REQUEST_TIMEOUT_MS = 30_000;
const MAX_UPSTREAM_LOG_CHARS = 200;

export interface AiTestResult {
  model: string;
  answer: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

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

/**
 * Sends one prompt to Meta Muse AI (Responses API) and returns the generated
 * text. Uses the native fetch API: no extra dependency. The API key travels
 * in the Authorization header only and is never logged or returned.
 */
export async function runAiTest(prompt: string, apiKey: string | undefined): Promise<AiTestResult> {
  if (!apiKey) {
    throw new AppError(503, 'AI_NOT_CONFIGURED', 'Meta AI is not configured on this server');
  }

  let res: Response;
  try {
    res = await fetch(META_RESPONSES_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: META_TEST_MODEL, input: prompt }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      logger.warn('meta ai request timed out', {
        model: META_TEST_MODEL,
        timeoutMs: REQUEST_TIMEOUT_MS,
      });
      throw new AppError(504, 'AI_TIMEOUT', 'Meta AI request timed out');
    }
    logger.warn('meta ai request failed', { model: META_TEST_MODEL });
    throw new AppError(502, 'AI_UPSTREAM_ERROR', 'Meta AI request failed');
  }

  if (!res.ok) {
    // The key is header-only, never in the body, so a short upstream snippet
    // is safe to log. Never log request headers.
    const snippet = (await res.text().catch(() => '')).slice(0, MAX_UPSTREAM_LOG_CHARS);
    logger.warn('meta ai responded with an error', { status: res.status, body: snippet });
    throw new AppError(502, 'AI_UPSTREAM_ERROR', 'Meta AI request failed');
  }

  const payload: unknown = await res.json().catch(() => undefined);
  if (payload === undefined) {
    logger.warn('meta ai returned invalid json', { status: res.status });
    throw new AppError(502, 'AI_UPSTREAM_ERROR', 'Meta AI request failed');
  }
  if (isRecord(payload) && payload['status'] === 'failed') {
    const failure = isRecord(payload['error']) ? payload['error'] : undefined;
    logger.warn('meta ai generation failed', {
      code: typeof failure?.['code'] === 'string' ? failure['code'] : 'unknown',
      message: typeof failure?.['message'] === 'string' ? failure['message'] : 'unknown',
    });
    throw new AppError(502, 'AI_UPSTREAM_ERROR', 'Meta AI request failed');
  }

  const answer = extractAnswerText(payload);
  if (!answer) {
    logger.warn('meta ai returned no text output', { model: META_TEST_MODEL });
    throw new AppError(502, 'AI_UPSTREAM_ERROR', 'Meta AI returned no text output');
  }
  const model =
    isRecord(payload) && typeof payload['model'] === 'string' ? payload['model'] : META_TEST_MODEL;
  return { model, answer };
}
