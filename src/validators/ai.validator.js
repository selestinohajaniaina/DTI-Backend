"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.aiTestSchema = void 0;
var zod_1 = require("zod");
exports.aiTestSchema = zod_1.z.object({
    prompt: zod_1.z.string().trim().min(1, 'Prompt is required').max(4000, 'Prompt is too long'),
});
