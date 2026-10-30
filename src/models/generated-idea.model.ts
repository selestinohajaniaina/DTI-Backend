import { DataTypes, Model } from 'sequelize';
import type {
  CreationOptional,
  InferAttributes,
  InferCreationAttributes,
  Sequelize,
} from 'sequelize';

/** JSON shapes stored in JSONB columns (kept local: models never import services). */
export interface StoredTutorialStep {
  step: number;
  title: string;
  description: string;
}

/** Canonical shape: every new write uses this (see README). */
export interface StoredMarketPriceEstimate {
  status: 'estimated';
  currency: 'USD';
  estimatedCost: number | null;
  estimatedSellingPrice: number | null;
}

/** Legacy shape written before AI estimation; old rows remain readable. */
export interface StoredMarketPriceLegacy {
  status: 'not_found';
  amount: null;
  currency: null;
  sourceUrl: null;
  listingTitle: null;
}

export type StoredMarketPrice = StoredMarketPriceEstimate | StoredMarketPriceLegacy;

/**
 * Pre-conversion archive row: any `marketPrice` JSON stored before the USD
 * switch (see the `marketPriceMga` column). Never served to API consumers.
 */
export type ArchivedMarketPrice = Record<string, unknown>;

/** Canonical API shape. USD only; see `normalizeStoredMarketPrice`. */
export interface NormalizedMarketPrice {
  status: 'estimated';
  currency: 'USD';
  estimatedCost: number | null;
  estimatedSellingPrice: number | null;
}

function storedAmount(row: Record<string, unknown>, key: string): number | null {
  const value: unknown = row[key];
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return null;
  }
  return value;
}

/**
 * Maps any stored `marketPrice` value to the canonical API contract, so
 * previously saved ideas stay displayable. Only canonical USD rows carry
 * amounts: `not_found` legacy rows, unmigrated foreign-currency rows, and
 * malformed values degrade to null estimates rather than throwing — and a
 * non-USD amount can never be relabeled as dollars.
 */
export function normalizeStoredMarketPrice(value: unknown): NormalizedMarketPrice {
  const empty = (): NormalizedMarketPrice => ({
    status: 'estimated',
    currency: 'USD',
    estimatedCost: null,
    estimatedSellingPrice: null,
  });
  if (typeof value !== 'object' || value === null) {
    return empty();
  }
  const row = value as Record<string, unknown>;
  const hasCanonicalKeys = 'estimatedCost' in row || 'estimatedSellingPrice' in row;
  if (row['currency'] !== 'USD' || !hasCanonicalKeys) {
    return empty();
  }
  return {
    status: 'estimated',
    currency: 'USD',
    estimatedCost: storedAmount(row, 'estimatedCost'),
    estimatedSellingPrice: storedAmount(row, 'estimatedSellingPrice'),
  };
}

export class GeneratedIdea extends Model<
  InferAttributes<GeneratedIdea>,
  InferCreationAttributes<GeneratedIdea>
> {
  declare id: CreationOptional<string>;
  declare sourceObjectId: string;
  declare title: string;
  declare description: string;
  declare intendedUse: string;
  declare additionalMaterials: string[];
  declare tools: string[];
  declare difficulty: string;
  declare estimatedMinutes: number;
  declare tutorialSteps: StoredTutorialStep[];
  declare safetyNotes: string[];
  // Null when this idea's image generation failed (see imageStatus).
  declare imagePath: string | null;
  declare imageStatus: string;
  declare marketPrice: StoredMarketPrice;
  // Pre-USD-conversion archive, populated by the 20261030000001 migration for
  // converted rows only; null for every row written after the USD switch.
  declare marketPriceMga: CreationOptional<ArchivedMarketPrice | null>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

export function initGeneratedIdeaModel(sequelize: Sequelize): void {
  GeneratedIdea.init(
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
        allowNull: false,
      },
      sourceObjectId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: 'source_objects', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      title: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      description: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      intendedUse: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      additionalMaterials: {
        type: DataTypes.JSONB,
        allowNull: false,
      },
      tools: {
        type: DataTypes.JSONB,
        allowNull: false,
      },
      difficulty: {
        type: DataTypes.STRING(20),
        allowNull: false,
        validate: { isIn: [['Easy', 'Medium', 'Hard']] },
      },
      estimatedMinutes: {
        type: DataTypes.INTEGER,
        allowNull: false,
        validate: { min: 1, max: 1440 },
      },
      tutorialSteps: {
        type: DataTypes.JSONB,
        allowNull: false,
      },
      safetyNotes: {
        type: DataTypes.JSONB,
        allowNull: false,
      },
      imagePath: {
        type: DataTypes.STRING(500),
        allowNull: true,
      },
      imageStatus: {
        type: DataTypes.STRING(20),
        allowNull: false,
        validate: { isIn: [['completed', 'failed']] },
      },
      marketPrice: {
        type: DataTypes.JSONB,
        allowNull: false,
      },
      marketPriceMga: {
        type: DataTypes.JSONB,
        allowNull: true,
      },
      createdAt: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      updatedAt: {
        type: DataTypes.DATE,
        allowNull: false,
      },
    },
    {
      sequelize,
      modelName: 'GeneratedIdea',
      tableName: 'generated_ideas',
      timestamps: true,
    },
  );
}
