import { DataTypes } from 'sequelize';
import type { Sequelize } from 'sequelize';
import type { MigrationFn } from 'umzug';

export const up: MigrationFn<Sequelize> = async ({ context }) => {
  const queryInterface = context.getQueryInterface();
  await queryInterface.createTable('source_objects', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
      allowNull: false,
    },
    ownerId: {
      type: DataTypes.UUID,
      allowNull: true,
      references: { model: 'users', key: 'id' },
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE',
    },
    anonymousOwnerId: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    imagePath: {
      type: DataTypes.STRING(500),
      allowNull: false,
    },
    name: {
      type: DataTypes.STRING(150),
      allowNull: false,
    },
    material: {
      type: DataTypes.STRING(150),
      allowNull: false,
    },
    condition: {
      type: DataTypes.STRING(150),
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
  await queryInterface.addIndex('source_objects', ['ownerId']);
  await queryInterface.addIndex('source_objects', ['anonymousOwnerId']);
  // Exactly one ownership mechanism per record.
  await context.query(
    'ALTER TABLE "source_objects" ADD CONSTRAINT "source_objects_owner_xor" ' +
      'CHECK (("ownerId" IS NULL) <> ("anonymousOwnerId" IS NULL))',
  );
};

export const down: MigrationFn<Sequelize> = async ({ context }) => {
  await context.getQueryInterface().dropTable('source_objects');
};
