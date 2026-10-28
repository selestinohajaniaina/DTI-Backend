"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requestLogger = requestLogger;
var logger_1 = require("../utils/logger");
/** Logs one line per request. Only the path is logged, never query strings. */
function requestLogger(req, res, next) {
    var start = process.hrtime.bigint();
    res.on('finish', function () {
        var durationMs = Number(process.hrtime.bigint() - start) / 1000000;
        logger_1.logger.info('request', {
            method: req.method,
            path: req.path,
            status: res.statusCode,
            durationMs: Math.round(durationMs * 100) / 100,
        });
    });
    next();
}
