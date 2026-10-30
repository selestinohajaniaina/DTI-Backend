import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { inject } from 'light-my-request';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { env } from '../src/config/env';
import { SPARK_MODEL } from '../src/services/ideas.service';
import { signAccessToken } from '../src/utils/jwt';
import { GeneratedIdea, normalizeStoredMarketPrice } from '../src/models/generated-idea.model';
import type { StoredMarketPrice } from '../src/models/generated-idea.model';
import { SourceObject } from '../src/models/source-object.model';
import { app, parseJson, registerAndGetToken } from './helpers';

interface PersistBody {
  success: boolean;
  data: {
    sourceObject: { id: string; name: string; material: string; condition: string };
    ideas: {
      id: string;
      ideaId: string;
      title: string;
      image: { url: string | null; status: string };
      marketPrice: {
        status: string;
        currency: string;
        estimatedCost: number | null;
        estimatedSellingPrice: number | null;
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

const BOUNDARY = '----dti-persist-boundary';
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);
const ANON_ID = '123e4567-e89b-12d3-a456-426614174000';

function sparkBody(ideaIndexes: number[] = [1, 2, 3]): Record<string, unknown> {
  const text = JSON.stringify({
    sourceObject: { name: 'Cup', material: 'plastic', condition: 'reusable' },
    ideas: ideaIndexes.map((index) => ({
      title: `Idea ${index}`,
      description: `Description ${index}`,
      intendedUse: `Use ${index}`,
      additionalMaterials: ['Paint'],
      tools: ['Brush'],
      difficulty: 'Easy',
      estimatedMinutes: 15,
      tutorialSteps: [{ step: 1, title: 'Do it', description: 'Do it well.' }],
      safetyNotes: ['Wear gloves'],
      imagePrompt: `Finished upcycled object ${index}, product photo`,
      priceEstimate: {
        estimatedCost: 1.5 * index,
        estimatedSellingPrice: 8 * index,
      },
    })),
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

function imageBody(): Record<string, unknown> {
  return { created: 1, data: [{ b64_json: TINY_PNG.toString('base64') }] };
}

function requestUrl(input: string | URL | Request): string {
  if (typeof input === 'string') {
    return input;
  }
  return input instanceof URL ? input.toString() : input.url;
}

function stubMeta(
  imageBehavior: (callIndex: number) => unknown,
  ideaIndexes: number[] = [1, 2, 3],
): void {
  let imageCalls = 0;
  const mock = vi.fn<typeof fetch>().mockImplementation((input) => {
    const url = requestUrl(input);
    if (url.endsWith('/responses')) {
      return Promise.resolve(
        new Response(JSON.stringify(sparkBody(ideaIndexes)), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    }
    const current = imageCalls;
    imageCalls += 1;
    const behavior = imageBehavior(current);
    if (behavior instanceof Error) {
      return Promise.reject(behavior);
    }
    return Promise.resolve(
      new Response(JSON.stringify(behavior), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  });
  vi.stubGlobal('fetch', mock);
}

function postPhoto(headers: Record<string, string> = {}) {
  const head =
    `--${BOUNDARY}\r\n` +
    'Content-Disposition: form-data; name="image"; filename="cup.png"\r\n' +
    'Content-Type: image/png\r\n\r\n';
  const tail = `\r\n--${BOUNDARY}--\r\n`;
  return inject(app, {
    method: 'POST',
    url: '/api/ai/generate-ideas',
    headers: { 'content-type': `multipart/form-data; boundary=${BOUNDARY}`, ...headers },
    payload: Buffer.concat([Buffer.from(head, 'utf8'), TINY_PNG, Buffer.from(tail, 'utf8')]),
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

afterAll(async () => {
  // Generated files are asserted per test; remove the directory so later
  // test files start from a clean upload folder.
  await fs.rm(env.uploadDir, { recursive: true, force: true });
});

describe('POST /api/ai/generate-ideas persistence', () => {
  it('stores one source object and exactly three linked ideas for anonymous callers', async () => {
    stubMeta(() => imageBody());

    const res = await postPhoto();

    expect(res.statusCode).toBe(200);
    const body = parseJson<PersistBody>(res);
    expect(body.data.anonymousOwnerId).toEqual(expect.any(String));

    const sources = await SourceObject.findAll();
    expect(sources).toHaveLength(1);
    const source = sources[0];
    expect(source?.id).toBe(body.data.sourceObject.id);
    expect(source?.ownerId).toBeNull();
    expect(source?.anonymousOwnerId).toBe(body.data.anonymousOwnerId);
    expect(source?.name).toBe('Cup');
    expect(source?.material).toBe('plastic');
    expect(source?.condition).toBe('reusable');
    expect(source?.imagePath).toMatch(/^source\/source-.*\.png$/);

    const ideas = await GeneratedIdea.findAll({ order: [['createdAt', 'ASC']] });
    expect(ideas).toHaveLength(3);
    for (const idea of ideas) {
      expect(idea.sourceObjectId).toBe(source?.id);
    }
    expect(ideas.map((idea) => idea.id).sort()).toEqual(
      body.data.ideas.map((idea) => idea.ideaId).sort(),
    );
    const first = ideas[0];
    expect(first?.title).toBe('Idea 1');
    expect(first?.additionalMaterials).toEqual(['Paint']);
    expect(first?.tools).toEqual(['Brush']);
    expect(first?.tutorialSteps).toEqual([{ step: 1, title: 'Do it', description: 'Do it well.' }]);
    expect(first?.safetyNotes).toEqual(['Wear gloves']);
    expect(first?.marketPrice).toEqual({
      status: 'estimated',
      currency: 'USD',
      estimatedCost: 1.5,
      estimatedSellingPrice: 8,
    });
    expect(first?.imageStatus).toBe('completed');
    expect(first?.imagePath).toMatch(/^generated\/idea-.*\.png$/);

    // Storage keys resolve to real files under the upload directory.
    await expect(fs.stat(`${env.uploadDir}/${source?.imagePath}`)).resolves.toBeDefined();
    await expect(fs.stat(`${env.uploadDir}/${first?.imagePath}`)).resolves.toBeDefined();
  });

  it('reuses a valid presented anonymous id across requests', async () => {
    stubMeta(() => imageBody());

    const first = parseJson<PersistBody>(await postPhoto({ 'x-anonymous-owner-id': ANON_ID }));
    const second = parseJson<PersistBody>(await postPhoto({ 'x-anonymous-owner-id': ANON_ID }));

    expect(first.data.anonymousOwnerId).toBe(ANON_ID);
    expect(second.data.anonymousOwnerId).toBe(ANON_ID);
    expect(first.data.sourceObject.id).not.toBe(second.data.sourceObject.id);
    const sources = await SourceObject.findAll();
    expect(sources).toHaveLength(2);
    expect(sources.every((source) => source.anonymousOwnerId === ANON_ID)).toBe(true);
  });

  it('rejects a malformed anonymous id without persisting anything', async () => {
    stubMeta(() => imageBody());

    const res = await postPhoto({ 'x-anonymous-owner-id': 'not-a-uuid' });

    expect(res.statusCode).toBe(400);
    expect(parseJson<ErrorBody>(res).error.code).toBe('VALIDATION_ERROR');
    expect(await SourceObject.count()).toBe(0);
    expect(await GeneratedIdea.count()).toBe(0);
  });

  it('records the verified user as owner for authenticated callers', async () => {
    stubMeta(() => imageBody());
    const token = await registerAndGetToken();

    const res = await postPhoto({ authorization: `Bearer ${token}` });

    expect(res.statusCode).toBe(200);
    const body = parseJson<PersistBody>(res);
    expect(body.data.anonymousOwnerId).toBeNull();
    const sources = await SourceObject.findAll();
    expect(sources).toHaveLength(1);
    expect(sources[0]?.ownerId).toEqual(expect.any(String));
    expect(sources[0]?.anonymousOwnerId).toBeNull();
  });

  it('ignores the anonymous header when a valid user token is sent', async () => {
    stubMeta(() => imageBody());
    const token = await registerAndGetToken();

    const res = await postPhoto({
      authorization: `Bearer ${token}`,
      'x-anonymous-owner-id': ANON_ID,
    });

    expect(res.statusCode).toBe(200);
    expect(parseJson<PersistBody>(res).data.anonymousOwnerId).toBeNull();
    const sources = await SourceObject.findAll();
    expect(sources).toHaveLength(1);
    expect(sources[0]?.ownerId).not.toBeNull();
    expect(sources[0]?.anonymousOwnerId).toBeNull();
  });

  it('rejects invalid bearer tokens instead of treating them as anonymous', async () => {
    stubMeta(() => imageBody());

    const res = await postPhoto({ authorization: 'Bearer invalid-token' });

    expect(res.statusCode).toBe(401);
    expect(await SourceObject.count()).toBe(0);
  });

  it('rolls back the whole generation when persistence fails', async () => {
    stubMeta(() => imageBody());
    // Structurally valid token for a user that does not exist: the
    // owner_id foreign key rejects the insert inside the transaction.
    const forged = signAccessToken({ sub: crypto.randomUUID(), email: 'ghost@example.com' });

    const res = await postPhoto({ authorization: `Bearer ${forged}` });

    expect(res.statusCode).toBe(500);
    expect(parseJson<ErrorBody>(res).error.code).toBe('INTERNAL_ERROR');
    expect(await SourceObject.count()).toBe(0);
    expect(await GeneratedIdea.count()).toBe(0);
  });

  it('still stores ideas whose image generation failed, with a null image path', async () => {
    stubMeta((index) => (index === 1 ? new Error('boom') : imageBody()));

    const res = await postPhoto();

    expect(res.statusCode).toBe(200);
    const ideas = await GeneratedIdea.findAll();
    expect(ideas).toHaveLength(3);
    const failed = ideas.filter((idea) => idea.imageStatus === 'failed');
    const completed = ideas.filter((idea) => idea.imageStatus === 'completed');
    expect(failed).toHaveLength(1);
    expect(completed).toHaveLength(2);
    expect(failed[0]?.imagePath).toBeNull();
    expect(completed.every((idea) => idea.imagePath !== null)).toBe(true);
  });

  it('persists a variable number of ideas with their images', async () => {
    stubMeta((index) => (index === 3 ? new Error('boom') : imageBody()), [1, 2, 3, 4, 5]);

    const res = await postPhoto();

    expect(res.statusCode).toBe(200);
    const body = parseJson<PersistBody>(res);
    expect(body.data.ideas).toHaveLength(5);
    const ideas = await GeneratedIdea.findAll({ order: [['createdAt', 'ASC']] });
    expect(ideas).toHaveLength(5);
    expect(ideas.map((idea) => idea.title)).toEqual([
      'Idea 1',
      'Idea 2',
      'Idea 3',
      'Idea 4',
      'Idea 5',
    ]);
    // One image failed: its row is kept with a null path, the rest completed.
    expect(ideas.filter((idea) => idea.imageStatus === 'failed')).toHaveLength(1);
    expect(ideas.filter((idea) => idea.imageStatus === 'completed')).toHaveLength(4);
    const files = await fs.readdir(`${env.uploadDir}/generated`);
    expect(files.length).toBeGreaterThanOrEqual(4);
  });

  it('keeps rows written with the legacy price shape readable', async () => {
    const source = await SourceObject.create({
      ownerId: null,
      anonymousOwnerId: crypto.randomUUID(),
      imagePath: 'source/legacy.png',
      name: 'Cup',
      material: 'plastic',
      condition: 'reusable',
    });
    await GeneratedIdea.create({
      sourceObjectId: source.id,
      title: 'Legacy idea',
      description: 'Stored before AI estimation.',
      intendedUse: 'Decoration',
      additionalMaterials: [],
      tools: [],
      difficulty: 'Easy',
      estimatedMinutes: 10,
      tutorialSteps: [],
      safetyNotes: [],
      imagePath: null,
      imageStatus: 'failed',
      marketPrice: {
        status: 'not_found',
        amount: null,
        currency: null,
        sourceUrl: null,
        listingTitle: null,
      },
    });

    const stored = await GeneratedIdea.findOne({ where: { sourceObjectId: source.id } });

    expect(stored?.marketPrice).toEqual({
      status: 'not_found',
      amount: null,
      currency: null,
      sourceUrl: null,
      listingTitle: null,
    });
    expect(normalizeStoredMarketPrice(stored?.marketPrice)).toEqual({
      status: 'estimated',
      currency: 'USD',
      estimatedCost: null,
      estimatedSellingPrice: null,
    });
  });

  it('degrades unmigrated MGA rows to empty estimates instead of mislabeling them', async () => {
    const source = await SourceObject.create({
      ownerId: null,
      anonymousOwnerId: crypto.randomUUID(),
      imagePath: 'source/mga-unmigrated.png',
      name: 'Cup',
      material: 'plastic',
      condition: 'reusable',
    });
    await GeneratedIdea.create({
      sourceObjectId: source.id,
      title: 'Unmigrated MGA idea',
      description: 'Stored before the USD switch on a database that skipped the migration.',
      intendedUse: 'Decoration',
      additionalMaterials: [],
      tools: [],
      difficulty: 'Easy',
      estimatedMinutes: 10,
      tutorialSteps: [],
      safetyNotes: [],
      imagePath: null,
      imageStatus: 'failed',
      marketPrice: {
        status: 'estimated',
        currency: 'MGA',
        estimatedCost: 800,
        estimatedSellingPrice: 3000,
      } as unknown as StoredMarketPrice,
    });

    const stored = await GeneratedIdea.findOne({ where: { sourceObjectId: source.id } });

    expect(stored?.marketPrice).toEqual({
      status: 'estimated',
      currency: 'MGA',
      estimatedCost: 800,
      estimatedSellingPrice: 3000,
    });
    // Ariary amounts must never surface as dollars.
    expect(normalizeStoredMarketPrice(stored?.marketPrice)).toEqual({
      status: 'estimated',
      currency: 'USD',
      estimatedCost: null,
      estimatedSellingPrice: null,
    });
  });

  it('keeps canonical USD rows readable with decimals preserved', async () => {
    const source = await SourceObject.create({
      ownerId: null,
      anonymousOwnerId: crypto.randomUUID(),
      imagePath: 'source/usd.png',
      name: 'Cup',
      material: 'plastic',
      condition: 'reusable',
    });
    await GeneratedIdea.create({
      sourceObjectId: source.id,
      title: 'USD idea',
      description: 'Stored after the USD switch.',
      intendedUse: 'Decoration',
      additionalMaterials: [],
      tools: [],
      difficulty: 'Easy',
      estimatedMinutes: 10,
      tutorialSteps: [],
      safetyNotes: [],
      imagePath: null,
      imageStatus: 'failed',
      marketPrice: {
        status: 'estimated',
        currency: 'USD',
        estimatedCost: 2.5,
        estimatedSellingPrice: 8,
      },
    });

    const stored = await GeneratedIdea.findOne({ where: { sourceObjectId: source.id } });

    expect(stored?.marketPrice).toEqual({
      status: 'estimated',
      currency: 'USD',
      estimatedCost: 2.5,
      estimatedSellingPrice: 8,
    });
    expect(normalizeStoredMarketPrice(stored?.marketPrice)).toEqual({
      status: 'estimated',
      currency: 'USD',
      estimatedCost: 2.5,
      estimatedSellingPrice: 8,
    });
  });

  it('normalizes malformed stored prices to null estimates without throwing', () => {
    const empty = {
      status: 'estimated',
      currency: 'USD',
      estimatedCost: null,
      estimatedSellingPrice: null,
    };
    expect(normalizeStoredMarketPrice(null)).toEqual(empty);
    expect(normalizeStoredMarketPrice(undefined)).toEqual(empty);
    expect(normalizeStoredMarketPrice('garbage')).toEqual(empty);
    expect(normalizeStoredMarketPrice({})).toEqual(empty);
    expect(
      normalizeStoredMarketPrice({ estimatedCost: -5, estimatedSellingPrice: 'much' }),
    ).toEqual(empty);
  });

  it('refuses records without exactly one ownership mechanism', async () => {
    await expect(
      SourceObject.create({
        ownerId: null,
        anonymousOwnerId: null,
        imagePath: 'source/x.png',
        name: 'Cup',
        material: 'plastic',
        condition: 'reusable',
      }),
    ).rejects.toThrow();

    await expect(
      SourceObject.create({
        ownerId: crypto.randomUUID(),
        anonymousOwnerId: crypto.randomUUID(),
        imagePath: 'source/x.png',
        name: 'Cup',
        material: 'plastic',
        condition: 'reusable',
      }),
    ).rejects.toThrow();

    expect(await SourceObject.count()).toBe(0);
  });
});
