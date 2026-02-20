import { useEffect, useMemo, useRef, useState } from 'react';
import GoogleMapPanel from './GoogleMapPanel';
import { api } from '../utils/api';

function parsePeople(value) {
  return value
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);
}

export default function Dashboard({ user, token, onLogout }) {
  const fileInputRef = useRef(null);
  const [travelForm, setTravelForm] = useState({
    place: '',
    caption: '',
    people: '',
    timestamp: new Date().toISOString().slice(0, 16),
    files: []
  });
  const [travels, setTravels] = useState([]);
  const [trips, setTrips] = useState([]);
  const [activeTripId, setActiveTripId] = useState('');
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState('');
  const [saveStatus, setSaveStatus] = useState('');

  const activeTrip = useMemo(
    () => trips.find((trip) => trip.id === activeTripId) || trips[0] || null,
    [trips, activeTripId]
  );

  const lastPlace = useMemo(() => {
    if (!travels.length) {
      return '';
    }
    return travels[travels.length - 1].place;
  }, [travels]);

  useEffect(() => {
    if (!token) {
      return;
    }

    const loadData = async () => {
      setLoading(true);
      setError('');

      try {
        const [travelResp, tripResp] = await Promise.all([api.listTravels(token), api.listTrips(token)]);
        setTravels(travelResp.travels || []);
        setTrips(tripResp.trips || []);
        if (tripResp.trips?.length) {
          setActiveTripId(tripResp.trips[0].id);
        }
      } catch (nextError) {
        setError(nextError.message || 'Failed to load dashboard data');
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [token]);

  const updateForm = (field, value) => {
    setTravelForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleFileChange = (event) => {
    updateForm('files', Array.from(event.target.files || []));
  };

  const replaceTrip = (updatedTrip) => {
    setTrips((prev) => {
      const idx = prev.findIndex((trip) => trip.id === updatedTrip.id);
      if (idx === -1) {
        return [updatedTrip, ...prev];
      }

      const next = prev.slice();
      next[idx] = updatedTrip;
      return next;
    });
    setActiveTripId(updatedTrip.id);
  };

  const addTravel = async (event) => {
    event.preventDefault();

    if (!travelForm.place.trim() || !travelForm.timestamp || !travelForm.files.length) {
      return;
    }

    const formData = new FormData();
    formData.append('place', travelForm.place.trim());
    formData.append('caption', travelForm.caption.trim());
    formData.append('people', parsePeople(travelForm.people).join(', '));
    formData.append('timestamp', travelForm.timestamp);

    travelForm.files.forEach((file) => {
      formData.append('photos', file);
    });

    setActionLoading(true);
    setError('');

    try {
      const response = await api.createTravel(formData, token);
      setTravels((prev) => [...prev, response.travel]);
      setTravelForm({
        place: '',
        caption: '',
        people: '',
        timestamp: new Date().toISOString().slice(0, 16),
        files: []
      });
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    } catch (nextError) {
      setError(nextError.message || 'Failed to upload travel');
    } finally {
      setActionLoading(false);
    }
  };

  const runCuration = async () => {
    setActionLoading(true);
    setError('');

    try {
      const response = await api.curateTravels(
        travels.map((travel) => travel.id),
        token
      );
      replaceTrip(response.trip);
    } catch (nextError) {
      setError(nextError.message || 'Failed to run curation');
    } finally {
      setActionLoading(false);
    }
  };

  const generateTrip = async () => {
    if (!activeTrip) {
      return;
    }

    setActionLoading(true);
    setError('');

    try {
      const response = await api.createStory(activeTrip.id, token);
      replaceTrip(response.trip);
    } catch (nextError) {
      setError(nextError.message || 'Failed to generate trip story');
    } finally {
      setActionLoading(false);
    }
  };

  const renderVideo = async () => {
    if (!activeTrip) {
      return;
    }

    setActionLoading(true);
    setError('');

    try {
      const response = await api.renderVideo(activeTrip.id, token);
      replaceTrip(response.trip);
    } catch (nextError) {
      setError(nextError.message || 'Video rendering failed');
    } finally {
      setActionLoading(false);
    }
  };

  const updateActiveTrip = (updater) => {
    setTrips((prev) =>
      prev.map((trip) => {
        if (trip.id !== (activeTrip?.id || '')) {
          return trip;
        }
        return updater(trip);
      })
    );
    setSaveStatus('Unsaved edits');
  };

  const updateCuratedCaption = (photoId, value) => {
    updateActiveTrip((trip) => ({
      ...trip,
      curatedPhotos: (trip.curatedPhotos || []).map((photo) =>
        photo.id === photoId ? { ...photo, captionEnhanced: value } : photo
      )
    }));
  };

  const updateScrapbookEntry = (entryId, value) => {
    updateActiveTrip((trip) => ({
      ...trip,
      scrapbook: (trip.scrapbook || []).map((entry) =>
        entry.id === entryId ? { ...entry, text: value } : entry
      )
    }));
  };

  const updateNarration = (value) => {
    updateActiveTrip((trip) => ({
      ...trip,
      narration: value
    }));
  };

  const saveEdits = async () => {
    if (!activeTrip) {
      return;
    }

    setActionLoading(true);
    setError('');

    try {
      const response = await api.updateTrip(
        activeTrip.id,
        {
          narration: activeTrip.narration,
          scrapbook: activeTrip.scrapbook,
          curatedPhotos: activeTrip.curatedPhotos
        },
        token
      );

      replaceTrip(response.trip);
      setSaveStatus('Saved');
    } catch (nextError) {
      setError(nextError.message || 'Failed to save edits');
      setSaveStatus('');
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) {
    return <main className="dashboard-page">Loading dashboard...</main>;
  }

  const hasCuratedPhotos = !!activeTrip?.curatedPhotos?.length;

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

      {error && <div className="error-banner">{error}</div>}

      <GoogleMapPanel focusPlace={lastPlace} curatedPhotos={activeTrip?.curatedPhotos || []} />

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
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/*"
              onChange={handleFileChange}
              required
            />
          </label>

          <button type="submit" className="primary-pill form-submit" disabled={actionLoading}>
            {actionLoading ? 'Working...' : 'Add Travel'}
          </button>
        </form>
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

      <section className="trip-list card-shell">
        <div className="panel-head">
          <h3>Trips ({trips.length})</h3>
          <p>Select a curated trip snapshot to edit or render.</p>
        </div>
        {!trips.length && <p className="soft-text">No trip created yet.</p>}
        <div className="trip-pills">
          {trips.map((trip) => (
            <button
              key={trip.id}
              type="button"
              className={`trip-pill ${activeTrip?.id === trip.id ? 'active' : ''}`}
              onClick={() => setActiveTripId(trip.id)}
            >
              {new Date(trip.createdAt).toLocaleDateString()} ({trip.curatedPhotos.length} photos)
            </button>
          ))}
        </div>
      </section>

      <section className="actions-row">
        <button
          type="button"
          className="primary-pill"
          disabled={!travels.length || actionLoading}
          onClick={runCuration}
        >
          Run AI Memory Curation
        </button>
        <button
          type="button"
          className="primary-pill"
          disabled={!hasCuratedPhotos || actionLoading}
          onClick={generateTrip}
        >
          Trip Creation
        </button>
        <button
          type="button"
          className="secondary-pill"
          disabled={!hasCuratedPhotos || actionLoading}
          onClick={renderVideo}
        >
          Render Video Compilation
        </button>
        <button
          type="button"
          className="secondary-pill"
          disabled={!activeTrip || actionLoading}
          onClick={saveEdits}
        >
          Save Edits
        </button>
        {saveStatus && <small className="soft-text">{saveStatus}</small>}
      </section>

      {hasCuratedPhotos && (
        <section className="results-grid">
          <section className="card-shell">
            <div className="panel-head">
              <h3>Curated Photos on Map Timeline</h3>
              <p>Significant, less-redundant selections with editable AI-enhanced captions.</p>
            </div>
            <div className="curated-list">
              {activeTrip.curatedPhotos.map((photo) => (
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
            {activeTrip.scrapbook.map((entry) => (
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
              <p>Name tags and face-embedding matches across travels.</p>
            </div>
            {!activeTrip.familiarFaces.length && <p className="soft-text">No people references yet.</p>}
            {activeTrip.familiarFaces.map((person) => (
              <div key={`${person.source}-${person.name}`} className="face-row">
                <span>{person.name}</span>
                <strong>{person.tripsTogether} travels</strong>
              </div>
            ))}
          </section>
        </section>
      )}

      {activeTrip?.videoPlan && (
        <section className="trip-output-grid">
          <section className="card-shell">
            <div className="panel-head">
              <h3>Text Narration Story</h3>
              <p>Editable sequential story from first to final timestamp.</p>
            </div>
            <textarea
              className="story-editor"
              value={activeTrip.narration}
              onChange={(event) => updateNarration(event.target.value)}
            />
          </section>

          <section className="card-shell">
            <div className="panel-head">
              <h3>Video Compilation Plan</h3>
              <p>Rendered output is generated by FFmpeg on the backend.</p>
            </div>
            <div className="video-plan">
              <small>Music: {activeTrip.videoPlan.music}</small>
              <small>Status: {activeTrip.videoStatus}</small>
              {activeTrip.videoUrl && (
                <video controls src={activeTrip.videoUrl} style={{ width: '100%', borderRadius: '10px' }} />
              )}
              {activeTrip.videoPlan.scenes.map((scene) => (
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
