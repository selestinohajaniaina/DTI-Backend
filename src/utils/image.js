"use strict";
// Magic-byte sniffing for uploaded and generated images. Never trusts the
// filename or the declared MIME type alone.
Object.defineProperty(exports, "__esModule", { value: true });
exports.IMAGE_EXTENSION = exports.IMAGE_MIME = void 0;
exports.detectImageKind = detectImageKind;
exports.IMAGE_MIME = {
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    gif: 'image/gif',
};
exports.IMAGE_EXTENSION = {
    jpeg: 'jpg',
    png: 'png',
    webp: 'webp',
    gif: 'gif',
};
function startsWithBytes(buffer, prefix) {
    return prefix.every(function (byte, index) { return buffer[index] === byte; });
}
function detectImageKind(buffer) {
    // JPEG: FF D8 FF
    if (buffer.length >= 3 && startsWithBytes(buffer, [0xff, 0xd8, 0xff])) {
        return 'jpeg';
    }
    // PNG: 89 50 4E 47 0D 0A 1A 0A
    if (buffer.length >= 8 &&
        startsWithBytes(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
        return 'png';
    }
    // GIF: GIF87a / GIF89a
    if (buffer.length >= 6) {
        var header = buffer.subarray(0, 6).toString('ascii');
        if (header === 'GIF87a' || header === 'GIF89a') {
            return 'gif';
        }
    }
    // WebP: RIFF....WEBP
    if (buffer.length >= 12 &&
        buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
        buffer.subarray(8, 12).toString('ascii') === 'WEBP') {
        return 'webp';
    }
    return undefined;
}
