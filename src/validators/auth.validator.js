"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.loginSchema = exports.registerSchema = void 0;
var zod_1 = require("zod");
var nameSchema = zod_1.z
    .string()
    .trim()
    .min(1, 'Name is required')
    .max(100, 'Name must be at most 100 characters');
// Trimmed before the format check (z.email() alone rejects padded input);
// lowercasing happens in normalizeEmail() so the stored value is canonical.
var emailSchema = zod_1.z
    .string()
    .trim()
    .max(255, 'Email must be at most 255 characters')
    .pipe(zod_1.z.email('Invalid email address'));
var passwordSchema = zod_1.z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(128, 'Password must be at most 128 characters');
exports.registerSchema = zod_1.z.object({
    name: nameSchema,
    email: emailSchema,
    password: passwordSchema,
});
exports.loginSchema = zod_1.z.object({
    email: emailSchema,
    password: zod_1.z.string().min(1, 'Password is required').max(128),
});
