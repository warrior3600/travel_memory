import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import multer from 'multer';
import bcrypt from 'bcryptjs';
import exifParser from 'exif-parser';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { v4 as uuidv4 } from 'uuid';
import { authRequired, signToken } from './lib/auth.js';
import { mutateDb, readDb } from './lib/db.js';
import { logger } from './lib/logger.js';
import {
  UPLOADS_ROOT,
  VIDEOS_ROOT,
  buildPublicUploadUrl,
  ensureStorageDirs
} from './lib/storage.js';
import { createGeminiService } from './services/geminiService.js';
import { createFaceService } from './services/faceService.js';
import { buildTripStory, runMemoryCuration } from './services/memoryService.js';
import { renderTripVideo } from './services/videoService.js';

const app = express();
const port = Number(process.env.PORT || 8787);
const aiService = createGeminiService();
const faceService = createFaceService();
const geocodingApiKey =
  process.env.GOOGLE_MAPS_GEOCODING_API_KEY ||
  process.env.GOOGLE_GEOCODING_API_KEY ||
  process.env.VITE_GOOGLE_MAPS_API_KEY ||
  '';

app.use((req, res, next) => {
  const requestId = String(req.headers['x-request-id'] || `req_${uuidv4()}`);
  const startedAt = Date.now();
  req.requestId = requestId;
  req.log = logger.child({
    requestId,
    method: req.method,
    path: req.originalUrl
  });
  res.setHeader('x-request-id', requestId);
  req.log.info('request.start');
  res.on('finish', () => {
    req.log.info('request.finish', {
      statusCode: res.statusCode,
      durationMs: Date.now() - startedAt
    });
  });
  next();
});

function parsePeople(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function checksumBuffer(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function safeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function extractPhotoCoordinates(bytes) {
  try {
    const parsed = exifParser.create(bytes).parse();
    const latitude = parsed?.tags?.GPSLatitude;
    const longitude = parsed?.tags?.GPSLongitude;

    if (
      Number.isFinite(latitude) &&
      Number.isFinite(longitude) &&
      Math.abs(latitude) <= 90 &&
      Math.abs(longitude) <= 180
    ) {
      return {
        latitude: Number(latitude),
        longitude: Number(longitude),
        hasExactLocation: true
      };
    }
  } catch {
    // Ignore malformed EXIF and treat as missing GPS metadata.
  }

  return {
    latitude: null,
    longitude: null,
    hasExactLocation: false
  };
}

function isValidCoordinates(latitude, longitude) {
  return (
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    Math.abs(latitude) <= 90 &&
    Math.abs(longitude) <= 180
  );
}

async function resolveCoordinatesByGeocoding(place, reqLog) {
  if (!geocodingApiKey || !place) {
    return null;
  }

  const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
  url.searchParams.set('address', place);
  url.searchParams.set('key', geocodingApiKey);

  try {
    const response = await fetch(url);
    if (!response.ok) {
      reqLog?.warn('travel.location.geocode_http_error', {
        place,
        status: response.status
      });
      return null;
    }

    const payload = await response.json();
    if (payload?.status !== 'OK' || !payload?.results?.[0]?.geometry?.location) {
      reqLog?.warn('travel.location.geocode_no_result', {
        place,
        status: payload?.status || 'unknown'
      });
      return null;
    }

    const latitude = Number(payload.results[0].geometry.location.lat);
    const longitude = Number(payload.results[0].geometry.location.lng);
    if (!isValidCoordinates(latitude, longitude)) {
      reqLog?.warn('travel.location.geocode_invalid_coordinates', {
        place,
        latitude,
        longitude
      });
      return null;
    }

    return {
      latitude,
      longitude,
      confidence: 0.82,
      source: 'google-geocoding-api'
    };
  } catch (error) {
    reqLog?.warn('travel.location.geocode_failed', {
      place,
      error: error?.message || 'unknown'
    });
    return null;
  }
}

async function backfillMissingCoordinatesForUser(userId, reqLog) {
  const aiPlaceCoordCache = new Map();
  const geocodePlaceCoordCache = new Map();
  const resolvedByPhotoId = new Map();
  let updatedCount = 0;

  await mutateDb(async (db) => {
    const travels = db.travels.filter((entry) => entry.userId === userId);

    for (const travel of travels) {
      for (const photo of travel.photos || []) {
        const hasStoredCoordinates = isValidCoordinates(photo.latitude, photo.longitude);
        if (hasStoredCoordinates) {
          resolvedByPhotoId.set(photo.id, {
            latitude: photo.latitude,
            longitude: photo.longitude,
            locationSource: photo.locationSource || 'stored',
            locationConfidence: Number.isFinite(photo.locationConfidence) ? photo.locationConfidence : 0.8
          });
          continue;
        }

        const place = String(photo.place || travel.place || '').trim();
        const caption = String(photo.caption || '').trim();
        const timestamp = String(photo.timestamp || travel.timestamp || '').trim();
        if (!place) {
          continue;
        }

        let resolved = null;
        let resolvedSource = '';
        const aiCacheKey = `${place.toLowerCase()}::${caption.toLowerCase()}::${timestamp.slice(0, 10)}`;
        if (aiService.enabled) {
          if (aiPlaceCoordCache.has(aiCacheKey)) {
            resolved = aiPlaceCoordCache.get(aiCacheKey);
          } else {
            try {
              resolved = await aiService.inferCoordinatesFromPlace({ place, caption, timestamp });
            } catch (error) {
              reqLog?.warn('travel.location.backfill_ai_failed', {
                place,
                photoId: photo.id,
                error: error?.message || 'unknown'
              });
              resolved = null;
            }
            aiPlaceCoordCache.set(aiCacheKey, resolved);
          }
        }

        if (resolved && isValidCoordinates(resolved.latitude, resolved.longitude)) {
          resolvedSource = 'ai-place-inference';
        }

        if (!resolved || !isValidCoordinates(resolved.latitude, resolved.longitude)) {
          const geocodeKey = place.toLowerCase();
          if (geocodePlaceCoordCache.has(geocodeKey)) {
            resolved = geocodePlaceCoordCache.get(geocodeKey);
          } else {
            resolved = await resolveCoordinatesByGeocoding(place, reqLog);
            geocodePlaceCoordCache.set(geocodeKey, resolved);
          }
          if (resolved && isValidCoordinates(resolved.latitude, resolved.longitude)) {
            resolvedSource = 'google-geocoding-api';
          }
        }

        if (resolved && isValidCoordinates(resolved.latitude, resolved.longitude)) {
          photo.latitude = resolved.latitude;
          photo.longitude = resolved.longitude;
          photo.hasExactLocation = false;
          photo.locationSource = resolved.source || resolvedSource || 'ai-place-inference';
          photo.locationConfidence = resolved.confidence ?? 0.55;
          resolvedByPhotoId.set(photo.id, {
            latitude: photo.latitude,
            longitude: photo.longitude,
            locationSource: photo.locationSource,
            locationConfidence: photo.locationConfidence
          });
          updatedCount += 1;
        }
      }
    }

    const trips = db.trips.filter((entry) => entry.userId === userId);
    for (const trip of trips) {
      for (const photo of trip.curatedPhotos || []) {
        if (isValidCoordinates(photo.latitude, photo.longitude)) {
          continue;
        }
        const resolved = resolvedByPhotoId.get(photo.id);
        if (!resolved) {
          continue;
        }
        photo.latitude = resolved.latitude;
        photo.longitude = resolved.longitude;
        photo.hasExactLocation = false;
        photo.locationSource = resolved.locationSource;
        photo.locationConfidence = resolved.locationConfidence;
      }
    }
  });

  if (updatedCount > 0) {
    reqLog?.info('travel.location.backfill_completed', {
      userId,
      updatedPhotos: updatedCount
    });
  }
}

function serializePhoto(photo) {
  return {
    id: photo.id,
    fileName: photo.fileName,
    previewUrl: photo.previewUrl,
    caption: photo.caption,
    captionEnhanced: photo.captionEnhanced || '',
    timestamp: photo.timestamp,
    place: photo.place,
    score: photo.score || 0,
    people: photo.people || [],
    recognizedFaceIds: photo.recognizedFaceIds || [],
    latitude: Number.isFinite(photo.latitude) ? photo.latitude : null,
    longitude: Number.isFinite(photo.longitude) ? photo.longitude : null,
    hasExactLocation: Boolean(photo.hasExactLocation),
    locationSource: photo.locationSource || 'none',
    locationConfidence: Number.isFinite(photo.locationConfidence) ? photo.locationConfidence : null
  };
}

function serializeTravel(travel) {
  return {
    id: travel.id,
    place: travel.place,
    people: travel.people,
    timestamp: travel.timestamp,
    createdAt: travel.createdAt,
    photos: travel.photos.map(serializePhoto)
  };
}

function serializeTrip(trip) {
  return {
    id: trip.id,
    createdAt: trip.createdAt,
    updatedAt: trip.updatedAt,
    travelIds: trip.travelIds,
    curatedPhotos: (trip.curatedPhotos || []).map(serializePhoto),
    scrapbook: trip.scrapbook || [],
    familiarFaces: trip.familiarFaces || [],
    narration: trip.narration || '',
    videoPlan: trip.videoPlan || null,
    videoStatus: trip.videoStatus || 'idle',
    videoUrl: trip.videoUrl || ''
  };
}

app.use(
  cors({
    origin: process.env.CLIENT_ORIGIN || true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-request-id']
  })
);
app.use(express.json({ limit: '4mb' }));
app.use('/api/uploads', express.static(UPLOADS_ROOT));
app.use('/api/videos', express.static(VIDEOS_ROOT));

const upload = multer({
  storage: multer.diskStorage({
    destination: async (req, file, cb) => {
      try {
        const userDir = path.join(UPLOADS_ROOT, req.user.id);
        await fs.mkdir(userDir, { recursive: true });
        cb(null, userDir);
      } catch (error) {
        cb(error);
      }
    },
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname || '') || '.jpg';
      cb(null, `${uuidv4()}${ext}`);
    }
  }),
  limits: {
    fileSize: 18 * 1024 * 1024,
    files: 30
  },
  fileFilter: (req, file, cb) => {
    if ((file.mimetype || '').startsWith('image/')) {
      cb(null, true);
      return;
    }

    cb(new Error('Only image uploads are supported'));
  }
});

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    aiEnabled: aiService.enabled,
    aiProvider: aiService.provider,
    aiModel: aiService.model,
    geocodingEnabled: Boolean(geocodingApiKey),
    faceEmbeddingEnabled: faceService.enabled,
    videoRenderingEnabled: true
  });
});

app.post('/api/auth/signup', async (req, res) => {
  const email = safeEmail(req.body?.email);
  const name = String(req.body?.name || '').trim();
  const password = String(req.body?.password || '');

  if (!email || !password || password.length < 6) {
    res.status(400).json({ error: 'Name/email/password (min 6 chars) required' });
    return;
  }

  try {
    const passwordHash = await bcrypt.hash(password, 10);
    const user = {
      id: `usr_${uuidv4()}`,
      name: name || email.split('@')[0],
      email,
      passwordHash,
      createdAt: new Date().toISOString()
    };
    const created = await mutateDb((db) => {
      const exists = db.users.some((entry) => entry.email === email);
      if (exists) {
        return false;
      }
      db.users.push(user);
      return true;
    });

    if (!created) {
      res.status(409).json({ error: 'Email already exists' });
      return;
    }

    const token = signToken({ id: user.id, email: user.email, name: user.name });
    res.status(201).json({
      token,
      user: { id: user.id, email: user.email, name: user.name }
    });
  } catch (error) {
    res.status(500).json({ error: 'Signup failed', detail: error.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const email = safeEmail(req.body?.email);
  const password = String(req.body?.password || '');

  if (!email || !password) {
    res.status(400).json({ error: 'Email and password required' });
    return;
  }

  try {
    const db = await readDb();
    const user = db.users.find((entry) => entry.email === email);

    if (!user) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    const token = signToken({ id: user.id, email: user.email, name: user.name });
    res.json({
      token,
      user: { id: user.id, email: user.email, name: user.name }
    });
  } catch (error) {
    res.status(500).json({ error: 'Login failed', detail: error.message });
  }
});

app.get('/api/auth/me', authRequired, async (req, res) => {
  const db = await readDb();
  const user = db.users.find((entry) => entry.id === req.user.id);
  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  res.json({ user: { id: user.id, email: user.email, name: user.name } });
});

app.get('/api/travels', authRequired, async (req, res) => {
  try {
    await backfillMissingCoordinatesForUser(req.user.id, req.log);
    const db = await readDb();
    const travels = db.travels.filter((travel) => travel.userId === req.user.id);
    travels.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    res.json({ travels: travels.map(serializeTravel) });
  } catch (error) {
    req.log.error('travel.list.failed', { error: error?.message || 'unknown' });
    res.status(500).json({ error: 'Failed to list travels', detail: error.message });
  }
});

app.post('/api/travels', authRequired, upload.array('photos', 30), async (req, res) => {
  const place = String(req.body?.place || '').trim();
  const caption = String(req.body?.caption || '').trim();
  const people = parsePeople(req.body?.people);
  const timestamp = String(req.body?.timestamp || '').trim() || new Date().toISOString();

  if (!place || !req.files?.length) {
    res.status(400).json({ error: 'place and at least one photo are required' });
    return;
  }

  try {
    const photos = [];
    const aiPlaceCoordCache = new Map();
    const geocodePlaceCoordCache = new Map();

    for (const file of req.files) {
      const fileBytes = await fs.readFile(file.path);
      const checksum = checksumBuffer(fileBytes);
      const location = extractPhotoCoordinates(fileBytes);
      let latitude = location.latitude;
      let longitude = location.longitude;
      let hasExactLocation = location.hasExactLocation;
      let locationSource = hasExactLocation ? 'exif' : 'none';
      let locationConfidence = hasExactLocation ? 1 : null;

      if (!hasExactLocation && aiService.enabled) {
        const cacheKey = `${place.toLowerCase()}::${caption.toLowerCase()}::${timestamp.slice(0, 10)}`;
        let aiCoords = aiPlaceCoordCache.get(cacheKey);

        if (aiCoords === undefined) {
          try {
            aiCoords = await aiService.inferCoordinatesFromPlace({
              place,
              caption,
              timestamp
            });
          } catch (error) {
            req.log.warn('travel.location.ai_inference_failed', {
              place,
              error: error?.message || 'unknown'
            });
            aiCoords = null;
          }
          aiPlaceCoordCache.set(cacheKey, aiCoords);
        }

        if (aiCoords && isValidCoordinates(aiCoords.latitude, aiCoords.longitude)) {
          latitude = aiCoords.latitude;
          longitude = aiCoords.longitude;
          hasExactLocation = false;
          locationSource = 'ai-place-inference';
          locationConfidence = aiCoords.confidence ?? 0.45;
        }
      }

      if (!hasExactLocation && !isValidCoordinates(latitude, longitude)) {
        const geocodeKey = place.toLowerCase();
        let geocoded = geocodePlaceCoordCache.get(geocodeKey);
        if (geocoded === undefined) {
          geocoded = await resolveCoordinatesByGeocoding(place, req.log);
          geocodePlaceCoordCache.set(geocodeKey, geocoded);
        }

        if (geocoded && isValidCoordinates(geocoded.latitude, geocoded.longitude)) {
          latitude = geocoded.latitude;
          longitude = geocoded.longitude;
          hasExactLocation = false;
          locationSource = 'google-geocoding-api';
          locationConfidence = geocoded.confidence ?? 0.82;
        }
      }

      let recognizedFaceIds = [];
      if (faceService.enabled) {
        try {
          const faceResult = await faceService.analyzePhoto({
            userId: req.user.id,
            bytes: fileBytes,
            externalImageId: people[0] || req.user.id
          });
          recognizedFaceIds = faceResult.recognizedFaceIds || [];
        } catch {
          recognizedFaceIds = [];
        }
      }

      const relativePath = `${req.user.id}/${file.filename}`;
      req.log.info('travel.photo.location_resolved', {
        fileName: file.originalname,
        place,
        latitude: isValidCoordinates(latitude, longitude) ? latitude : null,
        longitude: isValidCoordinates(latitude, longitude) ? longitude : null,
        hasExactLocation,
        locationSource,
        locationConfidence
      });

      photos.push({
        id: `photo_${uuidv4()}`,
        fileName: file.originalname,
        absolutePath: file.path,
        previewUrl: buildPublicUploadUrl(relativePath),
        caption: caption || file.originalname,
        captionEnhanced: '',
        place,
        timestamp,
        checksum,
        recognizedFaceIds,
        latitude: isValidCoordinates(latitude, longitude) ? latitude : null,
        longitude: isValidCoordinates(latitude, longitude) ? longitude : null,
        hasExactLocation,
        locationSource,
        locationConfidence,
        people,
        mimeType: file.mimetype,
        size: file.size
      });
    }

    const travel = {
      id: `travel_${uuidv4()}`,
      userId: req.user.id,
      place,
      people,
      timestamp,
      photos,
      createdAt: new Date().toISOString()
    };

    await mutateDb((db) => {
      db.travels.push(travel);
    });

    res.status(201).json({ travel: serializeTravel(travel) });
  } catch (error) {
    res.status(500).json({ error: 'Failed to save travel', detail: error.message });
  }
});

app.get('/api/trips', authRequired, async (req, res) => {
  try {
    await backfillMissingCoordinatesForUser(req.user.id, req.log);
    const db = await readDb();
    const trips = db.trips
      .filter((trip) => trip.userId === req.user.id)
      .sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt));

    res.json({ trips: trips.map(serializeTrip) });
  } catch (error) {
    req.log.error('trip.list.failed', { error: error?.message || 'unknown' });
    res.status(500).json({ error: 'Failed to list trips', detail: error.message });
  }
});

app.post('/api/trips/curate', authRequired, async (req, res) => {
  const requestedTravelIds = Array.isArray(req.body?.travelIds) ? req.body.travelIds : null;

  try {
    const db = await readDb();
    const allTravels = db.travels.filter((travel) => travel.userId === req.user.id);
    const travels = requestedTravelIds?.length
      ? allTravels.filter((travel) => requestedTravelIds.includes(travel.id))
      : allTravels;

    if (!travels.length) {
      res.status(400).json({ error: 'No travels available for curation' });
      return;
    }

    const curation = await runMemoryCuration(travels, { aiService });

    const trip = {
      id: `trip_${uuidv4()}`,
      userId: req.user.id,
      travelIds: travels.map((travel) => travel.id),
      curatedPhotos: curation.curatedPhotos,
      scrapbook: curation.scrapbook,
      familiarFaces: curation.familiarFaces,
      narration: '',
      videoPlan: null,
      videoStatus: 'idle',
      videoUrl: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    await mutateDb((nextDb) => {
      nextDb.trips.push(trip);
    });

    res.status(201).json({ trip: serializeTrip(trip) });
  } catch (error) {
    res.status(500).json({ error: 'Curation failed', detail: error.message });
  }
});

app.post('/api/trips/:tripId/create-story', authRequired, async (req, res) => {
  const { tripId } = req.params;

  try {
    const db = await readDb();
    const trip = db.trips.find((entry) => entry.id === tripId && entry.userId === req.user.id);

    if (!trip) {
      res.status(404).json({ error: 'Trip not found' });
      return;
    }

    const story = await buildTripStory(trip.curatedPhotos || [], {
      aiService,
      scrapbook: trip.scrapbook || [],
      familiarFaces: trip.familiarFaces || []
    });

    await mutateDb((nextDb) => {
      const target = nextDb.trips.find((entry) => entry.id === tripId && entry.userId === req.user.id);
      if (!target) {
        return;
      }
      target.narration = story.narration;
      target.videoPlan = story.videoPlan;
      target.updatedAt = new Date().toISOString();
    });

    const updatedDb = await readDb();
    const updatedTrip = updatedDb.trips.find((entry) => entry.id === tripId && entry.userId === req.user.id);

    res.json({ trip: serializeTrip(updatedTrip) });
  } catch (error) {
    res.status(500).json({ error: 'Story generation failed', detail: error.message });
  }
});

app.post('/api/trips/:tripId/render-video', authRequired, async (req, res) => {
  const { tripId } = req.params;

  try {
    const db = await readDb();
    const trip = db.trips.find((entry) => entry.id === tripId && entry.userId === req.user.id);
    if (!trip) {
      res.status(404).json({ error: 'Trip not found' });
      return;
    }

    await mutateDb((nextDb) => {
      const target = nextDb.trips.find((entry) => entry.id === tripId && entry.userId === req.user.id);
      if (!target) {
        return;
      }
      target.videoStatus = 'rendering';
      target.updatedAt = new Date().toISOString();
    });

    const { videoUrl } = await renderTripVideo({
      userId: req.user.id,
      tripId,
      curatedPhotos: trip.curatedPhotos || []
    });

    await mutateDb((nextDb) => {
      const target = nextDb.trips.find((entry) => entry.id === tripId && entry.userId === req.user.id);
      if (!target) {
        return;
      }
      target.videoStatus = 'ready';
      target.videoUrl = videoUrl;
      target.updatedAt = new Date().toISOString();
    });

    const updatedDb = await readDb();
    const updatedTrip = updatedDb.trips.find((entry) => entry.id === tripId && entry.userId === req.user.id);

    res.json({ trip: serializeTrip(updatedTrip) });
  } catch (error) {
    await mutateDb((nextDb) => {
      const target = nextDb.trips.find((entry) => entry.id === tripId && entry.userId === req.user.id);
      if (!target) {
        return;
      }
      target.videoStatus = 'failed';
      target.updatedAt = new Date().toISOString();
    });

    res.status(500).json({ error: 'Video rendering failed', detail: error.message });
  }
});

app.patch('/api/trips/:tripId', authRequired, async (req, res) => {
  const { tripId } = req.params;

  try {
    await mutateDb((db) => {
      const trip = db.trips.find((entry) => entry.id === tripId && entry.userId === req.user.id);
      if (!trip) {
        return;
      }

      if (typeof req.body?.narration === 'string') {
        trip.narration = req.body.narration;
      }

      if (Array.isArray(req.body?.scrapbook)) {
        const textById = new Map(
          req.body.scrapbook
            .filter((entry) => entry && typeof entry.id === 'string' && typeof entry.text === 'string')
            .map((entry) => [entry.id, entry.text])
        );

        trip.scrapbook = (trip.scrapbook || []).map((entry) => ({
          ...entry,
          text: textById.get(entry.id) || entry.text
        }));
      }

      if (Array.isArray(req.body?.curatedPhotos)) {
        const captionById = new Map(
          req.body.curatedPhotos
            .filter((entry) => entry && typeof entry.id === 'string' && typeof entry.captionEnhanced === 'string')
            .map((entry) => [entry.id, entry.captionEnhanced])
        );

        trip.curatedPhotos = (trip.curatedPhotos || []).map((photo) => ({
          ...photo,
          captionEnhanced: captionById.get(photo.id) || photo.captionEnhanced
        }));
      }

      trip.updatedAt = new Date().toISOString();
    });

    const db = await readDb();
    const updatedTrip = db.trips.find((entry) => entry.id === tripId && entry.userId === req.user.id);

    if (!updatedTrip) {
      res.status(404).json({ error: 'Trip not found' });
      return;
    }

    res.json({ trip: serializeTrip(updatedTrip) });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update trip', detail: error.message });
  }
});

app.use((error, req, res, next) => {
  if (error) {
    req?.log?.error('request.error', {
      statusCode: 400,
      error: error?.message || 'Request error'
    });
    res.status(400).json({ error: error.message || 'Request error' });
    return;
  }

  next();
});

await ensureStorageDirs();

app.listen(port, () => {
  logger.info('server.started', {
    port,
    url: `http://localhost:${port}`,
    aiEnabled: aiService.enabled,
    aiModel: aiService.model,
    geocodingEnabled: Boolean(geocodingApiKey)
  });
});
