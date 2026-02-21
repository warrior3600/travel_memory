const debugEnabled = import.meta.env.VITE_DEBUG_LOGS !== 'false';

function emit(level, message, meta = {}) {
  if (!debugEnabled) {
    return;
  }

  const payload = {
    ts: new Date().toISOString(),
    level,
    msg: message,
    ...meta
  };

  if (level === 'error') {
    console.error('[travel-memory-ui]', payload);
    return;
  }

  if (level === 'warn') {
    console.warn('[travel-memory-ui]', payload);
    return;
  }

  if (level === 'debug') {
    console.debug('[travel-memory-ui]', payload);
    return;
  }

  console.log('[travel-memory-ui]', payload);
}

export function makeRequestId() {
  return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export const clientLogger = {
  debug(message, meta) {
    emit('debug', message, meta);
  },
  info(message, meta) {
    emit('info', message, meta);
  },
  warn(message, meta) {
    emit('warn', message, meta);
  },
  error(message, meta) {
    emit('error', message, meta);
  }
};
