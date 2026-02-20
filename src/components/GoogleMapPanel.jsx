import { useEffect, useRef, useState } from 'react';

const SATELLITE_CENTER = { lat: 20, lng: 0 };

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
          center: SATELLITE_CENTER,
          zoom: 2,
          mapTypeId: 'satellite',
          disableDefaultUI: true,
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

      mapInstance.current.setCenter(results[0].geometry.location);
      mapInstance.current.setZoom(11);
    });
  }, [focusPlace]);

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

    curatedPhotos.slice(0, 18).forEach((photo) => {
      geocoder.geocode({ address: photo.place }, (results, geoStatus) => {
        if (geoStatus !== 'OK' || !results?.[0]) {
          return;
        }

        const marker = new window.google.maps.Marker({
          map: mapInstance.current,
          position: results[0].geometry.location,
          title: photo.place
        });

        marker.addListener('click', () => {
          const safePlace = escapeHtml(photo.place);
          const safeCaption = escapeHtml(photo.captionEnhanced);
          const safeFileName = escapeHtml(photo.fileName);
          const safeTime = escapeHtml(new Date(photo.timestamp).toLocaleString());

          infoWindow.setContent(`
            <div style="max-width:220px;color:#111;font-family:system-ui,sans-serif;">
              <img src="${photo.previewUrl}" alt="${safeFileName}" style="width:100%;height:120px;object-fit:cover;border-radius:8px;margin-bottom:8px;" />
              <strong style="display:block;margin-bottom:6px;">${safePlace}</strong>
              <p style="margin:0 0 6px 0;font-size:12px;">${safeCaption}</p>
              <small>${safeTime}</small>
            </div>
          `);
          infoWindow.open({ anchor: marker, map: mapInstance.current });
        });

        markersRef.current.push(marker);
      });
    });
  }, [curatedPhotos]);

  return (
    <section className="map-panel card-shell">
      <div className="panel-head">
        <h3>Satellite Journey Map</h3>
        <p>Curated photos appear in sequence by place and timestamp.</p>
      </div>

      {status === 'missing-key' && (
        <div className="map-fallback">
          Add <code>VITE_GOOGLE_MAPS_API_KEY</code> to use live satellite maps.
        </div>
      )}
      {status === 'error' && (
        <div className="map-fallback">
          Unable to load Google Maps script. Check API key and billing setup.
        </div>
      )}
      {status === 'loading' && <div className="map-fallback">Loading satellite map...</div>}
      <div ref={mapRef} className="map-canvas" />
    </section>
  );
}
