"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.notFound = notFound;
var errors_1 = require("../utils/errors");
/** Catches every request that matched no route. Registered before errorHandler. */
function notFound(_req, _res, next) {
    next(new errors_1.AppError(404, 'NOT_FOUND', 'Route not found'));
}
