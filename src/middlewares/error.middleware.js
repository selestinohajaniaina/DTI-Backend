"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.errorHandler = errorHandler;
var multer_1 = require("multer");
var sequelize_1 = require("sequelize");
var env_1 = require("../config/env");
var errors_1 = require("../utils/errors");
var logger_1 = require("../utils/logger");
function sendError(res, statusCode, code, message, details) {
    if (res.headersSent) {
        return;
    }
    var body = { success: false, error: { code: code, message: message, details: details } };
    res.status(statusCode).json(body);
}
function isJsonParseError(error) {
    if (!(error instanceof SyntaxError)) {
        return false;
    }
    var candidate = error;
    return (candidate.status === 400 &&
        typeof candidate.type === 'string' &&
        candidate.type.startsWith('entity.'));
}
/** Centralized error handler. Must be registered after all routes. */
function errorHandler(error, req, res, _next) {
    var _a;
    if (error instanceof errors_1.AppError) {
        if (error.statusCode >= 500) {
            logger_1.logger.error('request failed', {
                path: req.path,
                status: error.statusCode,
                code: error.code,
            });
        }
        else {
            logger_1.logger.debug('request rejected', {
                path: req.path,
                status: error.statusCode,
                code: error.code,
            });
        }
        sendError(res, error.statusCode, error.code, error.message, error.details);
        return;
    }
    if (error instanceof sequelize_1.UniqueConstraintError) {
        // Race-safe backstop: the service layer checks duplicates first, the
        // database constraint wins when two requests race.
        var fields = Object.keys((_a = error.fields) !== null && _a !== void 0 ? _a : {});
        if (fields.includes('email')) {
            sendError(res, 409, 'EMAIL_TAKEN', 'Email address is already registered');
        }
        else {
            logger_1.logger.warn('unique constraint violation', { path: req.path, fields: fields });
            sendError(res, 409, 'CONFLICT', 'Resource already exists');
        }
        return;
    }
    if (error instanceof sequelize_1.ValidationError) {
        var details = error.errors.map(function (item) { var _a; return ({ path: (_a = item.path) !== null && _a !== void 0 ? _a : '', message: item.message }); });
        sendError(res, 400, 'VALIDATION_ERROR', 'Invalid request data', details);
        return;
    }
    if (isJsonParseError(error)) {
        sendError(res, 400, 'INVALID_JSON', 'Malformed JSON body');
        return;
    }
    if (error instanceof multer_1.MulterError) {
        if (error.code === 'LIMIT_FILE_SIZE') {
            sendError(res, 413, 'FILE_TOO_LARGE', 'Uploaded image exceeds the size limit');
        }
        else {
            sendError(res, 400, 'VALIDATION_ERROR', 'Invalid file upload');
        }
        return;
    }
    logger_1.logger.error('unhandled error', { path: req.path, method: req.method, error: error });
    var message = env_1.env.isProduction || !(error instanceof Error) ? 'Internal server error' : error.message;
    sendError(res, 500, 'INTERNAL_ERROR', message);
}
