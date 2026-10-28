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
exports.IMAGE_MODEL = exports.SPARK_MODEL = void 0;
exports.generateIdeasFromPhoto = generateIdeasFromPhoto;
var node_crypto_1 = require("node:crypto");
var promises_1 = require("node:fs/promises");
var node_path_1 = require("node:path");
var zod_1 = require("zod");
var errors_1 = require("../utils/errors");
var image_1 = require("../utils/image");
var logger_1 = require("../utils/logger");
var ai_service_1 = require("./ai.service");
var meta_client_1 = require("./meta.client");
exports.SPARK_MODEL = 'muse-spark-1.3';
exports.IMAGE_MODEL = 'muse-image-1.0';
var SPARK_TIMEOUT_MS = 180000;
var IMAGE_TIMEOUT_MS = 180000;
var MAX_IMAGE_BYTES = 10 * 1024 * 1024;
var DTI_SYSTEM_PROMPT = "You are DTI (Don't Trash It), an expert in creative upcycling, practical reuse, sustainable design, and beginner-friendly DIY projects.\n\nAnalyze the uploaded photograph and identify the main discarded object, its likely material, visible condition, and relevant physical characteristics.\n\nGenerate exactly three distinct, realistic, safe, and useful ideas for transforming this object into new everyday items.\n\nPrioritize ideas that:\n- Can genuinely be made from the photographed object.\n- Require affordable and accessible additional materials.\n- Are useful, attractive, and reasonably easy to make.\n- Are meaningfully different from each other.\n- Avoid unnecessary complexity and unsafe transformations.\n\nFor each idea, provide an appealing English title, a short emotionally engaging description, the intended use, additional materials, required tools, difficulty, estimated crafting time, detailed beginner-friendly tutorial steps, safety precautions, and an English image-generation prompt.\n\nDo not invent market prices, listings, sellers, URLs, or claims of online research. If no verified price information is supplied, indicate that no verified market price is available.\n\nReturn only valid JSON matching the required response schema. Do not include Markdown or additional commentary.";
// Strict-subset compliant: root object, additionalProperties:false on every
// object, required lists every key. Sent via text.format (Responses API).
var IDEAS_JSON_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: ['sourceObject', 'ideas'],
    properties: {
        sourceObject: {
            type: 'object',
            additionalProperties: false,
            required: ['name', 'material', 'condition'],
            properties: {
                name: { type: 'string', minLength: 1 },
                material: { type: 'string', minLength: 1 },
                condition: { type: 'string', minLength: 1 },
            },
        },
        ideas: {
            type: 'array',
            minItems: 3,
            maxItems: 3,
            items: {
                type: 'object',
                additionalProperties: false,
                required: [
                    'title',
                    'description',
                    'intendedUse',
                    'additionalMaterials',
                    'tools',
                    'difficulty',
                    'estimatedMinutes',
                    'tutorialSteps',
                    'safetyNotes',
                    'imagePrompt',
                ],
                properties: {
                    title: { type: 'string', minLength: 1 },
                    description: { type: 'string', minLength: 1 },
                    intendedUse: { type: 'string', minLength: 1 },
                    additionalMaterials: {
                        type: 'array',
                        minItems: 1,
                        items: { type: 'string', minLength: 1 },
                    },
                    tools: { type: 'array', minItems: 1, items: { type: 'string', minLength: 1 } },
                    difficulty: { type: 'string', enum: ['Easy', 'Medium', 'Hard'] },
                    estimatedMinutes: { type: 'integer', minimum: 1, maximum: 1440 },
                    tutorialSteps: {
                        type: 'array',
                        minItems: 1,
                        items: {
                            type: 'object',
                            additionalProperties: false,
                            required: ['step', 'title', 'description'],
                            properties: {
                                step: { type: 'integer', minimum: 1 },
                                title: { type: 'string', minLength: 1 },
                                description: { type: 'string', minLength: 1 },
                            },
                        },
                    },
                    safetyNotes: { type: 'array', items: { type: 'string' } },
                    imagePrompt: { type: 'string', minLength: 1 },
                },
            },
        },
    },
};
var tutorialStepSchema = zod_1.z.object({
    step: zod_1.z.number().int().min(1),
    title: zod_1.z.string().trim().min(1).max(200),
    description: zod_1.z.string().trim().min(1).max(2000),
});
var rawIdeaSchema = zod_1.z.object({
    title: zod_1.z.string().trim().min(1).max(120),
    description: zod_1.z.string().trim().min(1).max(600),
    intendedUse: zod_1.z.string().trim().min(1).max(300),
    additionalMaterials: zod_1.z.array(zod_1.z.string().trim().min(1).max(200)).min(1).max(30),
    tools: zod_1.z.array(zod_1.z.string().trim().min(1).max(200)).min(1).max(30),
    difficulty: zod_1.z.enum(['Easy', 'Medium', 'Hard']),
    estimatedMinutes: zod_1.z.number().int().min(1).max(1440),
    tutorialSteps: zod_1.z.array(tutorialStepSchema).min(1).max(30),
    safetyNotes: zod_1.z.array(zod_1.z.string().trim().max(300)).max(30),
    imagePrompt: zod_1.z.string().trim().min(1).max(1200),
});
var sparkOutputSchema = zod_1.z.object({
    sourceObject: zod_1.z.object({
        name: zod_1.z.string().trim().min(1).max(120),
        material: zod_1.z.string().trim().min(1).max(120),
        condition: zod_1.z.string().trim().min(1).max(120),
    }),
    ideas: zod_1.z.array(rawIdeaSchema).length(3),
});
var NO_MARKET_PRICE = {
    status: 'not_found',
    amount: null,
    currency: null,
    sourceUrl: null,
    listingTitle: null,
};
var FAILED_IMAGE = { url: null, status: 'failed' };
function parseModelJson(text) {
    // json_schema mode returns raw JSON; strip fences defensively anyway.
    var cleaned = text
        .trim()
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/, '');
    try {
        var parsed = JSON.parse(cleaned);
        return parsed;
    }
    catch (_a) {
        return undefined;
    }
}
function firstImageBytes(payload) {
    if (!(0, meta_client_1.isRecord)(payload)) {
        return undefined;
    }
    var data = payload['data'];
    if (!Array.isArray(data) || data.length === 0) {
        return undefined;
    }
    var first = data[0];
    if (!(0, meta_client_1.isRecord)(first)) {
        return undefined;
    }
    if (typeof first['b64_json'] === 'string' && first['b64_json'].length > 0) {
        return { kind: 'b64', data: first['b64_json'] };
    }
    if (typeof first['url'] === 'string' && first['url'].length > 0) {
        return { kind: 'url', url: first['url'] };
    }
    return undefined;
}
function generateAndStoreImage(imagePrompt, referenceDataUrl, deps, apiKey) {
    return __awaiter(this, void 0, void 0, function () {
        var payload, image, bytes, _a, kind, dir, filename;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0: return [4 /*yield*/, (0, meta_client_1.postMetaJson)(deps.metaApiBase, '/images/edits', {
                        model: exports.IMAGE_MODEL,
                        prompt: imagePrompt,
                        images: [{ image_url: referenceDataUrl }],
                        response_format: 'b64_json',
                    }, apiKey, IMAGE_TIMEOUT_MS)];
                case 1:
                    payload = _b.sent();
                    image = firstImageBytes(payload);
                    if (!image) {
                        throw new Error('Meta returned no image data');
                    }
                    if (!(image.kind === 'b64')) return [3 /*break*/, 2];
                    _a = Buffer.from(image.data, 'base64');
                    return [3 /*break*/, 4];
                case 2: return [4 /*yield*/, (0, meta_client_1.downloadImage)(image.url, IMAGE_TIMEOUT_MS, MAX_IMAGE_BYTES)];
                case 3:
                    _a = _b.sent();
                    _b.label = 4;
                case 4:
                    bytes = _a;
                    kind = (0, image_1.detectImageKind)(bytes);
                    if (!kind || bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) {
                        throw new Error('Meta returned an unusable image');
                    }
                    dir = node_path_1.default.join(deps.uploadDir, 'generated');
                    return [4 /*yield*/, promises_1.default.mkdir(dir, { recursive: true })];
                case 5:
                    _b.sent();
                    filename = "idea-".concat(node_crypto_1.default.randomUUID(), ".").concat(image_1.IMAGE_EXTENSION[kind]);
                    return [4 /*yield*/, promises_1.default.writeFile(node_path_1.default.join(dir, filename), bytes)];
                case 6:
                    _b.sent();
                    return [2 /*return*/, "/uploads/generated/".concat(filename)];
            }
        });
    });
}
function generateIdeasFromPhoto(image, deps) {
    return __awaiter(this, void 0, void 0, function () {
        var apiKey, kind, referenceDataUrl, sparkPayload, answerText, parsed, sparkOutput, images;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    apiKey = deps.apiKey;
                    if (!apiKey) {
                        throw new errors_1.AppError(503, 'AI_NOT_CONFIGURED', 'Meta AI is not configured on this server');
                    }
                    kind = (0, image_1.detectImageKind)(image);
                    if (!kind) {
                        throw new errors_1.AppError(400, 'VALIDATION_ERROR', 'Unsupported image format (JPEG, PNG, WebP or GIF)');
                    }
                    referenceDataUrl = "data:".concat(image_1.IMAGE_MIME[kind], ";base64,").concat(image.toString('base64'));
                    return [4 /*yield*/, (0, meta_client_1.postMetaJson)(deps.metaApiBase, '/responses', {
                            model: exports.SPARK_MODEL,
                            instructions: DTI_SYSTEM_PROMPT,
                            input: [
                                {
                                    role: 'user',
                                    content: [
                                        { type: 'input_text', text: 'Analyze this photo and generate three upcycling ideas.' },
                                        { type: 'input_image', image_url: referenceDataUrl },
                                    ],
                                },
                            ],
                            text: {
                                format: {
                                    type: 'json_schema',
                                    name: 'upcycling_ideas',
                                    schema: IDEAS_JSON_SCHEMA,
                                },
                            },
                        }, apiKey, SPARK_TIMEOUT_MS)];
                case 1:
                    sparkPayload = _a.sent();
                    (0, meta_client_1.assertResponseCompleted)(sparkPayload);
                    answerText = (0, ai_service_1.extractAnswerText)(sparkPayload);
                    if (!answerText) {
                        logger_1.logger.warn('meta ai returned no text output', { model: exports.SPARK_MODEL });
                        throw new errors_1.AppError(502, 'AI_UPSTREAM_ERROR', 'Meta AI returned no text output');
                    }
                    parsed = sparkOutputSchema.safeParse(parseModelJson(answerText));
                    if (!parsed.success) {
                        // Model text only (no secrets): safe to log a sample for debugging.
                        logger_1.logger.warn('meta ideas failed validation', { issues: parsed.error.issues.slice(0, 3) });
                        throw new errors_1.AppError(502, 'AI_UPSTREAM_ERROR', 'Meta returned an unusable response');
                    }
                    sparkOutput = parsed.data;
                    return [4 /*yield*/, Promise.all(sparkOutput.ideas.map(function (idea, index) {
                            return generateAndStoreImage(idea.imagePrompt, referenceDataUrl, deps, apiKey).then(function (url) { return ({ url: url, status: 'completed' }); }, function () {
                                // Per-idea failure: never log the error itself (image URLs may be
                                // signed); keep the other results.
                                logger_1.logger.warn('idea image generation failed', { index: index });
                                return FAILED_IMAGE;
                            });
                        }))];
                case 2:
                    images = _a.sent();
                    return [2 /*return*/, {
                            sourceObject: sparkOutput.sourceObject,
                            ideas: sparkOutput.ideas.map(function (idea, index) {
                                var _a;
                                var generated = (_a = images[index]) !== null && _a !== void 0 ? _a : FAILED_IMAGE;
                                return {
                                    id: "idea-".concat(index + 1),
                                    title: idea.title,
                                    description: idea.description,
                                    difficulty: idea.difficulty,
                                    estimatedMinutes: idea.estimatedMinutes,
                                    image: generated,
                                    marketPrice: NO_MARKET_PRICE,
                                    tutorial: {
                                        materials: idea.additionalMaterials,
                                        tools: idea.tools,
                                        steps: idea.tutorialSteps,
                                        safetyNotes: idea.safetyNotes,
                                    },
                                };
                            }),
                        }];
            }
        });
    });
}
