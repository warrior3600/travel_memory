import { useEffect, useRef, useState } from 'react';
import { clientLogger } from '../utils/logger';

const DEFAULT_CENTER = { lat: 20, lng: 0 };

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function hashString(value) {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function deterministicFallbackPosition(photo, index) {
  const seed = hashString(`${photo.place || 'unknown'}-${index}`);
  const lat = ((seed % 12000) / 100) - 60;
  const lng = (((Math.floor(seed / 12000) % 34000) / 100) - 170) || (index * 4.7 - 90);
  return {
    lat: Number(lat.toFixed(6)),
    lng: Number(lng.toFixed(6)),
    source: 'deterministic-fallback'
  };
}

function loadGoogleMapsScript(apiKey) {
  return new Promise((resolve, reject) => {
    if (window.google?.maps) {
      resolve(window.google.maps);
      return;
    }

    const onAuthFailure = () => {
      reject(new Error('gm_auth_failure'));
    };

    const existing = document.querySelector('script[data-google-maps]');
    if (existing) {
      window.gm_authFailure = onAuthFailure;
      existing.addEventListener('load', () => resolve(window.google.maps));
      existing.addEventListener('error', reject);
      return;
    }

    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&v=weekly`;
    script.async = true;
    script.defer = true;
    script.dataset.googleMaps = 'true';
    window.gm_authFailure = onAuthFailure;
    script.onload = () => resolve(window.google.maps);
    script.onerror = reject;
    document.body.appendChild(script);
  });
}

function hasCoordinates(photo) {
  return (
    Number.isFinite(photo?.latitude) &&
    Number.isFinite(photo?.longitude) &&
    Math.abs(Number(photo.latitude)) <= 90 &&
    Math.abs(Number(photo.longitude)) <= 180
  );
}

export default function GoogleMapPanel({ focusPlace, curatedPhotos }) {
  const mapRef = useRef(null);
  const mapInstance = useRef(null);
  const markersRef = useRef([]);
  const geocodeCacheRef = useRef(new Map());
  const closeTimerRef = useRef(null);
  const renderIdRef = useRef(0);
  const [status, setStatus] = useState('idle');
  const [pinStats, setPinStats] = useState({ total: 0, rendered: 0, unresolved: 0 });
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
        clientLogger.info('map.init.success', { mapTypeId: 'hybrid' });

        maps.event.addListenerOnce(mapInstance.current, 'idle', () => {
          if (isMounted) {
            setStatus('ready');
            window.setTimeout(() => {
              if (mapInstance.current && window.google?.maps?.event) {
                window.google.maps.event.trigger(mapInstance.current, 'resize');
              }
            }, 120);
          }
        });
      })
      .catch((error) => {
        clientLogger.error('map.init.failed', { message: error?.message || 'unknown' });
        if (isMounted) {
          setStatus(error?.message === 'gm_auth_failure' ? 'auth-failure' : 'error');
        }
      });

    return () => {
      isMounted = false;
      renderIdRef.current += 1;
      mapInstance.current = null;
      delete window.gm_authFailure;
      if (closeTimerRef.current) {
        window.clearTimeout(closeTimerRef.current);
      }
    };
  }, [apiKey]);

  useEffect(() => {
    if (!mapInstance.current || curatedPhotos?.length || !focusPlace || !window.google?.maps?.Geocoder) {
      return;
    }

    const geocoder = new window.google.maps.Geocoder();
    geocoder.geocode({ address: focusPlace }, (results, geoStatus) => {
      if (geoStatus !== 'OK' || !results?.[0]) {
        return;
      }
      mapInstance.current.panTo(results[0].geometry.location);
      mapInstance.current.setZoom(9);
    });
  }, [focusPlace, curatedPhotos, status]);

  useEffect(() => {
    if (!mapInstance.current || !window.google?.maps || status !== 'ready') {
      return;
    }

    const currentRenderId = ++renderIdRef.current;

    markersRef.current.forEach((marker) => marker.setMap(null));
    markersRef.current = [];

    if (!curatedPhotos?.length) {
      setPinStats({ total: 0, rendered: 0, unresolved: 0 });
      return;
    }

    const geocoder = new window.google.maps.Geocoder();
    const infoWindow = new window.google.maps.InfoWindow();
    const bounds = new window.google.maps.LatLngBounds();

    const resolvePosition = (photo, index) =>
      new Promise((resolve) => {
        if (hasCoordinates(photo)) {
          resolve({
            lat: Number(photo.latitude),
            lng: Number(photo.longitude),
            source: photo.locationSource || (photo.hasExactLocation ? 'exif' : 'stored')
          });
          return;
        }

        const swapLat = Number(photo?.longitude);
        const swapLng = Number(photo?.latitude);
        if (
          Number.isFinite(swapLat) &&
          Number.isFinite(swapLng) &&
          Math.abs(swapLat) <= 90 &&
          Math.abs(swapLng) <= 180
        ) {
          resolve({
            lat: swapLat,
            lng: swapLng,
            source: 'stored-swapped-corrected'
          });
          return;
        }

        const key = String(photo.place || '').trim().toLowerCase();
        if (!key) {
          resolve(deterministicFallbackPosition(photo, index));
          return;
        }

        if (geocodeCacheRef.current.has(key)) {
          resolve(geocodeCacheRef.current.get(key) || deterministicFallbackPosition(photo, index));
          return;
        }

        geocoder.geocode({ address: photo.place }, (results, geoStatus) => {
          if (geoStatus === 'OK' && results?.[0]) {
            const loc = results[0].geometry.location;
            const value = {
              lat: loc.lat(),
              lng: loc.lng(),
              source: 'maps-geocoding-fallback'
            };
            geocodeCacheRef.current.set(key, value);
            resolve(value);
            return;
          }

          geocodeCacheRef.current.set(key, null);
          resolve(deterministicFallbackPosition(photo, index));
        });
      });

    const paintPins = async () => {
      let rendered = 0;
      let unresolved = 0;

      for (let idx = 0; idx < curatedPhotos.length; idx += 1) {
        if (currentRenderId !== renderIdRef.current) {
          return;
        }

        const photo = curatedPhotos[idx];
        const resolved = await resolvePosition(photo, idx);
        if (!resolved || !mapInstance.current) {
          unresolved += 1;
          continue;
        }

        const position = { lat: resolved.lat, lng: resolved.lng };
        let marker;
        try {
          marker = new window.google.maps.Marker({
            map: mapInstance.current,
            position,
            title: photo.place || 'Memory',
            label: {
              text: `${idx + 1}`,
              color: '#ffffff',
              fontSize: '12px',
              fontWeight: '700'
            }
          });
        } catch (error) {
          unresolved += 1;
          clientLogger.warn('map.pin.invalid_position', {
            photoId: photo.id,
            lat: resolved.lat,
            lng: resolved.lng,
            message: error?.message || 'Invalid marker coordinates'
          });
          continue;
        }

        const safePlace = escapeHtml(photo.place || 'Unknown place');
        const safeCaption = escapeHtml(photo.captionEnhanced || photo.caption || '');
        const safeFileName = escapeHtml(photo.fileName || 'memory-photo');
        const safeTime = escapeHtml(new Date(photo.timestamp).toLocaleString());
        const safeSource = escapeHtml(
          resolved.source === 'exif'
            ? 'Exact camera GPS (EXIF)'
            : resolved.source === 'ai-place-inference'
              ? 'AI inferred from place text'
              : resolved.source === 'maps-geocoding-fallback'
                ? 'Google Maps geocoding fallback'
                : resolved.source === 'deterministic-fallback'
                  ? 'Place text fallback (approximate)'
                  : 'Stored map coordinates'
        );

        const openCard = () => {
          if (closeTimerRef.current) {
            window.clearTimeout(closeTimerRef.current);
            closeTimerRef.current = null;
          }

          infoWindow.setContent(`
            <div style="max-width:260px;color:#111;font-family:system-ui,sans-serif;">
              <img src="${photo.previewUrl}" alt="${safeFileName}" style="width:100%;height:150px;object-fit:cover;border-radius:8px;margin-bottom:8px;" />
              <strong style="display:block;margin-bottom:6px;">${safePlace}</strong>
              <p style="margin:0 0 6px 0;font-size:12px;line-height:1.4;">${safeCaption}</p>
              <small style="display:block;margin-bottom:4px;">${safeSource}</small>
              <small>${safeTime}</small>
            </div>
          `);
          infoWindow.open({ anchor: marker, map: mapInstance.current });
        };

        marker.addListener('mouseover', openCard);
        marker.addListener('click', openCard);
        marker.addListener('mouseout', () => {
          closeTimerRef.current = window.setTimeout(() => {
            infoWindow.close();
          }, 220);
        });

        markersRef.current.push(marker);
        bounds.extend(position);
        rendered += 1;
      }

      if (currentRenderId !== renderIdRef.current) {
        return;
      }

      setPinStats({ total: curatedPhotos.length, rendered, unresolved });

      if (!bounds.isEmpty() && mapInstance.current) {
        mapInstance.current.fitBounds(bounds, 90);
      } else if (mapInstance.current) {
        mapInstance.current.setCenter(DEFAULT_CENTER);
        mapInstance.current.setZoom(2);
      }
    };

    paintPins();
  }, [curatedPhotos, status]);

  return (
    <section className="map-panel card-shell">
      <div className="panel-head map-panel-head">
        <h3>Journey Map (Hybrid: Satellite + City Names)</h3>
        <p>
          Hover each pin to preview the uploaded image and AI caption. Pins use EXIF GPS first, then
          AI-inferred place coordinates, Google geocoding fallback, and finally approximate text fallback.
        </p>
        {status === 'ready' && pinStats.total > 0 && (
          <p>
            Pins rendered: {pinStats.rendered}/{pinStats.total}
            {pinStats.unresolved > 0 ? ` (unresolved: ${pinStats.unresolved})` : ''}
          </p>
        )}
      </div>

      {status === 'missing-key' && (
        <div className="map-fallback">
          Add <code>VITE_GOOGLE_MAPS_API_KEY</code> to use live Google Maps.
        </div>
      )}
      {status === 'auth-failure' && (
        <div className="map-fallback">
          Google Maps authentication failed. Enable Maps JavaScript API + billing, and allow your
          localhost referrer for <code>VITE_GOOGLE_MAPS_API_KEY</code>.
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
