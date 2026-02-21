import { logger } from '../lib/logger.js';

function extractText(responsePayload) {
  const candidate = responsePayload?.candidates?.[0];
  const parts = candidate?.content?.parts || [];
  return parts
    .map((part) => part?.text || '')
    .join('')
    .trim();
}

function parseJsonFromText(text) {
  if (!text) {
    return null;
  }

  const cleaned = text
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/```$/, '')
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

async function generateContent({
  apiKey,
  model,
  systemInstruction,
  prompt,
  temperature,
  expectJson = true
}) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const body = {
    systemInstruction: {
      parts: [{ text: systemInstruction }]
    },
    contents: [
      {
        role: 'user',
        parts: [{ text: prompt }]
      }
    ],
    generationConfig: {
      temperature
    }
  };

  if (expectJson) {
    body.generationConfig.responseMimeType = 'application/json';
  }

  let response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  if (!response.ok && expectJson) {
    const retryBody = {
      ...body,
      generationConfig: {
        temperature
      }
    };

    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(retryBody)
    });
  }

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Gemini request failed: ${response.status} ${detail.slice(0, 300)}`);
  }

  const payload = await response.json();
  return extractText(payload);
}

export function createGeminiService() {
  const apiKey = process.env.GEMINI_API_KEY;
  const requestedModel = process.env.GEMINI_TEXT_MODEL || process.env.GEMINI_MODEL || '';
  const model =
    requestedModel && !/image|vision/i.test(requestedModel)
      ? requestedModel
      : 'gemini-2.5-flash';

  if (!apiKey) {
    return {
      enabled: false,
      provider: 'none',
      model: '',
      async selectMemorablePhotoIds() {
        return null;
      },
      async enhanceCaptions() {
        return null;
      },
      async generateNarration() {
        return null;
      },
      async inferCoordinatesFromPlace() {
        return null;
      }
    };
  }

  return {
    enabled: true,
    provider: 'gemini',
    model,

    async selectMemorablePhotoIds(photos, targetCount) {
      const promptPayload = photos.map((photo) => ({
        photoId: photo.id,
        place: photo.place,
        caption: photo.caption,
        timestamp: photo.timestamp,
        people: photo.people,
        score: photo.score,
        duplicateGroup: photo.fingerprint
      }));

      const text = await generateContent({
        apiKey,
        model,
        temperature: 0.2,
        systemInstruction:
          'You are a travel memory curator. Keep only meaningful and non-redundant moments. Return strict JSON only.',
        prompt: JSON.stringify({
          targetCount,
          photos: promptPayload,
          schema: {
            selectedPhotoIds: ['photoId1', 'photoId2'],
            reasoning: ['short reason']
          }
        })
      });

      const parsed = parseJsonFromText(text);
      if (!parsed || !Array.isArray(parsed.selectedPhotoIds)) {
        return null;
      }

      return parsed.selectedPhotoIds;
    },

    async enhanceCaptions(curatedPhotos) {
      const text = await generateContent({
        apiKey,
        model,
        temperature: 0.35,
        systemInstruction:
          'Rewrite each caption to be vivid but concise. Keep chronology and place context. Return strict JSON only.',
        prompt: JSON.stringify({
          photos: curatedPhotos.map((photo) => ({
            photoId: photo.id,
            place: photo.place,
            timestamp: photo.timestamp,
            people: photo.people,
            caption: photo.caption
          })),
          schema: {
            captions: [{ photoId: 'id', captionEnhanced: 'string' }]
          }
        })
      });

      const parsed = parseJsonFromText(text);
      if (!parsed || !Array.isArray(parsed.captions)) {
        return null;
      }

      return parsed.captions;
    },

    async generateNarration({ curatedPhotos, scrapbook, familiarFaces }) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          systemInstruction: {
            parts: [
              {
                text: 'You write elegant chronological travel stories. Keep it emotionally rich but factual to provided moments.'
              }
            ]
          },
          contents: [
            {
              role: 'user',
              parts: [
                {
                  text: JSON.stringify({
                    curatedPhotos: curatedPhotos.map((photo) => ({
                      place: photo.place,
                      timestamp: photo.timestamp,
                      caption: photo.captionEnhanced || photo.caption
                    })),
                    scrapbook,
                    familiarFaces,
                    output: 'Return plain text narration with 4-8 short paragraphs.'
                  })
                }
              ]
            }
          ],
          generationConfig: {
            temperature: 0.45
          }
        })
      });

      if (!response.ok) {
        const detail = await response.text();
        throw new Error(`Gemini request failed: ${response.status} ${detail.slice(0, 300)}`);
      }

      const payload = await response.json();
      return extractText(payload) || null;
    },

    async inferCoordinatesFromPlace({ place, caption, timestamp }) {
      const text = await generateContent({
        apiKey,
        model,
        temperature: 0.1,
        systemInstruction:
          'You are a location resolver. Convert place text to a single best latitude/longitude point and return strict JSON only.',
        prompt: JSON.stringify({
          place,
          caption: caption || '',
          timestamp: timestamp || '',
          instructions: [
            'Use globally recognized coordinates for the provided place.',
            'If location is ambiguous, choose the most likely travel destination and lower confidence.',
            'If unknown, return null latitude and longitude.'
          ],
          schema: {
            latitude: 0,
            longitude: 0,
            confidence: 0.0
          }
        })
      });

      const parsed = parseJsonFromText(text);
      const parsedLatitude = Number(parsed?.latitude ?? parsed?.lat ?? parsed?.location?.latitude);
      const parsedLongitude = Number(parsed?.longitude ?? parsed?.lng ?? parsed?.location?.longitude);
      const confidence = Number(parsed?.confidence);
      let latitude = parsedLatitude;
      let longitude = parsedLongitude;

      const isDirectValid =
        Number.isFinite(latitude) &&
        Number.isFinite(longitude) &&
        Math.abs(latitude) <= 90 &&
        Math.abs(longitude) <= 180;

      if (!isDirectValid) {
        const isSwappedValid =
          Number.isFinite(parsedLatitude) &&
          Number.isFinite(parsedLongitude) &&
          Math.abs(parsedLongitude) <= 90 &&
          Math.abs(parsedLatitude) <= 180;

        if (isSwappedValid) {
          latitude = parsedLongitude;
          longitude = parsedLatitude;
          logger.warn('gemini.coordinates.swapped_fix_applied', {
            place,
            rawLatitude: parsedLatitude,
            rawLongitude: parsedLongitude
          });
        }
      }

      if (
        Number.isFinite(latitude) &&
        Number.isFinite(longitude) &&
        Math.abs(latitude) <= 90 &&
        Math.abs(longitude) <= 180
      ) {
        return {
          latitude,
          longitude,
          confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0.45
        };
      }

      logger.warn('gemini.coordinates.invalid_response', {
        place,
        parsed
      });
      return null;
    }
  };
}
