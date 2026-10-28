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

export interface StoredMarketPrice {
  status: string;
  amount: number | null;
  currency: string | null;
  sourceUrl: string | null;
  listingTitle: string | null;
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
