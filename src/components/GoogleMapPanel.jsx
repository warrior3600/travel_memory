import { useEffect, useRef, useState } from 'react';

const DEFAULT_CENTER = { lat: 20, lng: 0 };

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function loadGoogleMapsScript(apiKey) {
  return new Promise((resolve, reject) => {
    if (window.google?.maps) {
      resolve(window.google.maps);
      return;
    }

    const existing = document.querySelector('script[data-google-maps]');
    if (existing) {
      existing.addEventListener('load', () => resolve(window.google.maps));
      existing.addEventListener('error', reject);
      return;
    }

    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}`;
    script.async = true;
    script.defer = true;
    script.dataset.googleMaps = 'true';
    script.onload = () => resolve(window.google.maps);
    script.onerror = reject;
    document.body.appendChild(script);
  });
}

export default function GoogleMapPanel({ focusPlace, curatedPhotos }) {
  const mapRef = useRef(null);
  const mapInstance = useRef(null);
  const markersRef = useRef([]);
  const geocodeCacheRef = useRef(new Map());
  const [status, setStatus] = useState('idle');
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;

  useEffect(() => {
    if (!apiKey) {
      setStatus('missing-key');
      return;
    }

    let isMounted = true;
    setStatus('loading');

    loadGoogleMapsScript(apiKey)
      .then((maps) => {
        if (!isMounted || !mapRef.current) {
          return;
        }

        mapInstance.current = new maps.Map(mapRef.current, {
          center: DEFAULT_CENTER,
          zoom: 3,
          mapTypeId: 'hybrid',
          mapTypeControl: true,
          streetViewControl: false,
          fullscreenControl: true,
          zoomControl: true,
          gestureHandling: 'greedy'
        });

        setStatus('ready');
      })
      .catch(() => {
        if (isMounted) {
          setStatus('error');
        }
      });

    return () => {
      isMounted = false;
    };
  }, [apiKey]);

  useEffect(() => {
    if (!focusPlace || !mapInstance.current || !window.google?.maps?.Geocoder) {
      return;
    }

    const geocoder = new window.google.maps.Geocoder();
    geocoder.geocode({ address: focusPlace }, (results, geoStatus) => {
      if (geoStatus !== 'OK' || !results?.[0]) {
        return;
      }

      mapInstance.current.panTo(results[0].geometry.location);
      if ((curatedPhotos || []).length < 2) {
        mapInstance.current.setZoom(11);
      }
    });
  }, [focusPlace, curatedPhotos]);

  useEffect(() => {
    if (!mapInstance.current) {
      return;
    }

    markersRef.current.forEach((marker) => marker.setMap(null));
    markersRef.current = [];

    if (!window.google?.maps?.Geocoder || !curatedPhotos?.length) {
      return;
    }

    const geocoder = new window.google.maps.Geocoder();
    const infoWindow = new window.google.maps.InfoWindow();
    const bounds = new window.google.maps.LatLngBounds();

    const resolveLocation = (place) =>
      new Promise((resolve) => {
        const key = (place || '').toLowerCase();
        if (geocodeCacheRef.current.has(key)) {
          resolve(geocodeCacheRef.current.get(key));
          return;
        }

        geocoder.geocode({ address: place }, (results, geoStatus) => {
          if (geoStatus === 'OK' && results?.[0]) {
            const loc = results[0].geometry.location;
            geocodeCacheRef.current.set(key, loc);
            resolve(loc);
            return;
          }

          resolve(null);
        });
      });

    const paintPins = async () => {
      const photos = curatedPhotos;
      for (let i = 0; i < photos.length; i += 1) {
        const photo = photos[i];
        const location = await resolveLocation(photo.place);
        if (!location || !mapInstance.current) {
          continue;
        }

        const marker = new window.google.maps.Marker({
          map: mapInstance.current,
          position: location,
          title: photo.place,
          label: {
            text: `${i + 1}`,
            color: '#ffffff',
            fontSize: '12px',
            fontWeight: '700'
          },
          icon: {
            url: photo.previewUrl,
            scaledSize: new window.google.maps.Size(50, 50),
            anchor: new window.google.maps.Point(25, 25),
            labelOrigin: new window.google.maps.Point(25, 70)
          }
        });

        marker.addListener('click', () => {
          const safePlace = escapeHtml(photo.place);
          const safeCaption = escapeHtml(photo.captionEnhanced || photo.caption || '');
          const safeFileName = escapeHtml(photo.fileName || 'memory-photo');
          const safeTime = escapeHtml(new Date(photo.timestamp).toLocaleString());

          infoWindow.setContent(`
            <div style="max-width:260px;color:#111;font-family:system-ui,sans-serif;">
              <img src="${photo.previewUrl}" alt="${safeFileName}" style="width:100%;height:150px;object-fit:cover;border-radius:8px;margin-bottom:8px;" />
              <strong style="display:block;margin-bottom:6px;">${safePlace}</strong>
              <p style="margin:0 0 6px 0;font-size:12px;line-height:1.4;">${safeCaption}</p>
              <small>${safeTime}</small>
            </div>
          `);
          infoWindow.open({ anchor: marker, map: mapInstance.current });
        });

        markersRef.current.push(marker);
        bounds.extend(location);
      }

      if (!bounds.isEmpty() && mapInstance.current) {
        mapInstance.current.fitBounds(bounds, 90);
      }
    };

    paintPins();
  }, [curatedPhotos]);

  return (
    <section className="map-panel card-shell">
      <div className="panel-head map-panel-head">
        <h3>Journey Map (Hybrid: Satellite + City Names)</h3>
        <p>Curated photos are pinned as clickable markers with previews and captions.</p>
      </div>

      {status === 'missing-key' && (
        <div className="map-fallback">
          Add <code>VITE_GOOGLE_MAPS_API_KEY</code> to use live Google Maps.
        </div>
      )}
      {status === 'error' && (
        <div className="map-fallback">Unable to load Google Maps script. Check key and billing setup.</div>
      )}
      {status === 'loading' && <div className="map-fallback">Loading map...</div>}

      <div ref={mapRef} className="map-canvas" />
    </section>
  );
}
