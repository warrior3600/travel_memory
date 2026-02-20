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

async function generateContent({ apiKey, model, systemInstruction, prompt, temperature }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
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
        temperature,
        responseMimeType: 'application/json'
      }
    })
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Gemini request failed: ${response.status} ${detail.slice(0, 300)}`);
  }

  const payload = await response.json();
  return extractText(payload);
}

export function createGeminiService() {
  const apiKey = process.env.GEMINI_API_KEY;
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
      }
    };
  }

  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

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
    }
  };
}
