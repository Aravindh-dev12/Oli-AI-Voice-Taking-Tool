function sanitize(value) {
  return String(value ?? '')
    .replace(/(api[-_ ]?key|authorization|bearer)\s*[:=]\s*[^\s,;]+/gi, '$1=[REDACTED]')
    .slice(0, 2000);
}

function sanitizeFields(fields) {
  const output = {};
  for (const [key, value] of Object.entries(fields || {})) {
    if (typeof value === 'string') output[key] = sanitize(value);
    else if (typeof value === 'number' || typeof value === 'boolean' || value == null) output[key] = value;
    else output[key] = '[REDACTED_OBJECT]';
  }
  return output;
}

function write(level, message, fields = {}) {
  const payload = {
    ts: new Date().toISOString(),
    level,
    message: sanitize(message),
    ...sanitizeFields(fields)
  };
  process.stderr.write(JSON.stringify(payload) + '\n');
}

export function createLogger(scope = 'oli') {
  return {
    info(message, fields) { write('info', '[' + scope + '] ' + message, fields); },
    warn(message, fields) { write('warn', '[' + scope + '] ' + message, fields); },
    error(message, fields) { write('error', '[' + scope + '] ' + message, fields); }
  };
}
