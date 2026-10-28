"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createApp = createApp;
var cors_1 = require("cors");
var express_1 = require("express");
var helmet_1 = require("helmet");
var env_1 = require("./config/env");
var error_middleware_1 = require("./middlewares/error.middleware");
var not_found_middleware_1 = require("./middlewares/not-found.middleware");
var request_logger_middleware_1 = require("./middlewares/request-logger.middleware");
var index_1 = require("./routes/index");
/** Builds the Express application without binding any port (test-friendly). */
function createApp() {
    var app = (0, express_1.default)();
    app.disable('x-powered-by');
    // Images under /uploads are meant to be embedded cross-origin (Angular dev
    // server); the default same-origin resource policy would block them.
    app.use((0, helmet_1.default)({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
    app.use((0, cors_1.default)({
        origin: env_1.env.frontendOrigins,
        methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization'],
        maxAge: 600,
    }));
    app.use(express_1.default.json({ limit: '100kb' }));
    app.use(request_logger_middleware_1.requestLogger);
    // Backend-managed generated assets only (server-chosen filenames under
    // <uploadDir>/generated). No directory listing, no dotfiles.
    app.use('/uploads', express_1.default.static(env_1.env.uploadDir, { dotfiles: 'deny', index: false, maxAge: '1d' }));
    app.use('/api', index_1.apiRouter);
    app.use(not_found_middleware_1.notFound);
    app.use(error_middleware_1.errorHandler);
    return app;
}
