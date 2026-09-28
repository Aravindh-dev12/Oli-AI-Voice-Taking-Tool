function sanitize(value) {
  return String(value ?? '')
    .replace(/(api[-_ ]?key|authorization|bearer)\s*[:=]\s*[^\s,;]+/gi, '$1=[REDACTED]')
    .slice(0, 2000);
}

function write(level, message, fields = {}) {
  const payload = {
    ts: new Date().toISOString(),
    level,
    message: sanitize(message),
    ...fields
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
