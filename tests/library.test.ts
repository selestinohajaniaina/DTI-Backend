import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { inject } from 'light-my-request';
import { GeneratedIdea } from '../src/models/generated-idea.model';
import { SourceObject } from '../src/models/source-object.model';
import { User } from '../src/models/user.model';
import type { StoredMarketPrice } from '../src/models/generated-idea.model';
import { app, demoUser, registerAndGetToken } from './helpers';

interface LibraryIdeaBody {
  id: string;
  title: string;
  description: string;
  intendedUse: string;
  difficulty: string;
  estimatedMinutes: number;
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
  sourceObject: {
    id: string;
    name: string;
    material: string;
    condition: string;
    imageUrl: string | null;
  };
  createdAt: string;
}

interface LibraryPageBody {
  success: boolean;
  data: {
    items: LibraryIdeaBody[];
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

interface SourceObjectsBody {
  success: boolean;
  data: { items: { id: string; name: string; imageUrl: string | null; createdAt: string }[] };
}

const PRICE = {
  status: 'estimated',
  currency: 'MGA',
  estimatedCost: 800,
  estimatedSellingPrice: 3000,
} as const;

async function seedSource(owner: { userId?: string; anonymousOwnerId?: string }, name = 'Cup') {
  return SourceObject.create({
    ownerId: owner.userId ?? null,
    anonymousOwnerId: owner.anonymousOwnerId ?? null,
    imagePath: 'source/cup.png',
    name,
    material: 'plastic',
    condition: 'reusable',
  });
}

async function seedIdea(
  sourceId: string,
  overrides: {
    title?: string;
    description?: string;
    intendedUse?: string;
    difficulty?: string;
    marketPrice?: StoredMarketPrice;
    imagePath?: string | null;
    imageStatus?: string;
    createdAt?: Date;
  } = {},
) {
  return GeneratedIdea.create({
    sourceObjectId: sourceId,
    title: overrides.title ?? 'Idea',
    description: overrides.description ?? 'Description',
    intendedUse: overrides.intendedUse ?? 'Decoration',
    additionalMaterials: ['Paint'],
    tools: ['Brush'],
    difficulty: overrides.difficulty ?? 'Easy',
    estimatedMinutes: 15,
    tutorialSteps: [{ step: 1, title: 'Do', description: 'Do it' }],
    safetyNotes: [],
    imagePath: overrides.imagePath === undefined ? 'generated/idea.png' : overrides.imagePath,
    imageStatus: overrides.imageStatus ?? 'completed',
    marketPrice: overrides.marketPrice ?? { ...PRICE },
    ...(overrides.createdAt === undefined ? {} : { createdAt: overrides.createdAt }),
  });
}

async function seedUser(): Promise<{ id: string; token: string }> {
  const token = await registerAndGetToken();
  const user = await User.findOne({ where: { email: demoUser.email } });
  if (!user) {
    throw new Error('seed user not found');
  }
  return { id: user.id, token };
}

function anonHeaders(id: string): Record<string, string> {
  return { 'x-anonymous-owner-id': id };
}

describe('GET /api/ai/ideas', () => {
  it('returns only the anonymous caller ideas with the full serialized shape', async () => {
    const mine = crypto.randomUUID();
    const other = crypto.randomUUID();
    const source = await seedSource({ anonymousOwnerId: mine }, 'Bottle');
    await seedIdea(source.id, { title: 'Vase' });
    const foreign = await seedSource({ anonymousOwnerId: other }, 'Box');
    await seedIdea(foreign.id, { title: 'Foreign' });

    const res = await inject(app, {
      method: 'GET',
      url: '/api/ai/ideas',
      headers: anonHeaders(mine),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<LibraryPageBody>();
    expect(body.data.total).toBe(1);
    expect(body.data.items.map((item) => item.title)).toEqual(['Vase']);
    const item = body.data.items[0];
    expect(item?.id).toEqual(expect.any(String));
    expect(item?.image).toEqual({ url: '/uploads/generated/idea.png', status: 'completed' });
    expect(item?.marketPrice).toEqual({
      status: 'estimated',
      currency: 'MGA',
      estimatedCost: 800,
      estimatedSellingPrice: 3000,
    });
    expect(item?.tutorial.steps).toEqual([{ step: 1, title: 'Do', description: 'Do it' }]);
    expect(item?.sourceObject).toMatchObject({ id: source.id, name: 'Bottle' });
    expect(item?.sourceObject.imageUrl).toBe('/uploads/source/cup.png');
    expect(Date.parse(item?.createdAt ?? '')).not.toBeNaN();
  });

  it('returns only the authenticated caller ideas', async () => {
    const { id, token } = await seedUser();
    const anon = crypto.randomUUID();
    const mine = await seedSource({ userId: id }, 'Mine');
    await seedIdea(mine.id, { title: 'Mine' });
    const foreign = await seedSource({ anonymousOwnerId: anon }, 'Other');
    await seedIdea(foreign.id, { title: 'Other' });

    const res = await inject(app, {
      method: 'GET',
      url: '/api/ai/ideas',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json<LibraryPageBody>().data.items.map((item) => item.title)).toEqual(['Mine']);
  });

  it('answers an empty page without identity and rejects malformed credentials', async () => {
    const anon = crypto.randomUUID();
    const source = await seedSource({ anonymousOwnerId: anon });
    await seedIdea(source.id);

    const empty = await inject(app, { method: 'GET', url: '/api/ai/ideas?page=2&limit=5' });
    expect(empty.statusCode).toBe(200);
    expect(empty.json<LibraryPageBody>().data).toEqual({
      items: [],
      page: 2,
      limit: 5,
      total: 0,
      totalPages: 0,
    });

    const malformed = await inject(app, {
      method: 'GET',
      url: '/api/ai/ideas',
      headers: anonHeaders('not-a-uuid'),
    });
    expect(malformed.statusCode).toBe(400);

    const badToken = await inject(app, {
      method: 'GET',
      url: '/api/ai/ideas',
      headers: { authorization: 'Bearer invalid' },
    });
    expect(badToken.statusCode).toBe(401);
  });

  it('paginates with totals and handles out-of-range pages', async () => {
    const anon = crypto.randomUUID();
    const source = await seedSource({ anonymousOwnerId: anon });
    await seedIdea(source.id, { title: 'One' });
    await seedIdea(source.id, { title: 'Two' });
    await seedIdea(source.id, { title: 'Three' });

    const first = await inject(app, {
      method: 'GET',
      url: '/api/ai/ideas?limit=2&page=1',
      headers: anonHeaders(anon),
    });
    expect(first.json<LibraryPageBody>().data).toMatchObject({
      page: 1,
      limit: 2,
      total: 3,
      totalPages: 2,
    });
    expect(first.json<LibraryPageBody>().data.items).toHaveLength(2);

    const second = await inject(app, {
      method: 'GET',
      url: '/api/ai/ideas?limit=2&page=2',
      headers: anonHeaders(anon),
    });
    expect(second.json<LibraryPageBody>().data.items).toHaveLength(1);

    const beyond = await inject(app, {
      method: 'GET',
      url: '/api/ai/ideas?limit=2&page=9',
      headers: anonHeaders(anon),
    });
    const beyondBody = beyond.json<LibraryPageBody>();
    expect(beyondBody.data.items).toHaveLength(0);
    expect(beyondBody.data.total).toBe(3);
  });

  it('rejects invalid query parameters', async () => {
    const anon = crypto.randomUUID();
    const headers = anonHeaders(anon);
    for (const url of [
      '/api/ai/ideas?page=0',
      '/api/ai/ideas?limit=0',
      '/api/ai/ideas?limit=51',
      '/api/ai/ideas?sort=bogus',
      '/api/ai/ideas?difficulty=Extreme',
      '/api/ai/ideas?sourceObjectId=nope',
      '/api/ai/ideas?hasPrice=yes',
    ]) {
      const res = await inject(app, { method: 'GET', url, headers });
      expect(res.statusCode).toBe(400);
    }
  });

  it('searches titles, descriptions, uses and source names case-insensitively', async () => {
    const anon = crypto.randomUUID();
    const bottle = await seedSource({ anonymousOwnerId: anon }, 'Glass Bottle');
    await seedIdea(bottle.id, { title: 'Garden Lantern', intendedUse: 'Lighting' });
    await seedIdea(bottle.id, {
      title: 'Planter',
      description: 'Holds kitchen herbs nicely',
      intendedUse: 'Gardening',
    });

    const byTitle = await inject(app, {
      method: 'GET',
      url: '/api/ai/ideas?q=lantern',
      headers: anonHeaders(anon),
    });
    expect(byTitle.json<LibraryPageBody>().data.items.map((i) => i.title)).toEqual([
      'Garden Lantern',
    ]);

    const byDescription = await inject(app, {
      method: 'GET',
      url: `/api/ai/ideas?q=${encodeURIComponent('KITCHEN herbs')}`,
      headers: anonHeaders(anon),
    });
    expect(byDescription.json<LibraryPageBody>().data.items.map((i) => i.title)).toEqual([
      'Planter',
    ]);

    const bySource = await inject(app, {
      method: 'GET',
      url: '/api/ai/ideas?q=glass',
      headers: anonHeaders(anon),
    });
    expect(bySource.json<LibraryPageBody>().data.total).toBe(2);

    const missing = await inject(app, {
      method: 'GET',
      url: '/api/ai/ideas?q=spaceship',
      headers: anonHeaders(anon),
    });
    expect(missing.json<LibraryPageBody>().data.total).toBe(0);
  });

  it('treats LIKE wildcards in search text literally', async () => {
    const anon = crypto.randomUUID();
    const source = await seedSource({ anonymousOwnerId: anon });
    await seedIdea(source.id, { title: '100% wool rug' });
    await seedIdea(source.id, { title: 'Plain mat' });

    const res = await inject(app, {
      method: 'GET',
      url: `/api/ai/ideas?q=${encodeURIComponent('100%')}`,
      headers: anonHeaders(anon),
    });
    expect(res.json<LibraryPageBody>().data.items.map((i) => i.title)).toEqual(['100% wool rug']);
  });

  it('filters by difficulty and source object without leaking foreign rows', async () => {
    const anon = crypto.randomUUID();
    const other = crypto.randomUUID();
    const mine = await seedSource({ anonymousOwnerId: anon }, 'Mine');
    await seedIdea(mine.id, { title: 'Easy one', difficulty: 'Easy' });
    await seedIdea(mine.id, { title: 'Hard one', difficulty: 'Hard' });
    const foreign = await seedSource({ anonymousOwnerId: other }, 'Foreign');
    await seedIdea(foreign.id, { title: 'Foreign', difficulty: 'Hard' });

    const hard = await inject(app, {
      method: 'GET',
      url: '/api/ai/ideas?difficulty=Hard',
      headers: anonHeaders(anon),
    });
    expect(hard.json<LibraryPageBody>().data.items.map((i) => i.title)).toEqual(['Hard one']);

    const foreignSource = await inject(app, {
      method: 'GET',
      url: `/api/ai/ideas?sourceObjectId=${foreign.id}`,
      headers: anonHeaders(anon),
    });
    expect(foreignSource.json<LibraryPageBody>().data.total).toBe(0);

    const combined = await inject(app, {
      method: 'GET',
      url: `/api/ai/ideas?difficulty=Easy&q=one&sourceObjectId=${mine.id}`,
      headers: anonHeaders(anon),
    });
    expect(combined.json<LibraryPageBody>().data.items.map((i) => i.title)).toEqual(['Easy one']);
  });

  it('filters by price availability across stored shapes', async () => {
    const anon = crypto.randomUUID();
    const source = await seedSource({ anonymousOwnerId: anon });
    await seedIdea(source.id, { title: 'Priced' });
    await seedIdea(source.id, {
      title: 'Unpriced',
      marketPrice: {
        status: 'estimated',
        currency: 'MGA',
        estimatedCost: null,
        estimatedSellingPrice: null,
      },
    });
    await seedIdea(source.id, {
      title: 'Legacy',
      marketPrice: {
        status: 'not_found',
        amount: null,
        currency: null,
        sourceUrl: null,
        listingTitle: null,
      },
    });

    const withPrice = await inject(app, {
      method: 'GET',
      url: '/api/ai/ideas?hasPrice=true',
      headers: anonHeaders(anon),
    });
    expect(withPrice.json<LibraryPageBody>().data.items.map((i) => i.title)).toEqual(['Priced']);

    const withoutPrice = await inject(app, {
      method: 'GET',
      url: '/api/ai/ideas?hasPrice=false',
      headers: anonHeaders(anon),
    });
    expect(
      withoutPrice
        .json<LibraryPageBody>()
        .data.items.map((i) => i.title)
        .sort(),
    ).toEqual(['Legacy', 'Unpriced']);
  });

  it('sorts by date, title and price with nulls last', async () => {
    const anon = crypto.randomUUID();
    const source = await seedSource({ anonymousOwnerId: anon });
    await seedIdea(source.id, {
      title: 'banana',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      marketPrice: {
        status: 'estimated',
        currency: 'MGA',
        estimatedCost: 100,
        estimatedSellingPrice: 500,
      },
    });
    await seedIdea(source.id, {
      title: 'Apple',
      createdAt: new Date('2026-02-01T00:00:00.000Z'),
      marketPrice: {
        status: 'estimated',
        currency: 'MGA',
        estimatedCostMGA: 1000,
        estimatedSellingPriceMGA: 5000,
      } as unknown as StoredMarketPrice,
    });
    await seedIdea(source.id, {
      title: 'cherry',
      createdAt: new Date('2026-03-01T00:00:00.000Z'),
      marketPrice: {
        status: 'estimated',
        currency: 'MGA',
        estimatedCost: null,
        estimatedSellingPrice: null,
      },
    });

    const titles = async (sort: string): Promise<string[]> => {
      const res = await inject(app, {
        method: 'GET',
        url: `/api/ai/ideas?sort=${sort}`,
        headers: anonHeaders(anon),
      });
      return res.json<LibraryPageBody>().data.items.map((i) => i.title);
    };

    expect(await titles('newest')).toEqual(['cherry', 'Apple', 'banana']);
    expect(await titles('oldest')).toEqual(['banana', 'Apple', 'cherry']);
    expect(await titles('title')).toEqual(['Apple', 'banana', 'cherry']);
    expect(await titles('priceAsc')).toEqual(['banana', 'Apple', 'cherry']);
    expect(await titles('priceDesc')).toEqual(['Apple', 'banana', 'cherry']);
  });

  it('normalizes legacy stored prices in list output', async () => {
    const anon = crypto.randomUUID();
    const source = await seedSource({ anonymousOwnerId: anon });
    await seedIdea(source.id, {
      title: 'Legacy',
      marketPrice: {
        status: 'not_found',
        amount: null,
        currency: null,
        sourceUrl: null,
        listingTitle: null,
      },
    });

    const res = await inject(app, {
      method: 'GET',
      url: '/api/ai/ideas',
      headers: anonHeaders(anon),
    });
    expect(res.json<LibraryPageBody>().data.items[0]?.marketPrice).toEqual({
      status: 'estimated',
      currency: 'MGA',
      estimatedCost: null,
      estimatedSellingPrice: null,
    });
  });

  it('serializes missing images as null with failed status', async () => {
    const anon = crypto.randomUUID();
    const source = await seedSource({ anonymousOwnerId: anon });
    await seedIdea(source.id, { imagePath: null, imageStatus: 'failed' });

    const res = await inject(app, {
      method: 'GET',
      url: '/api/ai/ideas',
      headers: anonHeaders(anon),
    });
    expect(res.json<LibraryPageBody>().data.items[0]?.image).toEqual({
      url: null,
      status: 'failed',
    });
  });
});

describe('GET /api/ai/source-objects', () => {
  it('returns only the caller source objects', async () => {
    const mine = crypto.randomUUID();
    const other = crypto.randomUUID();
    await seedSource({ anonymousOwnerId: mine }, 'Mine');
    await seedSource({ anonymousOwnerId: other }, 'Other');

    const res = await inject(app, {
      method: 'GET',
      url: '/api/ai/source-objects',
      headers: anonHeaders(mine),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<SourceObjectsBody>();
    expect(body.data.items.map((item) => item.name)).toEqual(['Mine']);
    expect(body.data.items[0]?.imageUrl).toBe('/uploads/source/cup.png');
  });

  it('answers an empty list without identity and rejects malformed ids', async () => {
    const empty = await inject(app, { method: 'GET', url: '/api/ai/source-objects' });
    expect(empty.statusCode).toBe(200);
    expect(empty.json<SourceObjectsBody>().data).toEqual({ items: [] });

    const malformed = await inject(app, {
      method: 'GET',
      url: '/api/ai/source-objects',
      headers: anonHeaders('nope'),
    });
    expect(malformed.statusCode).toBe(400);
  });
});
