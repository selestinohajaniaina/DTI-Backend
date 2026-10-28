"use strict";
// Minimal structured logger (JSON lines). No dependencies.
// Never pass secrets (passwords, tokens, connection strings) as log context.
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = void 0;
var LEVEL_ORDER = {
    debug: 10,
    info: 20,
    warn: 30,
    error: 40,
};
function currentLevel() {
    var _a;
    var raw = ((_a = process.env.LOG_LEVEL) !== null && _a !== void 0 ? _a : '').toLowerCase();
    if (raw === 'debug' || raw === 'info' || raw === 'warn' || raw === 'error') {
        return raw;
    }
    return process.env.NODE_ENV === 'production' ? 'info' : 'debug';
}
function serialize(value) {
    if (value instanceof Error) {
        return { name: value.name, message: value.message, stack: value.stack };
    }
    if (Array.isArray(value)) {
        return value.map(serialize);
    }
    if (typeof value === 'object' && value !== null) {
        var out = {};
        for (var _i = 0, _a = Object.entries(value); _i < _a.length; _i++) {
            var _b = _a[_i], key = _b[0], entry = _b[1];
            out[key] = serialize(entry);
        }
        return out;
    }
    return value;
}
function write(level, message, context) {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[currentLevel()]) {
        return;
    }
    var line;
    try {
        var record = {
            timestamp: new Date().toISOString(),
            level: level,
            message: message,
        };
        if (context) {
            Object.assign(record, serialize(context));
        }
        line = JSON.stringify(record);
    }
    catch (_a) {
        line = JSON.stringify({ timestamp: new Date().toISOString(), level: level, message: message });
    }
    if (level === 'error' || level === 'warn') {
        process.stderr.write("".concat(line, "\n"));
    }
    else {
        process.stdout.write("".concat(line, "\n"));
    }
}
exports.logger = {
    debug: function (message, context) { return write('debug', message, context); },
    info: function (message, context) { return write('info', message, context); },
    warn: function (message, context) { return write('warn', message, context); },
    error: function (message, context) { return write('error', message, context); },
};
