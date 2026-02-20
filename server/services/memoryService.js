function normalize(value) {
  return (value || '').trim().toLowerCase();
}

function titleCase(value) {
  return value
    .split(' ')
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

function formatDay(dateValue) {
  const date = new Date(dateValue);
  return date.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
}

function buildFingerprint(photo) {
  const people = [...(photo.people || [])].map(normalize).sort().join('|');
  return [normalize(photo.place), normalize(photo.caption).slice(0, 48), people].join('::');
}

function scorePhoto(photo, dailyCountAtPlace, isBoundary) {
  let score = 1;

  if ((photo.people || []).length > 0) {
    score += 1.1;
  }

  if ((photo.caption || '').trim().length >= 24) {
    score += 1;
  }

  if (dailyCountAtPlace <= 2) {
    score += 0.8;
  }

  if (isBoundary) {
    score += 1.2;
  }

  if (photo.recognizedFaceIds?.length) {
    score += 0.5;
  }

  return Number(score.toFixed(2));
}

function enhanceCaption(photo) {
  const raw = (photo.caption || '').trim();
  const people = (photo.people || []).join(', ');

  if (!raw) {
    if (people) {
      return `A memorable stop in ${photo.place} with ${people}.`;
    }

    return `A memorable stop in ${photo.place}.`;
  }

  if (raw.length >= 34) {
    return raw;
  }

  if (people) {
    return `${raw} Shared in ${photo.place} with ${people}.`;
  }

  return `${raw} Captured in ${photo.place}.`;
}

function uniqueByChecksum(photos) {
  const seen = new Set();
  const unique = [];

  photos.forEach((photo) => {
    const key = photo.checksum || `${photo.place}:${photo.timestamp}:${photo.fileName}`;
    if (seen.has(key)) {
      return;
    }

    seen.add(key);
    unique.push(photo);
  });

  return unique;
}

function buildDailyScrapbook(curatedPhotos) {
  const grouped = new Map();

  curatedPhotos.forEach((photo) => {
    const dayKey = new Date(photo.timestamp).toISOString().slice(0, 10);
    if (!grouped.has(dayKey)) {
      grouped.set(dayKey, []);
    }
    grouped.get(dayKey).push(photo);
  });

  return [...grouped.entries()].map(([dayKey, photos]) => {
    const sorted = photos.slice().sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    const start = new Date(sorted[0].timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const end = new Date(sorted[sorted.length - 1].timestamp).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit'
    });
    const places = [...new Set(sorted.map((item) => item.place))].join(', ');
    const highlights = sorted
      .slice(0, 3)
      .map((item) => item.captionEnhanced)
      .join(' ');

    return {
      id: dayKey,
      dayLabel: formatDay(dayKey),
      text: `From ${start} to ${end}, this day flowed through ${places}. ${highlights}`
    };
  });
}

function buildNameFaceCounts(travels) {
  const counts = new Map();

  travels.forEach((travel) => {
    const uniquePeople = new Set((travel.people || []).map(normalize).filter(Boolean));
    uniquePeople.forEach((person) => {
      counts.set(person, (counts.get(person) || 0) + 1);
    });
  });

  return [...counts.entries()]
    .map(([name, tripsTogether]) => ({ name: titleCase(name), tripsTogether, source: 'name' }))
    .sort((a, b) => b.tripsTogether - a.tripsTogether);
}

function buildEmbeddingFaceCounts(travels) {
  const counts = new Map();

  travels.forEach((travel) => {
    const uniqueFaceIds = new Set(
      travel.photos
        .flatMap((photo) => photo.recognizedFaceIds || [])
        .filter(Boolean)
        .map((id) => String(id))
    );

    uniqueFaceIds.forEach((faceId) => {
      counts.set(faceId, (counts.get(faceId) || 0) + 1);
    });
  });

  return [...counts.entries()]
    .map(([faceId, tripsTogether]) => ({
      name: `Familiar Face ${faceId.slice(0, 8)}`,
      tripsTogether,
      source: 'embedding'
    }))
    .sort((a, b) => b.tripsTogether - a.tripsTogether);
}

export async function runMemoryCuration(travels, { aiService }) {
  const flattened = uniqueByChecksum(
    travels
      .flatMap((travel) =>
        travel.photos.map((photo) => ({
          ...photo,
          place: travel.place,
          timestamp: photo.timestamp || travel.timestamp,
          people: travel.people || []
        }))
      )
      .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
  );

  const groupedByDay = new Map();
  flattened.forEach((photo) => {
    const key = new Date(photo.timestamp).toISOString().slice(0, 10);
    if (!groupedByDay.has(key)) {
      groupedByDay.set(key, []);
    }
    groupedByDay.get(key).push(photo);
  });

  const scoredPhotos = [];

  groupedByDay.forEach((photosForDay) => {
    photosForDay.forEach((photo, idx, arr) => {
      const placeCount = arr.filter((item) => normalize(item.place) === normalize(photo.place)).length;
      const isBoundary = idx === 0 || idx === arr.length - 1;
      scoredPhotos.push({
        ...photo,
        score: scorePhoto(photo, placeCount, isBoundary),
        fingerprint: buildFingerprint(photo)
      });
    });
  });

  scoredPhotos.sort((a, b) => b.score - a.score);
  const targetCount = Math.max(2, Math.ceil(scoredPhotos.length * 0.55));

  const selectedByHeuristic = [];
  const fingerprints = new Set();

  for (let i = 0; i < scoredPhotos.length; i += 1) {
    const candidate = scoredPhotos[i];
    if (fingerprints.has(candidate.fingerprint)) {
      continue;
    }
    fingerprints.add(candidate.fingerprint);
    selectedByHeuristic.push(candidate);
    if (selectedByHeuristic.length >= targetCount) {
      break;
    }
  }

  let selectedPhotos = selectedByHeuristic;

  if (aiService?.enabled) {
    try {
      const pickedIds = await aiService.selectMemorablePhotoIds(scoredPhotos, targetCount);
      if (pickedIds?.length) {
        const pickedSet = new Set(pickedIds);
        const aiPicked = scoredPhotos.filter((photo) => pickedSet.has(photo.id));
        if (aiPicked.length) {
          selectedPhotos = aiPicked;
        }
      }
    } catch {
      selectedPhotos = selectedByHeuristic;
    }
  }

  let curatedPhotos = selectedPhotos
    .map((photo) => ({
      ...photo,
      captionEnhanced: enhanceCaption(photo)
    }))
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

  if (aiService?.enabled && curatedPhotos.length) {
    try {
      const aiCaptions = await aiService.enhanceCaptions(curatedPhotos);
      if (aiCaptions?.length) {
        const byId = new Map(aiCaptions.map((item) => [item.photoId, item.captionEnhanced]));
        curatedPhotos = curatedPhotos.map((photo) => ({
          ...photo,
          captionEnhanced: byId.get(photo.id) || photo.captionEnhanced
        }));
      }
    } catch {
      // Keep deterministic captions on AI failure.
    }
  }

  return {
    curatedPhotos,
    scrapbook: buildDailyScrapbook(curatedPhotos),
    familiarFaces: [...buildNameFaceCounts(travels), ...buildEmbeddingFaceCounts(travels)]
  };
}

function buildVideoPlan(curatedPhotos) {
  const scenes = curatedPhotos.map((photo, index) => {
    const time = new Date(photo.timestamp).toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });

    return {
      scene: index + 1,
      title: `${photo.place} - ${time}`,
      caption: photo.captionEnhanced,
      effect: index % 2 === 0 ? 'Slow zoom + parallax' : 'Cross dissolve + pan',
      photoId: photo.id
    };
  });

  return {
    music: 'Ambient cinematic travel score at 92 BPM',
    scenes
  };
}

export async function buildTripStory(curatedPhotos, { aiService, scrapbook, familiarFaces }) {
  if (!curatedPhotos.length) {
    return {
      narration: '',
      videoPlan: buildVideoPlan([])
    };
  }

  const firstDate = new Date(curatedPhotos[0].timestamp).toLocaleDateString();
  const lastDate = new Date(curatedPhotos[curatedPhotos.length - 1].timestamp).toLocaleDateString();

  const fallbackParagraphs = [
    `Between ${firstDate} and ${lastDate}, this trip unfolded as a sequence of places, faces, and small turning points.`,
    ...curatedPhotos.map((photo) => {
      const time = new Date(photo.timestamp).toLocaleString([], {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
      return `${photo.place} (${time}): ${photo.captionEnhanced}`;
    }),
    'Together, these scenes trace a coherent memory arc from departure to return.'
  ];

  let narration = fallbackParagraphs.join('\n\n');

  if (aiService?.enabled) {
    try {
      const aiNarration = await aiService.generateNarration({
        curatedPhotos,
        scrapbook,
        familiarFaces
      });
      if (aiNarration) {
        narration = aiNarration;
      }
    } catch {
      narration = fallbackParagraphs.join('\n\n');
    }
  }

  return {
    narration,
    videoPlan: buildVideoPlan(curatedPhotos)
  };
}
