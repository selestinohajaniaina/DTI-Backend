"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.User = void 0;
exports.initModels = initModels;
var user_model_1 = require("./user.model");
Object.defineProperty(exports, "User", { enumerable: true, get: function () { return user_model_1.User; } });
function initModels(sequelize) {
    (0, user_model_1.initUserModel)(sequelize);
    // Register associations here when new models are added, e.g.:
    // User.hasMany(Project, { foreignKey: 'ownerId' });
}
