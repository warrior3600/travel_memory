# Travel Memory App (Full-stack MVP)

A themed travel memory platform with:
- Interactive globe landing page
- Signup/login and JWT auth
- Enlarged Google Maps hybrid dashboard (satellite + city labels)
- Travel input uploads (photos + place + caption + people + timestamp)
- Gemini-assisted curation and trip story generation
- Familiar face tracking (name tags + optional face-embedding provider)
- FFmpeg video compilation rendering from curated trip photos

## Stack

- Frontend: React + Vite
- Backend: Node.js + Express
- Storage: JSON database (`server/storage/db.json`) + local file storage
- AI provider: Google Gemini API (optional, graceful fallback to deterministic logic)
- Face embeddings provider: AWS Rekognition (optional)
- Video rendering: FFmpeg via `ffmpeg-static`

## Run locally

1. Install dependencies:

```bash
npm install
```

2. Create env file:

```bash
cp .env.example .env
```

3. Set required values in `.env`:

- `JWT_SECRET`
- `VITE_GOOGLE_MAPS_API_KEY`

Optional integrations:
- `GEMINI_API_KEY` and `GEMINI_TEXT_MODEL` for text-in/text-out curation and narration
  - Recommended text model: `gemini-2.5-flash`
- Optional image model config for future image-generation features:
  - `GEMINI_MODEL=gemini-2.5-flash-image`
- Optional place geocoding fallback for location pinning:
  - `GOOGLE_MAPS_GEOCODING_API_KEY` (can reuse same Google key if Geocoding API is enabled)
- `FACE_PROVIDER=aws-rekognition` and AWS credentials for face embedding matches
- `LOG_LEVEL=debug` for backend structured logs
- `VITE_DEBUG_LOGS=true` for frontend request/action logs in browser console

4. Start client + server:

```bash
npm run dev
```

- Frontend: `http://localhost:5173`
- Backend API: `http://localhost:8787`

## API overview

- `POST /api/auth/signup`
- `POST /api/auth/login`
- `GET /api/auth/me`
- `GET /api/travels`
- `POST /api/travels` (multipart photos)
- `GET /api/trips`
- `POST /api/trips/curate`
- `POST /api/trips/:tripId/create-story`
- `POST /api/trips/:tripId/render-video`
- `PATCH /api/trips/:tripId` (editable outputs)

## Notes

- Generated text outputs remain editable in the UI and are saved back to backend.
- Video compilation is intentionally non-editable in UI and rendered on backend.
- Map pins use exact EXIF GPS coordinates when present, then Gemini place-to-coordinate inference, then Google Geocoding API fallback, and finally an approximate text fallback.
- Persisted database file is `server/storage/db.json`.
- Files are stored under `server/storage/uploads` and `server/storage/videos`.
- API requests include `x-request-id` so frontend and backend logs can be correlated.
- Current persistence is filesystem-based; replace with PostgreSQL/Mongo for production.
