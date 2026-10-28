"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.healthRouter = void 0;
var express_1 = require("express");
var health_controller_1 = require("../controllers/health.controller");
exports.healthRouter = (0, express_1.Router)();
exports.healthRouter.get('/', health_controller_1.getHealth);
exports.healthRouter.get('/ready', health_controller_1.getReadiness);
