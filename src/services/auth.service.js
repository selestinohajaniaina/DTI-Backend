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
exports.normalizeEmail = normalizeEmail;
exports.register = register;
exports.login = login;
exports.getProfile = getProfile;
var user_model_1 = require("../models/user.model");
var errors_1 = require("../utils/errors");
var jwt_1 = require("../utils/jwt");
var password_1 = require("../utils/password");
function normalizeEmail(email) {
    return email.trim().toLowerCase();
}
function toPublicUser(user) {
    return {
        id: user.id,
        name: user.name,
        email: user.email,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
    };
}
function register(input) {
    return __awaiter(this, void 0, void 0, function () {
        var email, existing, passwordHash, user;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    email = normalizeEmail(input.email);
                    return [4 /*yield*/, user_model_1.User.findOne({ where: { email: email } })];
                case 1:
                    existing = _a.sent();
                    if (existing) {
                        throw new errors_1.AppError(409, 'EMAIL_TAKEN', 'Email address is already registered');
                    }
                    return [4 /*yield*/, (0, password_1.hashPassword)(input.password)];
                case 2:
                    passwordHash = _a.sent();
                    return [4 /*yield*/, user_model_1.User.create({ name: input.name, email: email, passwordHash: passwordHash })];
                case 3:
                    user = _a.sent();
                    return [2 /*return*/, { user: toPublicUser(user), token: (0, jwt_1.signAccessToken)({ sub: user.id, email: user.email }) }];
            }
        });
    });
}
function login(input) {
    return __awaiter(this, void 0, void 0, function () {
        var email, user, ok;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    email = normalizeEmail(input.email);
                    return [4 /*yield*/, user_model_1.User.findOne({ where: { email: email } })];
                case 1:
                    user = _a.sent();
                    // Identical response for unknown emails and wrong passwords so callers
                    // cannot enumerate registered accounts.
                    if (!user) {
                        throw new errors_1.AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
                    }
                    return [4 /*yield*/, (0, password_1.verifyPassword)(input.password, user.passwordHash)];
                case 2:
                    ok = _a.sent();
                    if (!ok) {
                        throw new errors_1.AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
                    }
                    return [2 /*return*/, { user: toPublicUser(user), token: (0, jwt_1.signAccessToken)({ sub: user.id, email: user.email }) }];
            }
        });
    });
}
function getProfile(userId) {
    return __awaiter(this, void 0, void 0, function () {
        var user;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, user_model_1.User.findByPk(userId)];
                case 1:
                    user = _a.sent();
                    if (!user) {
                        throw new errors_1.AppError(404, 'USER_NOT_FOUND', 'User not found');
                    }
                    return [2 /*return*/, toPublicUser(user)];
            }
        });
    });
}
