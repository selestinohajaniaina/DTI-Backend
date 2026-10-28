"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateBody = validateBody;
var errors_1 = require("../utils/errors");
/** Validates req.body against a Zod schema and replaces it with the parsed value. */
function validateBody(schema) {
    return function (req, _res, next) {
        var result = schema.safeParse(req.body);
        if (!result.success) {
            var details = result.error.issues.map(function (issue) { return ({
                path: issue.path.join('.'),
                message: issue.message,
            }); });
            next(new errors_1.AppError(400, 'VALIDATION_ERROR', 'Invalid request data', details));
            return;
        }
        req.body = result.data;
        next();
    };
}
