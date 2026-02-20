# Travel Memory App (MVP)

A themed travel memory application with a neon globe landing page, auth flow, dashboard inputs, AI-style photo curation, scrapbook generation, familiar-faces tracking, and trip story creation.

## What this build includes

- Landing page inspired by your attached blue-globe theme.
- Login/Signup screen (local session storage for MVP).
- Dashboard with:
  - Google Maps satellite panel (when API key is set)
  - Travel input form: photos + place + caption + people + timestamp
  - Travel timeline list
- Two-stage memory workflow:
  - **Travel stage:** photo significance scoring, duplicate reduction, AI-style caption enhancement, scrapbook entries, familiar faces count
  - **Trip stage:** editable text narration and read-only video compilation plan output
- All generated text outputs are editable in the UI, except the video plan display.

## Run locally

1. Install dependencies:

```bash
npm install
```

2. Add environment variables:

```bash
cp .env.example .env
```

Set `VITE_GOOGLE_MAPS_API_KEY` in `.env`.

3. Start dev server:

```bash
npm run dev
```

## Production extensions you can add next

- Real authentication (Supabase/Firebase/Auth0/your backend).
- Persist travel/trip data in a DB.
- Replace heuristic curation with an LLM + vision pipeline.
- Face embeddings for robust familiar-person matching.
- Real video rendering pipeline (FFmpeg, cloud render workers, music licensing).
- Map overlays with custom photo markers and route lines.

## Notes

- Google Maps requires a valid API key and billing enabled.
- Current "AI" logic is deterministic and runs in-browser for a fast MVP.
