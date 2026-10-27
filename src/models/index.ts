import type { Sequelize } from 'sequelize';
import { User, initUserModel } from './user.model';

export function initModels(sequelize: Sequelize): void {
  initUserModel(sequelize);
  // Register associations here when new models are added, e.g.:
  // User.hasMany(Project, { foreignKey: 'ownerId' });
}

export { User };
