import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import multer from 'multer';
import bcrypt from 'bcryptjs';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { v4 as uuidv4 } from 'uuid';
import { authRequired, signToken } from './lib/auth.js';
import { mutateDb, readDb } from './lib/db.js';
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
    recognizedFaceIds: photo.recognizedFaceIds || []
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
    allowedHeaders: ['Content-Type', 'Authorization']
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
  const db = await readDb();
  const travels = db.travels.filter((travel) => travel.userId === req.user.id);
  travels.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  res.json({ travels: travels.map(serializeTravel) });
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

    for (const file of req.files) {
      const fileBytes = await fs.readFile(file.path);
      const checksum = checksumBuffer(fileBytes);

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
  const db = await readDb();
  const trips = db.trips
    .filter((trip) => trip.userId === req.user.id)
    .sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt));

  res.json({ trips: trips.map(serializeTrip) });
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
    res.status(400).json({ error: error.message || 'Request error' });
    return;
  }

  next();
});

await ensureStorageDirs();

app.listen(port, () => {
  console.log(`travel-memory API running on http://localhost:${port}`);
});
