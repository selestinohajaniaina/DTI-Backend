import type { Sequelize } from 'sequelize';
import { GeneratedIdea, initGeneratedIdeaModel } from './generated-idea.model';
import { SourceObject, initSourceObjectModel } from './source-object.model';
import { User, initUserModel } from './user.model';

export function initModels(sequelize: Sequelize): void {
  initUserModel(sequelize);
  initSourceObjectModel(sequelize);
  initGeneratedIdeaModel(sequelize);

  User.hasMany(SourceObject, { foreignKey: 'ownerId' });
  SourceObject.belongsTo(User, { foreignKey: 'ownerId' });
  SourceObject.hasMany(GeneratedIdea, { foreignKey: 'sourceObjectId' });
  GeneratedIdea.belongsTo(SourceObject, { foreignKey: 'sourceObjectId' });
}

export { GeneratedIdea, SourceObject, User };
