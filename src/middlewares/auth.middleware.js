"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireAuth = requireAuth;
var errors_1 = require("../utils/errors");
var jwt_1 = require("../utils/jwt");
/** Validates the Bearer token and attaches the caller's identity to req.user. */
function requireAuth(req, _res, next) {
    var header = req.header('authorization');
    if (!header || !header.startsWith('Bearer ')) {
        next(new errors_1.AppError(401, 'MISSING_TOKEN', 'Missing or malformed authorization header'));
        return;
    }
    var token = header.slice('Bearer '.length).trim();
    if (!token) {
        next(new errors_1.AppError(401, 'MISSING_TOKEN', 'Missing authentication token'));
        return;
    }
    try {
        var payload = (0, jwt_1.verifyAccessToken)(token);
        var user = { id: payload.sub, email: payload.email };
        req.user = user;
        next();
    }
    catch (error) {
        next(error);
    }
}
