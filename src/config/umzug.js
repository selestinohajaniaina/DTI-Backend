"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createMigrator = createMigrator;
var node_path_1 = require("node:path");
var umzug_1 = require("umzug");
function createMigrator(sequelize, migrations) {
    // Sources live in src/migrations/*.ts, compiled output in dist/migrations/*.js.
    // The glob is resolved from this file's own location so both layouts work.
    var migrationsDir = node_path_1.default.join(__dirname, '..', 'migrations');
    var pattern = __filename.endsWith('.ts') ? '*.ts' : '*.js';
    var noop = function () { return undefined; };
    return new umzug_1.Umzug({
        migrations: migrations !== null && migrations !== void 0 ? migrations : {
            glob: node_path_1.default.join(migrationsDir, pattern).replace(/\\/g, '/'),
        },
        context: sequelize,
        storage: new umzug_1.SequelizeStorage({ sequelize: sequelize }),
        // Callers log migration results themselves; keep Umzug quiet.
        logger: { info: noop, warn: noop, error: noop, debug: noop },
    });
}
