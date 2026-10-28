// Magic-byte sniffing for uploaded and generated images. Never trusts the
// filename or the declared MIME type alone.

export type SupportedImageKind = 'jpeg' | 'png' | 'webp' | 'gif';

export const IMAGE_MIME: Record<SupportedImageKind, string> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
};

export const IMAGE_EXTENSION: Record<SupportedImageKind, string> = {
  jpeg: 'jpg',
  png: 'png',
  webp: 'webp',
  gif: 'gif',
};

function startsWithBytes(buffer: Buffer, prefix: number[]): boolean {
  return prefix.every((byte, index) => buffer[index] === byte);
}

export function detectImageKind(buffer: Buffer): SupportedImageKind | undefined {
  // JPEG: FF D8 FF
  if (buffer.length >= 3 && startsWithBytes(buffer, [0xff, 0xd8, 0xff])) {
    return 'jpeg';
  }
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer.length >= 8 &&
    startsWithBytes(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  ) {
    return 'png';
  }
  // GIF: GIF87a / GIF89a
  if (buffer.length >= 6) {
    const header = buffer.subarray(0, 6).toString('ascii');
    if (header === 'GIF87a' || header === 'GIF89a') {
      return 'gif';
    }
  }
  // WebP: RIFF....WEBP
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'webp';
  }
  return undefined;
}
