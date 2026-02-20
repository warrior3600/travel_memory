import { useEffect, useMemo, useRef, useState } from 'react';
import GoogleMapPanel from './GoogleMapPanel';
import { buildTripStory, runMemoryCuration } from '../utils/memoryEngine';

function parsePeople(value) {
  return value
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);
}

function makePhoto(file, timestamp) {
  return {
    id: `photo_${crypto.randomUUID()}`,
    fileName: file.name,
    previewUrl: URL.createObjectURL(file),
    caption: '',
    timestamp,
    score: 0,
    captionEnhanced: ''
  };
}

export default function Dashboard({ user, onLogout }) {
  const previewUrlsRef = useRef(new Set());
  const [travelForm, setTravelForm] = useState({
    place: '',
    caption: '',
    people: '',
    timestamp: new Date().toISOString().slice(0, 16),
    files: []
  });
  const [travels, setTravels] = useState([]);
  const [curation, setCuration] = useState({ curatedPhotos: [], scrapbook: [], familiarFaces: [] });
  const [tripOutput, setTripOutput] = useState({ narration: '', videoPlan: null });

  useEffect(() => {
    return () => {
      previewUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      previewUrlsRef.current.clear();
    };
  }, []);

  const lastPlace = useMemo(() => {
    if (!travels.length) {
      return '';
    }
    return travels[travels.length - 1].place;
  }, [travels]);

  const updateForm = (field, value) => {
    setTravelForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleFileChange = (event) => {
    updateForm('files', Array.from(event.target.files || []));
  };

  const addTravel = (event) => {
    event.preventDefault();

    if (!travelForm.place.trim() || !travelForm.timestamp || !travelForm.files.length) {
      return;
    }

    const photos = travelForm.files.map((file) => {
      const photo = makePhoto(file, travelForm.timestamp);
      previewUrlsRef.current.add(photo.previewUrl);
      return photo;
    });
    const caption = travelForm.caption.trim();
    const people = parsePeople(travelForm.people);

    const nextTravel = {
      id: `travel_${crypto.randomUUID()}`,
      place: travelForm.place.trim(),
      people,
      timestamp: travelForm.timestamp,
      photos: photos.map((photo) => ({ ...photo, caption: caption || photo.fileName }))
    };

    setTravels((prev) => [...prev, nextTravel]);
    setTravelForm({
      place: '',
      caption: '',
      people: '',
      timestamp: new Date().toISOString().slice(0, 16),
      files: []
    });
  };

  const runCuration = () => {
    const result = runMemoryCuration(travels);
    setCuration(result);
    setTripOutput({ narration: '', videoPlan: null });
  };

  const generateTrip = () => {
    const result = buildTripStory(curation.curatedPhotos);
    setTripOutput(result);
  };

  const updateCuratedCaption = (photoId, value) => {
    setCuration((prev) => ({
      ...prev,
      curatedPhotos: prev.curatedPhotos.map((photo) =>
        photo.id === photoId ? { ...photo, captionEnhanced: value } : photo
      )
    }));
  };

  const updateScrapbookEntry = (entryId, value) => {
    setCuration((prev) => ({
      ...prev,
      scrapbook: prev.scrapbook.map((entry) => (entry.id === entryId ? { ...entry, text: value } : entry))
    }));
  };

  const updateNarration = (value) => {
    setTripOutput((prev) => ({ ...prev, narration: value }));
  };

  const hasCuratedPhotos = curation.curatedPhotos.length > 0;

  return (
    <main className="dashboard-page">
      <header className="dashboard-header card-shell">
        <div>
          <p className="eyebrow">Travel Dashboard</p>
          <h2>{user?.name}, build your memory-rich trip timeline.</h2>
        </div>
        <button type="button" className="secondary-pill" onClick={onLogout}>
          Logout
        </button>
      </header>

      <section className="dashboard-grid">
        <GoogleMapPanel focusPlace={lastPlace} curatedPhotos={curation.curatedPhotos} />

        <section className="input-panel card-shell">
          <div className="panel-head">
            <h3>Add Travel Input</h3>
            <p>Upload photos, place, caption, names of people, and timestamp.</p>
          </div>
          <form onSubmit={addTravel}>
            <label>
              Place
              <input
                type="text"
                value={travelForm.place}
                placeholder="Kyoto, Japan"
                onChange={(event) => updateForm('place', event.target.value)}
                required
              />
            </label>
            <label>
              Caption
              <input
                type="text"
                value={travelForm.caption}
                placeholder="Sunrise walk through old streets"
                onChange={(event) => updateForm('caption', event.target.value)}
              />
            </label>
            <label>
              People in photos
              <input
                type="text"
                value={travelForm.people}
                placeholder="Maya, Noah"
                onChange={(event) => updateForm('people', event.target.value)}
              />
            </label>
            <label>
              Timestamp
              <input
                type="datetime-local"
                value={travelForm.timestamp}
                onChange={(event) => updateForm('timestamp', event.target.value)}
                required
              />
            </label>
            <label>
              Photos
              <input type="file" multiple accept="image/*" onChange={handleFileChange} required />
            </label>

            <button type="submit" className="primary-pill form-submit">
              Add Travel
            </button>
          </form>
        </section>
      </section>

      <section className="travel-list card-shell">
        <div className="panel-head">
          <h3>Travel Timeline ({travels.length})</h3>
          <p>Multiple travels combine into one trip over a timeframe.</p>
        </div>
        {!travels.length && <p className="soft-text">No travels added yet.</p>}
        {travels.map((travel) => (
          <article key={travel.id} className="travel-row">
            <div>
              <strong>{travel.place}</strong>
              <small>{new Date(travel.timestamp).toLocaleString()}</small>
            </div>
            <div>
              <small>{travel.photos.length} photos</small>
              <small>{travel.people.length ? `With ${travel.people.join(', ')}` : 'No people tags'}</small>
            </div>
          </article>
        ))}
      </section>

      <section className="actions-row">
        <button type="button" className="primary-pill" disabled={!travels.length} onClick={runCuration}>
          Run AI Memory Curation
        </button>
        <button
          type="button"
          className="primary-pill"
          disabled={!hasCuratedPhotos}
          onClick={generateTrip}
        >
          Trip Creation
        </button>
      </section>

      {hasCuratedPhotos && (
        <section className="results-grid">
          <section className="card-shell">
            <div className="panel-head">
              <h3>Curated Photos on Map Timeline</h3>
              <p>Significant, less-redundant selections with editable AI-enhanced captions.</p>
            </div>
            <div className="curated-list">
              {curation.curatedPhotos.map((photo) => (
                <article key={photo.id} className="curated-item">
                  <img src={photo.previewUrl} alt={photo.fileName} />
                  <div>
                    <small>
                      {photo.place} - {new Date(photo.timestamp).toLocaleString()} - score {photo.score}
                    </small>
                    <textarea
                      value={photo.captionEnhanced}
                      onChange={(event) => updateCuratedCaption(photo.id, event.target.value)}
                    />
                  </div>
                </article>
              ))}
            </div>
          </section>

          <section className="card-shell">
            <div className="panel-head">
              <h3>Scrapbook (Daily Logs)</h3>
              <p>Editable timestamped diary entries generated from curated photos.</p>
            </div>
            {curation.scrapbook.map((entry) => (
              <article key={entry.id} className="log-entry">
                <strong>{entry.dayLabel}</strong>
                <textarea
                  value={entry.text}
                  onChange={(event) => updateScrapbookEntry(entry.id, event.target.value)}
                />
              </article>
            ))}
          </section>

          <section className="card-shell">
            <div className="panel-head">
              <h3>Familiar Faces Tracker</h3>
              <p>Counts how many travel entries include each person.</p>
            </div>
            {!curation.familiarFaces.length && <p className="soft-text">No people references yet.</p>}
            {curation.familiarFaces.map((person) => (
              <div key={person.name} className="face-row">
                <span>{person.name}</span>
                <strong>{person.tripsTogether} travels</strong>
              </div>
            ))}
          </section>
        </section>
      )}

      {tripOutput.videoPlan && (
        <section className="trip-output-grid">
          <section className="card-shell">
            <div className="panel-head">
              <h3>Text Narration Story</h3>
              <p>Editable sequential story from first to final timestamp.</p>
            </div>
            <textarea
              className="story-editor"
              value={tripOutput.narration}
              onChange={(event) => updateNarration(event.target.value)}
            />
          </section>

          <section className="card-shell">
            <div className="panel-head">
              <h3>Video Compilation Plan</h3>
              <p>Read-only sequence for rendering pipeline (effects + music).</p>
            </div>
            <div className="video-plan">
              <small>Music: {tripOutput.videoPlan.music}</small>
              {tripOutput.videoPlan.scenes.map((scene) => (
                <article key={scene.scene}>
                  <strong>Scene {scene.scene}</strong>
                  <p>{scene.title}</p>
                  <p>{scene.caption}</p>
                  <small>{scene.effect}</small>
                </article>
              ))}
            </div>
          </section>
        </section>
      )}
    </main>
  );
}
