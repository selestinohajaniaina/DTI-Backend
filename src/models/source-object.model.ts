import { DataTypes, Model } from 'sequelize';
import type {
  CreationOptional,
  InferAttributes,
  InferCreationAttributes,
  Sequelize,
} from 'sequelize';

export class SourceObject extends Model<
  InferAttributes<SourceObject>,
  InferCreationAttributes<SourceObject>
> {
  declare id: CreationOptional<string>;
  // Exactly one of ownerId / anonymousOwnerId is set (DB CHECK constraint).
  declare ownerId: string | null;
  declare anonymousOwnerId: string | null;
  // Storage key relative to the upload directory, e.g. "source/<uuid>.png".
  declare imagePath: string;
  declare name: string;
  declare material: string;
  declare condition: string;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

export function initSourceObjectModel(sequelize: Sequelize): void {
  SourceObject.init(
    {
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
    },
    {
      sequelize,
      modelName: 'SourceObject',
      tableName: 'source_objects',
      timestamps: true,
    },
  );
}
