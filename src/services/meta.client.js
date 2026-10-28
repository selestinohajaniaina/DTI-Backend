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
exports.isRecord = isRecord;
exports.postMetaJson = postMetaJson;
exports.assertResponseCompleted = assertResponseCompleted;
exports.downloadImage = downloadImage;
var errors_1 = require("../utils/errors");
var logger_1 = require("../utils/logger");
var MAX_UPSTREAM_LOG_CHARS = 200;
function isRecord(value) {
    return typeof value === 'object' && value !== null;
}
/**
 * POSTs a JSON body to the Meta Model API and returns the parsed payload.
 * Maps timeouts, network failures, upstream errors and invalid JSON to
 * AppError. The API key travels in the Authorization header only and is
 * never logged or returned.
 */
function postMetaJson(baseUrl, path, body, apiKey, timeoutMs) {
    return __awaiter(this, void 0, void 0, function () {
        var res, error_1, snippet, payload;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    _a.trys.push([0, 2, , 3]);
                    return [4 /*yield*/, fetch("".concat(baseUrl).concat(path), {
                            method: 'POST',
                            headers: {
                                Authorization: "Bearer ".concat(apiKey),
                                'Content-Type': 'application/json',
                            },
                            body: JSON.stringify(body),
                            signal: AbortSignal.timeout(timeoutMs),
                        })];
                case 1:
                    res = _a.sent();
                    return [3 /*break*/, 3];
                case 2:
                    error_1 = _a.sent();
                    if (error_1 instanceof Error && error_1.name === 'AbortError') {
                        logger_1.logger.warn('meta ai request timed out', { path: path, timeoutMs: timeoutMs });
                        throw new errors_1.AppError(504, 'AI_TIMEOUT', 'Meta AI request timed out');
                    }
                    logger_1.logger.warn('meta ai request failed', { path: path });
                    throw new errors_1.AppError(502, 'AI_UPSTREAM_ERROR', 'Meta AI request failed');
                case 3:
                    if (!!res.ok) return [3 /*break*/, 5];
                    return [4 /*yield*/, res.text().catch(function () { return ''; })];
                case 4:
                    snippet = (_a.sent()).slice(0, MAX_UPSTREAM_LOG_CHARS);
                    logger_1.logger.warn('meta ai responded with an error', { path: path, status: res.status, body: snippet });
                    throw new errors_1.AppError(502, 'AI_UPSTREAM_ERROR', 'Meta AI request failed');
                case 5: return [4 /*yield*/, res.json().catch(function () { return undefined; })];
                case 6:
                    payload = _a.sent();
                    if (payload === undefined) {
                        logger_1.logger.warn('meta ai returned invalid json', { path: path, status: res.status });
                        throw new errors_1.AppError(502, 'AI_UPSTREAM_ERROR', 'Meta AI request failed');
                    }
                    return [2 /*return*/, payload];
            }
        });
    });
}
/**
 * Throws when a Responses API payload reports a failed generation.
 * Upstream error details stay in the logs; the client gets a generic 502.
 */
function assertResponseCompleted(payload) {
    if (!isRecord(payload) || payload['status'] !== 'failed') {
        return;
    }
    var failure = isRecord(payload['error']) ? payload['error'] : undefined;
    logger_1.logger.warn('meta ai generation failed', {
        code: typeof (failure === null || failure === void 0 ? void 0 : failure['code']) === 'string' ? failure['code'] : 'unknown',
        message: typeof (failure === null || failure === void 0 ? void 0 : failure['message']) === 'string' ? failure['message'] : 'unknown',
    });
    throw new errors_1.AppError(502, 'AI_UPSTREAM_ERROR', 'Meta AI request failed');
}
/**
 * Downloads an image URL returned by Meta (when an endpoint answers with
 * `url` instead of `b64_json`). Rejects non-image content and oversized
 * bodies. Saved bytes are still magic-byte verified by the caller.
 */
function downloadImage(url, timeoutMs, maxBytes) {
    return __awaiter(this, void 0, void 0, function () {
        var res, _a, contentType, buffer, _b, _c;
        var _d;
        return __generator(this, function (_e) {
            switch (_e.label) {
                case 0:
                    _e.trys.push([0, 2, , 3]);
                    return [4 /*yield*/, fetch(url, { signal: AbortSignal.timeout(timeoutMs) })];
                case 1:
                    res = _e.sent();
                    return [3 /*break*/, 3];
                case 2:
                    _a = _e.sent();
                    throw new errors_1.AppError(502, 'AI_UPSTREAM_ERROR', 'Meta AI request failed');
                case 3:
                    if (!res.ok) {
                        throw new errors_1.AppError(502, 'AI_UPSTREAM_ERROR', 'Meta AI request failed');
                    }
                    contentType = (_d = res.headers.get('content-type')) !== null && _d !== void 0 ? _d : '';
                    if (!contentType.startsWith('image/')) {
                        throw new errors_1.AppError(502, 'AI_UPSTREAM_ERROR', 'Meta AI request failed');
                    }
                    _c = (_b = Buffer).from;
                    return [4 /*yield*/, res.arrayBuffer()];
                case 4:
                    buffer = _c.apply(_b, [_e.sent()]);
                    if (buffer.length === 0 || buffer.length > maxBytes) {
                        throw new errors_1.AppError(502, 'AI_UPSTREAM_ERROR', 'Meta AI request failed');
                    }
                    return [2 /*return*/, buffer];
            }
        });
    });
}
