import fs from 'node:fs/promises';
import { inject } from 'light-my-request';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { env } from '../src/config/env';
import { IMAGE_MODEL, SPARK_MODEL, generateIdeasFromPhoto } from '../src/services/ideas.service';
import { AppError } from '../src/utils/errors';
import { detectImageKind } from '../src/utils/image';
import { app, parseJson } from './helpers';

interface IdeasSuccessBody {
  success: boolean;
  data: {
    sourceObject: { id: string; name: string; material: string; condition: string };
    ideas: {
      id: string;
      ideaId: string;
      title: string;
      description: string;
      difficulty: string;
      estimatedMinutes: number;
      image: { url: string | null; status: string };
      marketPrice: {
        status: string;
        amount: null;
        currency: null;
        sourceUrl: null;
        listingTitle: null;
      };
      tutorial: {
        materials: string[];
        tools: string[];
        steps: { step: number; title: string; description: string }[];
        safetyNotes: string[];
      };
    }[];
    anonymousOwnerId: string | null;
  };
}

interface ErrorBody {
  success: boolean;
  error: { code: string; message: string };
}

const BOUNDARY = '----dti-test-boundary';
// Real 1x1 PNG bytes (also reused as the stubbed generated image).
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);
const FAKE_JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const FAKE_CDN_URL = 'https://cdn.example.test/generated/idea.png';

function multipartFile(field: string, filename: string, mime: string, content: Buffer): Buffer {
  const head =
    `--${BOUNDARY}\r\n` +
    `Content-Disposition: form-data; name="${field}"; filename="${filename}"\r\n` +
    `Content-Type: ${mime}\r\n\r\n`;
  const tail = `\r\n--${BOUNDARY}--\r\n`;
  return Buffer.concat([Buffer.from(head, 'utf8'), content, Buffer.from(tail, 'utf8')]);
}

function postIdeas(payload: Buffer, filename = 'cup.png', mime = 'image/png') {
  return inject(app, {
    method: 'POST',
    url: '/api/ai/generate-ideas',
    headers: { 'content-type': `multipart/form-data; boundary=${BOUNDARY}` },
    payload: multipartFile('image', filename, mime, payload),
  });
}

function sparkIdea(index: number): Record<string, unknown> {
  return {
    title: `Idea ${index}`,
    description: `Description ${index}`,
    intendedUse: `Use ${index}`,
    additionalMaterials: ['Paint'],
    tools: ['Brush'],
    difficulty: 'Easy',
    estimatedMinutes: 15 + index,
    tutorialSteps: [{ step: 1, title: 'Do it', description: 'Do it well.' }],
    safetyNotes: [],
    imagePrompt: `Finished upcycled object ${index}, product photo`,
  };
}

function sparkPayload(ideas: unknown[]): Record<string, unknown> {
  const text = JSON.stringify({
    sourceObject: { name: 'Cup', material: 'plastic', condition: 'reusable' },
    ideas,
  });
  return {
    id: 'resp_1',
    object: 'response',
    status: 'completed',
    model: SPARK_MODEL,
    output: [
      {
        id: 'msg_1',
        type: 'message',
        role: 'assistant',
        status: 'completed',
        content: [{ type: 'output_text', text, annotations: [] }],
      },
    ],
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function requestUrl(input: string | URL | Request): string {
  if (typeof input === 'string') {
    return input;
  }
  return input instanceof URL ? input.toString() : input.url;
}

/**
 * Stubs Meta: Spark answers once, each image edit follows `imageBehavior`
 * (value or thrown Error), and FAKE_CDN_URL serves the tiny PNG (covers the
 * url-download path).
 */
function stubMeta(sparkBody: unknown, imageBehavior: (callIndex: number) => unknown) {
  let imageCalls = 0;
  const mock = vi.fn<typeof fetch>().mockImplementation((input) => {
    const url = requestUrl(input);
    if (url.endsWith('/responses')) {
      return Promise.resolve(jsonResponse(sparkBody));
    }
    if (url === FAKE_CDN_URL) {
      return Promise.resolve(
        new Response(TINY_PNG, { status: 200, headers: { 'Content-Type': 'image/png' } }),
      );
    }
    const current = imageCalls;
    imageCalls += 1;
    const behavior = imageBehavior(current);
    if (behavior instanceof Error) {
      return Promise.reject(behavior);
    }
    return Promise.resolve(jsonResponse(behavior));
  });
  vi.stubGlobal('fetch', mock);
  return mock;
}

function imageB64Response(): Record<string, unknown> {
  return { created: 1, data: [{ b64_json: TINY_PNG.toString('base64') }] };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

afterAll(async () => {
  await fs.rm(env.uploadDir, { recursive: true, force: true });
});

describe('detectImageKind', () => {
  it('recognizes supported formats and rejects the rest', () => {
    expect(detectImageKind(TINY_PNG)).toBe('png');
    expect(detectImageKind(FAKE_JPEG)).toBe('jpeg');
    expect(
      detectImageKind(Buffer.concat([Buffer.from('RIFFxxxxWEBP', 'ascii'), Buffer.alloc(10)])),
    ).toBe('webp');
    expect(detectImageKind(Buffer.from('GIF89a', 'ascii'))).toBe('gif');
    expect(detectImageKind(Buffer.from('not an image'))).toBeUndefined();
    expect(detectImageKind(Buffer.alloc(0))).toBeUndefined();
  });
});

describe('POST /api/ai/generate-ideas', () => {
  it('rejects missing files with 400', async () => {
    const res = await inject(app, { method: 'POST', url: '/api/ai/generate-ideas', payload: {} });

    expect(res.statusCode).toBe(400);
    expect(parseJson<ErrorBody>(res).error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects non-image uploads with 400', async () => {
    const res = await postIdeas(Buffer.from('hello'), 'note.txt', 'text/plain');

    expect(res.statusCode).toBe(400);
    expect(parseJson<ErrorBody>(res).error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects spoofed MIME types by checking magic bytes', async () => {
    const res = await postIdeas(Buffer.from('fake image bytes'), 'fake.png', 'image/png');

    expect(res.statusCode).toBe(400);
    expect(parseJson<ErrorBody>(res).error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects oversized uploads with 413', async () => {
    const huge = Buffer.alloc(10 * 1024 * 1024 + 1);
    FAKE_JPEG.copy(huge, 0);

    const res = await postIdeas(huge, 'huge.jpg', 'image/jpeg');

    expect(res.statusCode).toBe(413);
    expect(parseJson<ErrorBody>(res).error.code).toBe('FILE_TOO_LARGE');
  });

  it('returns 503 when the API key is not configured', async () => {
    const failure = await generateIdeasFromPhoto(TINY_PNG, {
      apiKey: undefined,
      metaApiBase: 'https://api.meta.ai/v1',
      uploadDir: env.uploadDir,
    }).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(AppError);
    expect(failure).toMatchObject({ statusCode: 503, code: 'AI_NOT_CONFIGURED' });
  });

  it('returns three ideas with stored images and serves the files', async () => {
    stubMeta(sparkPayload([sparkIdea(1), sparkIdea(2), sparkIdea(3)]), () => imageB64Response());

    const res = await postIdeas(TINY_PNG);

    expect(res.statusCode).toBe(200);
    const body = parseJson<IdeasSuccessBody>(res);
    expect(body.success).toBe(true);
    const { id, ...sourceFields } = body.data.sourceObject;
    expect(typeof id).toBe('string');
    expect(sourceFields).toEqual({ name: 'Cup', material: 'plastic', condition: 'reusable' });
    expect(body.data.ideas).toHaveLength(3);
    for (const [index, idea] of body.data.ideas.entries()) {
      expect(idea.id).toBe(`idea-${index + 1}`);
      expect(idea.ideaId).toEqual(expect.any(String));
      expect(idea.image.status).toBe('completed');
      expect(idea.image.url).toMatch(/^\/uploads\/generated\/idea-.*\.png$/);
      expect(idea.marketPrice.status).toBe('not_found');
      expect(idea.tutorial.steps.length).toBeGreaterThan(0);
    }
    expect(res.body).not.toContain('Bearer');

    const files = await fs.readdir(`${env.uploadDir}/generated`);
    expect(files.length).toBe(3);

    const firstUrl = body.data.ideas[0]?.image.url ?? '';
    const imageRes = await inject(app, { method: 'GET', url: firstUrl });
    expect(imageRes.statusCode).toBe(200);
    expect(imageRes.headers['content-type']).toContain('image/png');
  });

  it('sends the documented Spark request with image and json_schema', async () => {
    const mock = stubMeta(sparkPayload([sparkIdea(1), sparkIdea(2), sparkIdea(3)]), () =>
      imageB64Response(),
    );

    const res = await postIdeas(FAKE_JPEG, 'cup.jpg', 'image/jpeg');

    expect(res.statusCode).toBe(200);
    const call = mock.mock.calls.find(([input]) => requestUrl(input).endsWith('/responses'));
    const sent: unknown = JSON.parse(typeof call?.[1]?.body === 'string' ? call[1].body : '{}');
    expect(sent).toMatchObject({ model: SPARK_MODEL });
    const raw = JSON.stringify(sent);
    expect(raw).toContain("Don't Trash It");
    expect(raw).toContain('"type":"input_image"');
    expect(raw).toContain('data:image/jpeg;base64,');
    expect(raw).toContain('"type":"json_schema"');
  });

  it('sends each idea with the original photo as edit reference', async () => {
    const mock = stubMeta(sparkPayload([sparkIdea(1), sparkIdea(2), sparkIdea(3)]), () =>
      imageB64Response(),
    );

    const res = await postIdeas(TINY_PNG);

    expect(res.statusCode).toBe(200);
    const editCalls = mock.mock.calls.filter(([input]) =>
      requestUrl(input).endsWith('/images/edits'),
    );
    expect(editCalls).toHaveLength(3);
    for (const [, init] of editCalls) {
      const sent: unknown = JSON.parse(typeof init?.body === 'string' ? init.body : '{}');
      expect(sent).toMatchObject({ model: IMAGE_MODEL });
      expect(JSON.stringify(sent)).toContain('"image_url":"data:image/png;base64,');
    }
  });

  it('downloads url-based images and keeps partial results on failure', async () => {
    stubMeta(sparkPayload([sparkIdea(1), sparkIdea(2), sparkIdea(3)]), (index) => {
      if (index === 0) {
        return { created: 1, data: [{ url: FAKE_CDN_URL }] };
      }
      if (index === 1) {
        return new Error('boom');
      }
      return imageB64Response();
    });

    const res = await postIdeas(TINY_PNG);

    expect(res.statusCode).toBe(200);
    const ideas = parseJson<IdeasSuccessBody>(res).data.ideas;
    expect(ideas[0]?.image.status).toBe('completed');
    expect(ideas[0]?.image.url).toMatch(/\.png$/);
    expect(ideas[1]?.image).toEqual({ url: null, status: 'failed' });
    expect(ideas[2]?.image.status).toBe('completed');
  });

  it('returns 502 on invalid model JSON or wrong idea count', async () => {
    stubMeta({ ...sparkPayload([]), output: undefined, bogus: true }, () => imageB64Response());
    expect((await postIdeas(TINY_PNG)).statusCode).toBe(502);

    stubMeta(sparkPayload([sparkIdea(1), sparkIdea(2)]), () => imageB64Response());
    const res = await postIdeas(TINY_PNG);
    expect(res.statusCode).toBe(502);
    expect(parseJson<ErrorBody>(res).error.code).toBe('AI_UPSTREAM_ERROR');
  });

  it('returns 502 when Meta responds with an error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ error: 'bad' }, 500)),
    );

    const res = await postIdeas(TINY_PNG);

    expect(res.statusCode).toBe(502);
    expect(parseJson<ErrorBody>(res).error.code).toBe('AI_UPSTREAM_ERROR');
  });
});
