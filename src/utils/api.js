import { clientLogger, makeRequestId } from './logger';
const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8787';

function toAbsoluteUrl(value) {
  if (!value) {
    return value;
  }

  if (/^https?:\/\//i.test(value)) {
    return value;
  }

  return `${API_BASE}${value}`;
}

function normalizePhoto(photo) {
  return {
    ...photo,
    previewUrl: toAbsoluteUrl(photo.previewUrl)
  };
}

function normalizeTrip(trip) {
  return {
    ...trip,
    curatedPhotos: (trip.curatedPhotos || []).map(normalizePhoto),
    videoUrl: toAbsoluteUrl(trip.videoUrl)
  };
}

async function request(path, options = {}, token) {
  const headers = {
    ...(options.headers || {})
  };
  const method = options.method || 'GET';
  const requestId = makeRequestId();

  if (!(options.body instanceof FormData) && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  headers['x-request-id'] = requestId;

  const isGet = String(method).toUpperCase() === 'GET';
  const startTs = Date.now();
  const requestPath = isGet
    ? `${path}${path.includes('?') ? '&' : '?'}_ts=${Date.now()}`
    : path;

  clientLogger.debug('api.request.start', { requestId, method, path });

  const response = await fetch(`${API_BASE}${requestPath}`, {
    ...options,
    method,
    cache: 'no-store',
    headers
  });

  const payload = await response.json().catch(() => ({}));
  clientLogger.debug('api.request.finish', {
    requestId,
    method,
    path,
    status: response.status,
    durationMs: Date.now() - startTs
  });

  if (!response.ok) {
    clientLogger.error('api.request.error', {
      requestId,
      method,
      path,
      status: response.status,
      error: payload.error || 'Request failed'
    });
    throw new Error(payload.error || 'Request failed');
  }

  return payload;
}

export const api = {
  baseUrl: API_BASE,

  async health() {
    return request('/api/health', { method: 'GET' });
  },

  async signup(data) {
    return request('/api/auth/signup', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  },

  async login(data) {
    return request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  },

  async me(token) {
    return request('/api/auth/me', { method: 'GET' }, token);
  },

  async listTravels(token) {
    const payload = await request('/api/travels', { method: 'GET' }, token);
    return {
      travels: (payload.travels || []).map((travel) => ({
        ...travel,
        photos: (travel.photos || []).map(normalizePhoto)
      }))
    };
  },

  async createTravel(formData, token) {
    const payload = await request(
      '/api/travels',
      {
        method: 'POST',
        body: formData
      },
      token
    );

    return {
      travel: {
        ...payload.travel,
        photos: (payload.travel?.photos || []).map(normalizePhoto)
      }
    };
  },

  async curateTravels(travelIds, token) {
    const payload = await request(
      '/api/trips/curate',
      {
        method: 'POST',
        body: JSON.stringify({ travelIds })
      },
      token
    );

    return { trip: normalizeTrip(payload.trip) };
  },

  async listTrips(token) {
    const payload = await request('/api/trips', { method: 'GET' }, token);
    return { trips: (payload.trips || []).map(normalizeTrip) };
  },

  async createStory(tripId, token) {
    const payload = await request(
      `/api/trips/${tripId}/create-story`,
      {
        method: 'POST'
      },
      token
    );

    return { trip: normalizeTrip(payload.trip) };
  },

  async renderVideo(tripId, token) {
    const payload = await request(
      `/api/trips/${tripId}/render-video`,
      {
        method: 'POST'
      },
      token
    );

    return { trip: normalizeTrip(payload.trip) };
  },

  async updateTrip(tripId, patchPayload, token) {
    const payload = await request(
      `/api/trips/${tripId}`,
      {
        method: 'PATCH',
        body: JSON.stringify(patchPayload)
      },
      token
    );

    return { trip: normalizeTrip(payload.trip) };
  }
};
