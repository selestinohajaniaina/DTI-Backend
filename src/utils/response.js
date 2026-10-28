"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendSuccess = sendSuccess;
function sendSuccess(res, data, statusCode) {
    if (statusCode === void 0) { statusCode = 200; }
    var body = { success: true, data: data };
    res.status(statusCode).json(body);
}
