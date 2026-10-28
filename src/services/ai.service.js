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
exports.META_TEST_MODEL = exports.META_RESPONSES_URL = void 0;
exports.extractAnswerText = extractAnswerText;
exports.runAiTest = runAiTest;
var errors_1 = require("../utils/errors");
var logger_1 = require("../utils/logger");
var meta_client_1 = require("./meta.client");
exports.META_RESPONSES_URL = 'https://api.meta.ai/v1/responses';
exports.META_TEST_MODEL = 'muse-spark-1.3';
var REQUEST_TIMEOUT_MS = 30000;
/**
 * Concatenates generated text from a Responses API payload, following the
 * documented shape: `output[]` -> `message` items -> `content[]` parts of
 * type `output_text` (`text`) or `refusal` (`refusal`). Reasoning items,
 * tool calls and other item types carry no user-facing text and are skipped.
 * Returns undefined when no text part exists.
 */
function extractAnswerText(payload) {
    if (!(0, meta_client_1.isRecord)(payload)) {
        return undefined;
    }
    var output = payload['output'];
    if (!Array.isArray(output)) {
        return undefined;
    }
    var chunks = [];
    for (var _i = 0, output_1 = output; _i < output_1.length; _i++) {
        var item = output_1[_i];
        if (!(0, meta_client_1.isRecord)(item) || item['type'] !== 'message') {
            continue;
        }
        var content = item['content'];
        if (!Array.isArray(content)) {
            continue;
        }
        for (var _a = 0, content_1 = content; _a < content_1.length; _a++) {
            var part = content_1[_a];
            if (!(0, meta_client_1.isRecord)(part)) {
                continue;
            }
            if (part['type'] === 'output_text' && typeof part['text'] === 'string') {
                chunks.push(part['text']);
            }
            else if (part['type'] === 'refusal' && typeof part['refusal'] === 'string') {
                chunks.push(part['refusal']);
            }
        }
    }
    if (chunks.length === 0) {
        return undefined;
    }
    return chunks.join('');
}
/**
 * Sends one prompt to Meta Muse AI (Responses API) and returns the generated
 * text. The API key travels in the Authorization header only and is never
 * logged or returned.
 */
function runAiTest(prompt, apiKey, metaApiBase) {
    return __awaiter(this, void 0, void 0, function () {
        var payload, answer, model;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    if (!apiKey) {
                        throw new errors_1.AppError(503, 'AI_NOT_CONFIGURED', 'Meta AI is not configured on this server');
                    }
                    return [4 /*yield*/, (0, meta_client_1.postMetaJson)(metaApiBase, '/responses', { model: exports.META_TEST_MODEL, input: prompt }, apiKey, REQUEST_TIMEOUT_MS)];
                case 1:
                    payload = _a.sent();
                    (0, meta_client_1.assertResponseCompleted)(payload);
                    answer = extractAnswerText(payload);
                    if (!answer) {
                        logger_1.logger.warn('meta ai returned no text output', { model: exports.META_TEST_MODEL });
                        throw new errors_1.AppError(502, 'AI_UPSTREAM_ERROR', 'Meta AI returned no text output');
                    }
                    model = (0, meta_client_1.isRecord)(payload) && typeof payload['model'] === 'string' ? payload['model'] : exports.META_TEST_MODEL;
                    return [2 /*return*/, { model: model, answer: answer }];
            }
        });
    });
}
