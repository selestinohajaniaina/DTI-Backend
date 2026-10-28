import type { Request } from 'express';
import multer, { type FileFilterCallback } from 'multer';
import { AppError } from '../utils/errors';

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

function imageFilter(_req: Request, file: Express.Multer.File, cb: FileFilterCallback): void {
  // First gate only: the declared MIME type is never trusted alone, the
  // service layer re-validates the real magic bytes.
  if (file.mimetype.startsWith('image/')) {
    cb(null, true);
  } else {
    cb(new AppError(400, 'VALIDATION_ERROR', 'Only image uploads are accepted'));
  }
}

/** Accepts a single in-memory `image` file (multipart/form-data). */
export const uploadImage = multer({
  storage: multer.memoryStorage(),
  limits: { files: 1, fileSize: MAX_UPLOAD_BYTES },
  fileFilter: imageFilter,
}).single('image');
