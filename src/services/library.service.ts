import { Op, col, fn, literal, where as sequelizeWhere } from 'sequelize';
import type { Order, WhereOptions } from 'sequelize';
import type { GenerationOwnership } from '../types/ownership';
import type { ListIdeasQuery } from '../validators/library.validator';
import {
  GeneratedIdea,
  normalizeStoredMarketPrice,
  type NormalizedMarketPrice,
  type StoredTutorialStep,
} from '../models/generated-idea.model';
import { SourceObject } from '../models/source-object.model';
import { UPLOADS_URL_PREFIX } from './ideas.service';

/** Cap for the source-object filter options (no pagination on that endpoint). */
const SOURCE_OBJECTS_LIMIT = 100;

export interface LibrarySourceObject {
  id: string;
  name: string;
  material: string;
  condition: string;
  imageUrl: string | null;
}

export interface LibraryIdeaTutorialStep {
  step: number;
  title: string;
  description: string;
}

export interface LibraryIdea {
  id: string;
  title: string;
  description: string;
  intendedUse: string;
  difficulty: string;
  estimatedMinutes: number;
  image: { url: string | null; status: 'completed' | 'failed' };
  marketPrice: NormalizedMarketPrice;
  tutorial: {
    materials: string[];
    tools: string[];
    steps: LibraryIdeaTutorialStep[];
    safetyNotes: string[];
  };
  sourceObject: LibrarySourceObject;
  createdAt: string;
}

export interface LibraryPage {
  items: LibraryIdea[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface SourceObjectSummary {
  id: string;
  name: string;
  imageUrl: string | null;
  createdAt: string;
}

/** Escape LIKE wildcards so user search text matches literally. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/**
 * Numeric selling price across every stored marketPrice shape (canonical,
 * MGA-suffixed, USD-suffixed). Text extraction (`->>`) maps both missing
 * keys and explicit JSON nulls to SQL NULL. Contains no user input: the
 * surrounding query only appends a whitelisted direction.
 */
const PRICE_EXPRESSION = `COALESCE("marketPrice"->>'estimatedSellingPrice',"marketPrice"->>'estimatedSellingPriceMGA',"marketPrice"->>'estimatedSellingPriceUSD')::numeric`;

function ownerWhere(ownership: GenerationOwnership): WhereOptions {
  return ownership.kind === 'user'
    ? { ownerId: ownership.userId }
    : { anonymousOwnerId: ownership.anonymousOwnerId };
}

function toImageUrl(imagePath: string | null): string | null {
  return imagePath === null ? null : `${UPLOADS_URL_PREFIX}${imagePath}`;
}

function toTutorialStep(step: StoredTutorialStep): LibraryIdeaTutorialStep {
  return { step: step.step, title: step.title, description: step.description };
}

function toLibraryIdea(row: GeneratedIdea & { SourceObject?: SourceObject | null }): LibraryIdea {
  const source = row.SourceObject;
  if (!source) {
    throw new Error('Library query must include the source object');
  }
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    intendedUse: row.intendedUse,
    difficulty: row.difficulty,
    estimatedMinutes: row.estimatedMinutes,
    image: {
      url: toImageUrl(row.imagePath),
      status: row.imageStatus === 'failed' ? 'failed' : 'completed',
    },
    marketPrice: normalizeStoredMarketPrice(row.marketPrice),
    tutorial: {
      materials: [...row.additionalMaterials],
      tools: [...row.tools],
      steps: row.tutorialSteps.map(toTutorialStep),
      safetyNotes: [...row.safetyNotes],
    },
    sourceObject: {
      id: source.id,
      name: source.name,
      material: source.material,
      condition: source.condition,
      imageUrl: toImageUrl(source.imagePath),
    },
    createdAt: row.createdAt.toISOString(),
  };
}

function toOrder(sort: ListIdeasQuery['sort']): Order {
  // A stable id tiebreak keeps pages deterministic for equal sort keys.
  switch (sort) {
    case 'oldest':
      return [
        ['createdAt', 'ASC'],
        ['id', 'ASC'],
      ];
    case 'title':
      return [
        [fn('lower', col('title')), 'ASC'],
        ['id', 'ASC'],
      ];
    case 'priceAsc':
      return [literal(`${PRICE_EXPRESSION} ASC NULLS LAST`), ['id', 'ASC']];
    case 'priceDesc':
      return [literal(`${PRICE_EXPRESSION} DESC NULLS LAST`), ['id', 'ASC']];
    case 'newest':
    default:
      return [
        ['createdAt', 'DESC'],
        ['id', 'DESC'],
      ];
  }
}

export function emptyLibraryPage(page: number, limit: number): LibraryPage {
  return { items: [], page, limit, total: 0, totalPages: 0 };
}

/**
 * Paginated ideas owned by the caller, newest first by default. Ownership is
 * enforced by scoping the joined source objects: ids belonging to other
 * owners simply match nothing (no existence leak).
 */
export async function listIdeasByOwner(
  ownership: GenerationOwnership,
  query: ListIdeasQuery,
): Promise<LibraryPage> {
  const search = query.q === undefined || query.q.length === 0 ? undefined : query.q;
  const pattern = search === undefined ? undefined : `%${escapeLike(search)}%`;
  const where: WhereOptions = {
    ...(query.difficulty === undefined ? {} : { difficulty: query.difficulty }),
    ...(query.hasPrice === undefined
      ? {}
      : {
          [Op.and]: [
            sequelizeWhere(literal(PRICE_EXPRESSION), query.hasPrice ? Op.ne : Op.eq, null),
          ],
        }),
    ...(pattern === undefined
      ? {}
      : {
          [Op.or]: [
            { title: { [Op.iLike]: pattern } },
            { description: { [Op.iLike]: pattern } },
            { intendedUse: { [Op.iLike]: pattern } },
            { '$SourceObject.name$': { [Op.iLike]: pattern } },
          ],
        }),
  };
  // BelongsTo include: no row multiplication, so a single query with LIMIT is
  // correct (subQuery:false) and the count stays exact with distinct:true.
  const { rows, count } = await GeneratedIdea.findAndCountAll({
    where,
    include: [
      {
        model: SourceObject,
        required: true,
        attributes: ['id', 'name', 'material', 'condition', 'imagePath'],
        where: {
          ...ownerWhere(ownership),
          ...(query.sourceObjectId === undefined ? {} : { id: query.sourceObjectId }),
        },
      },
    ],
    order: toOrder(query.sort),
    limit: query.limit,
    offset: (query.page - 1) * query.limit,
    distinct: true,
    subQuery: false,
  });
  const total = count;
  return {
    items: rows.map((row) => toLibraryIdea(row as GeneratedIdea & { SourceObject: SourceObject })),
    page: query.page,
    limit: query.limit,
    total,
    totalPages: total === 0 ? 0 : Math.ceil(total / query.limit),
  };
}

/** Source objects owned by the caller, for the library filter options. */
export async function listSourceObjects(
  ownership: GenerationOwnership,
): Promise<SourceObjectSummary[]> {
  const rows = await SourceObject.findAll({
    where: ownerWhere(ownership),
    attributes: ['id', 'name', 'imagePath', 'createdAt'],
    order: [
      ['createdAt', 'DESC'],
      ['id', 'DESC'],
    ],
    limit: SOURCE_OBJECTS_LIMIT,
  });
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    imageUrl: toImageUrl(row.imagePath),
    createdAt: row.createdAt.toISOString(),
  }));
}

export async function listIdeas(
  query: ListIdeasQuery,
  ownership?: GenerationOwnership,
): Promise<LibraryPage> {
  const search = query.q === undefined || query.q.length === 0 ? undefined : query.q;
  const pattern = search === undefined ? undefined : `%${escapeLike(search)}%`;
  const where: WhereOptions = {
    ...(query.difficulty === undefined ? {} : { difficulty: query.difficulty }),
    ...(query.hasPrice === undefined
      ? {}
      : {
          [Op.and]: [
            sequelizeWhere(literal(PRICE_EXPRESSION), query.hasPrice ? Op.ne : Op.eq, null),
          ],
        }),
    ...(pattern === undefined
      ? {}
      : {
          [Op.or]: [
            { title: { [Op.iLike]: pattern } },
            { description: { [Op.iLike]: pattern } },
            { intendedUse: { [Op.iLike]: pattern } },
            { '$SourceObject.name$': { [Op.iLike]: pattern } },
          ],
        }),
  };

  const sourceObjectWhere: WhereOptions = {
    ...(ownership === undefined ? {} : ownerWhere(ownership)),
    ...(query.sourceObjectId === undefined ? {} : { id: query.sourceObjectId }),
  };

  const { rows, count } = await GeneratedIdea.findAndCountAll({
    where,
    include: [
      {
        model: SourceObject,
        required: true,
        attributes: ['id', 'name', 'material', 'condition', 'imagePath'],
        where: sourceObjectWhere,
      },
    ],
    order: toOrder(query.sort),
    limit: query.limit,
    offset: (query.page - 1) * query.limit,
    distinct: true,
    subQuery: false,
  });

  return {
    items: rows.map((row) => toLibraryIdea(row as GeneratedIdea & { SourceObject: SourceObject })),
    page: query.page,
    limit: query.limit,
    total: count,
    totalPages: count === 0 ? 0 : Math.ceil(count / query.limit),
  };
}