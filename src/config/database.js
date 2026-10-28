"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sequelize = void 0;
exports.checkDatabase = checkDatabase;
exports.waitForDatabase = waitForDatabase;
var sequelize_1 = require("sequelize");
var env_1 = require("./env");
var logger_1 = require("../utils/logger");
var index_1 = require("../models/index");
exports.sequelize = new sequelize_1.Sequelize(env_1.env.databaseUrl, {
    dialect: 'postgres',
    // SQL logging is opt-in because query text can contain sensitive values.
    logging: env_1.env.dbLogging ? function (sql) { return logger_1.logger.debug('sequelize', { sql: sql }); } : false,
    pool: {
        max: 10,
        min: 0,
        acquire: 30000,
        idle: 10000,
    },
    dialectOptions: env_1.env.dbSsl
        ? { ssl: { require: true, rejectUnauthorized: env_1.env.dbSslRejectUnauthorized } }
        : {},
});
(0, index_1.initModels)(exports.sequelize);
/** Single-shot connectivity check used by the readiness probe. */
function checkDatabase() {
    return __awaiter(this, void 0, void 0, function () {
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, exports.sequelize.authenticate()];
                case 1:
                    _a.sent();
                    return [2 /*return*/];
            }
        });
    });
}
var STARTUP_ATTEMPTS = 10;
var RETRY_DELAY_MS = 2000;
/**
 * Waits for PostgreSQL during startup (covers provider cold starts and
 * deploy-time ordering races). Throws after the attempts run out.
 */
function waitForDatabase() {
    return __awaiter(this, void 0, void 0, function () {
        var lastError, attempt, error_1;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    attempt = 1;
                    _a.label = 1;
                case 1:
                    if (!(attempt <= STARTUP_ATTEMPTS)) return [3 /*break*/, 7];
                    _a.label = 2;
                case 2:
                    _a.trys.push([2, 4, , 6]);
                    return [4 /*yield*/, exports.sequelize.authenticate()];
                case 3:
                    _a.sent();
                    logger_1.logger.info('database connection established');
                    return [2 /*return*/];
                case 4:
                    error_1 = _a.sent();
                    lastError = error_1;
                    // Attempt counts only: driver errors may echo connection details.
                    logger_1.logger.warn('database connection failed, retrying', {
                        attempt: attempt,
                        maxAttempts: STARTUP_ATTEMPTS,
                    });
                    return [4 /*yield*/, new Promise(function (resolve) { return setTimeout(resolve, RETRY_DELAY_MS); })];
                case 5:
                    _a.sent();
                    return [3 /*break*/, 6];
                case 6:
                    attempt += 1;
                    return [3 /*break*/, 1];
                case 7: throw lastError instanceof Error ? lastError : new Error('Could not connect to the database');
            }
        });
    });
}
