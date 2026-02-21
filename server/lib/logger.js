const LEVELS = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
};

function normalizeLevel(value) {
  const level = String(value || 'info').toLowerCase();
  return Object.prototype.hasOwnProperty.call(LEVELS, level) ? level : 'info';
}

const minLevelName = normalizeLevel(process.env.LOG_LEVEL);
const minLevel = LEVELS[minLevelName];

function shouldLog(level) {
  return LEVELS[level] >= minLevel;
}

function write(level, message, context = {}) {
  if (!shouldLog(level)) {
    return;
  }

  const payload = {
    ts: new Date().toISOString(),
    level,
    msg: message,
    ...context
  };

  const line = JSON.stringify(payload);
  if (level === 'error') {
    console.error(line);
    return;
  }
  console.log(line);
}

export function createLogger(context = {}) {
  return {
    debug(message, meta = {}) {
      write('debug', message, { ...context, ...meta });
    },
    info(message, meta = {}) {
      write('info', message, { ...context, ...meta });
    },
    warn(message, meta = {}) {
      write('warn', message, { ...context, ...meta });
    },
    error(message, meta = {}) {
      write('error', message, { ...context, ...meta });
    },
    child(extra = {}) {
      return createLogger({ ...context, ...extra });
    }
  };
}

export const logger = createLogger({ service: 'travel-memory-api' });
