"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.uploadImage = exports.MAX_UPLOAD_BYTES = void 0;
var multer_1 = require("multer");
var errors_1 = require("../utils/errors");
exports.MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
function imageFilter(_req, file, cb) {
    // First gate only: the declared MIME type is never trusted alone, the
    // service layer re-validates the real magic bytes.
    if (file.mimetype.startsWith('image/')) {
        cb(null, true);
    }
    else {
        cb(new errors_1.AppError(400, 'VALIDATION_ERROR', 'Only image uploads are accepted'));
    }
}
/** Accepts a single in-memory `image` file (multipart/form-data). */
exports.uploadImage = (0, multer_1.default)({
    storage: multer_1.default.memoryStorage(),
    limits: { files: 1, fileSize: exports.MAX_UPLOAD_BYTES },
    fileFilter: imageFilter,
}).single('image');
