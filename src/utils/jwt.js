"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.expiresInSeconds = expiresInSeconds;
exports.signAccessToken = signAccessToken;
exports.verifyAccessToken = verifyAccessToken;
var jsonwebtoken_1 = require("jsonwebtoken");
var env_1 = require("../config/env");
var errors_1 = require("./errors");
var SECONDS_PER_UNIT = {
    ms: 1 / 1000,
    s: 1,
    m: 60,
    h: 3600,
    d: 86400,
    w: 604800,
    y: 31536000,
};
/**
 * Converts the validated JWT_EXPIRES_IN value ("15m", "1h", "3600") to whole
 * seconds for jsonwebtoken, which also accepts seconds as a number.
 */
function expiresInSeconds(value) {
    var _a, _b;
    var match = /^(\d+)\s*(ms|s|m|h|d|w|y)?$/i.exec(value.trim());
    if (!(match === null || match === void 0 ? void 0 : match[1])) {
        // Unreachable: env.ts rejects values outside this format at startup.
        throw new Error("Invalid JWT_EXPIRES_IN value: ".concat(value));
    }
    var amount = Number.parseInt(match[1], 10);
    var unit = ((_a = match[2]) !== null && _a !== void 0 ? _a : 's').toLowerCase();
    return Math.max(1, Math.floor(amount * ((_b = SECONDS_PER_UNIT[unit]) !== null && _b !== void 0 ? _b : 1)));
}
function signAccessToken(payload) {
    return jsonwebtoken_1.default.sign(payload, env_1.env.jwtSecret, { expiresIn: expiresInSeconds(env_1.env.jwtExpiresIn) });
}
function asRecord(value) {
    if (typeof value === 'object' && value !== null) {
        return value;
    }
    return undefined;
}
function verifyAccessToken(token) {
    try {
        var decoded = asRecord(jsonwebtoken_1.default.verify(token, env_1.env.jwtSecret));
        var sub = decoded === null || decoded === void 0 ? void 0 : decoded['sub'];
        var email = decoded === null || decoded === void 0 ? void 0 : decoded['email'];
        if (typeof sub !== 'string' || typeof email !== 'string') {
            throw new errors_1.AppError(401, 'INVALID_TOKEN', 'Invalid authentication token');
        }
        return { sub: sub, email: email };
    }
    catch (error) {
        if (error instanceof errors_1.AppError) {
            throw error;
        }
        if (error instanceof jsonwebtoken_1.default.TokenExpiredError) {
            throw new errors_1.AppError(401, 'TOKEN_EXPIRED', 'Authentication token has expired');
        }
        throw new errors_1.AppError(401, 'INVALID_TOKEN', 'Invalid authentication token');
    }
}
