"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.aiRouter = void 0;
var express_1 = require("express");
var ai_controller_1 = require("../controllers/ai.controller");
var ideas_controller_1 = require("../controllers/ideas.controller");
var auth_middleware_1 = require("../middlewares/auth.middleware");
var upload_middleware_1 = require("../middlewares/upload.middleware");
var validate_middleware_1 = require("../middlewares/validate.middleware");
var ai_validator_1 = require("../validators/ai.validator");
exports.aiRouter = (0, express_1.Router)();
// Protected like every non-public route: Postman callers register/login first
// (see README). No development-only bypass, so production stays safe.
exports.aiRouter.post('/test', auth_middleware_1.requireAuth, (0, validate_middleware_1.validateBody)(ai_validator_1.aiTestSchema), ai_controller_1.testAi);
// Prototype flow: public so the anonymous upload-to-ideas demo works without
// a login UI. Revisit (auth + rate limiting) before any public exposure.
exports.aiRouter.post('/generate-ideas', upload_middleware_1.uploadImage, ideas_controller_1.generateIdeas);
