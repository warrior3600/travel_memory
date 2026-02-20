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
  const people = [...photo.people].map(normalize).sort().join('|');
  return [normalize(photo.place), normalize(photo.caption).slice(0, 48), people].join('::');
}

function scorePhoto(photo, dailyCountAtPlace, isBoundary) {
  let score = 1;

  if (photo.people.length > 0) {
    score += 1.1;
  }

  if (photo.caption.trim().length >= 24) {
    score += 1;
  }

  if (dailyCountAtPlace <= 2) {
    score += 0.8;
  }

  if (isBoundary) {
    score += 1.2;
  }

  return Number(score.toFixed(2));
}

function enhanceCaption(photo) {
  const raw = photo.caption.trim();
  const people = photo.people.join(', ');

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

function buildFaceCounts(travels) {
  const counts = new Map();

  travels.forEach((travel) => {
    const uniquePeople = new Set(
      travel.people
        .map((person) => person.trim())
        .filter(Boolean)
        .map((person) => normalize(person))
    );

    uniquePeople.forEach((person) => {
      counts.set(person, (counts.get(person) || 0) + 1);
    });
  });

  return [...counts.entries()]
    .map(([name, tripsTogether]) => ({ name: titleCase(name), tripsTogether }))
    .sort((a, b) => b.tripsTogether - a.tripsTogether);
}

export function runMemoryCuration(travels) {
  const flattened = travels
    .flatMap((travel) =>
      travel.photos.map((photo) => ({
        ...photo,
        place: travel.place,
        timestamp: photo.timestamp || travel.timestamp,
        people: travel.people
      }))
    )
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

  const groupedByDay = new Map();
  flattened.forEach((photo) => {
    const key = new Date(photo.timestamp).toISOString().slice(0, 10);
    if (!groupedByDay.has(key)) {
      groupedByDay.set(key, []);
    }
    groupedByDay.get(key).push(photo);
  });

  const chosen = [];

  groupedByDay.forEach((photosForDay) => {
    const fingerprints = new Set();

    const withScores = photosForDay.map((photo, idx, arr) => {
      const placeCount = arr.filter((item) => normalize(item.place) === normalize(photo.place)).length;
      const isBoundary = idx === 0 || idx === arr.length - 1;
      return {
        ...photo,
        score: scorePhoto(photo, placeCount, isBoundary),
        fingerprint: buildFingerprint(photo)
      };
    });

    withScores.sort((a, b) => b.score - a.score);

    for (let i = 0; i < withScores.length; i += 1) {
      const candidate = withScores[i];
      if (fingerprints.has(candidate.fingerprint)) {
        continue;
      }
      fingerprints.add(candidate.fingerprint);

      chosen.push({
        ...candidate,
        captionEnhanced: enhanceCaption(candidate)
      });

      if (fingerprints.size >= Math.max(2, Math.ceil(withScores.length * 0.55))) {
        break;
      }
    }
  });

  const curatedPhotos = chosen.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

  return {
    curatedPhotos,
    scrapbook: buildDailyScrapbook(curatedPhotos),
    familiarFaces: buildFaceCounts(travels)
  };
}

export function buildTripStory(curatedPhotos) {
  if (!curatedPhotos.length) {
    return {
      narration: '',
      videoPlan: { music: '', scenes: [] }
    };
  }

  const firstDate = new Date(curatedPhotos[0].timestamp).toLocaleDateString();
  const lastDate = new Date(curatedPhotos[curatedPhotos.length - 1].timestamp).toLocaleDateString();

  const timeline = curatedPhotos.map((photo, index) => {
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
      effect: index % 2 === 0 ? 'Slow zoom + parallax' : 'Cross dissolve + pan'
    };
  });

  const paragraphs = [
    `Between ${firstDate} and ${lastDate}, this trip unfolded as a sequence of places, faces, and small turning points.`,
    ...timeline.map(
      (item) =>
        `${item.title}: ${item.caption} The moment sits naturally in the broader rhythm of the journey.`
    ),
    'Together, these scenes trace a coherent memory arc from departure to return.'
  ];

  return {
    narration: paragraphs.join('\n\n'),
    videoPlan: {
      music: 'Ambient cinematic travel score at 92 BPM',
      scenes: timeline
    }
  };
}
