"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.asyncHandler = asyncHandler;
/** Forwards rejected promises from async handlers to the error middleware. */
function asyncHandler(fn) {
    return function (req, res, next) {
        void Promise.resolve(fn(req, res, next)).catch(next);
    };
}
