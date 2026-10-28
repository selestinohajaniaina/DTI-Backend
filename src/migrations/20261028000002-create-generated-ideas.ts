import { DataTypes } from 'sequelize';
import type { Sequelize } from 'sequelize';
import type { MigrationFn } from 'umzug';

export const up: MigrationFn<Sequelize> = async ({ context }) => {
  const queryInterface = context.getQueryInterface();
  await queryInterface.createTable('generated_ideas', {
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
    },
    estimatedMinutes: {
      type: DataTypes.INTEGER,
      allowNull: false,
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
  });
  await queryInterface.addIndex('generated_ideas', ['sourceObjectId']);
};

export const down: MigrationFn<Sequelize> = async ({ context }) => {
  await context.getQueryInterface().dropTable('generated_ideas');
};
