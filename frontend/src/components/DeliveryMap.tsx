import L from 'leaflet';
import { useEffect, useMemo } from 'react';
import {
  MapContainer,
  Marker,
  Polyline,
  Popup,
  TileLayer,
  useMap,
  useMapEvents,
} from 'react-leaflet';
import type {
  Coordinates,
  GeoJsonLineString,
  RouteType,
  Shop,
} from '../types/domain';

function createPinIcon(color: string, label: string): L.DivIcon {
  const html = `
    <div style="display:flex;flex-direction:column;align-items:center;transform:translate(-50%,-100%);">
      <span style="background:#0f172a;color:#f8fafc;border:1px solid ${color};font-size:10px;font-weight:700;padding:1px 6px;border-radius:9999px;white-space:nowrap;box-shadow:0 2px 6px rgba(0,0,0,0.45);margin-bottom:2px;">${label}</span>
      <svg width="24" height="30" viewBox="0 0 24 30" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M12 0C5.373 0 0 5.373 0 12C0 20.25 12 30 12 30C12 30 24 20.25 24 12C24 5.373 18.627 0 12 0Z" fill="${color}"/>
        <circle cx="12" cy="12" r="4.5" fill="#0f172a"/>
      </svg>
    </div>
  `;
  return L.divIcon({
    className: 'leaflet-div-icon-custom',
    html,
    iconSize: [0, 0],
    iconAnchor: [0, 0],
  });
}

function MapViewportController({
  originShop,
  destShop,
  customCoords,
  polyline,
}: {
  originShop: Shop | null;
  destShop: Shop | null;
  customCoords: Coordinates | null;
  polyline: GeoJsonLineString | null;
}) {
  const map = useMap();

  useEffect(() => {
    const points: [number, number][] = [];

    if (originShop) {
      points.push([originShop.latitude, originShop.longitude]);
    }
    if (destShop) {
      points.push([destShop.latitude, destShop.longitude]);
    } else if (customCoords) {
      points.push([customCoords.lat, customCoords.lng]);
    }
    if (polyline && polyline.coordinates.length > 0) {
      for (const [lng, lat] of polyline.coordinates) {
        points.push([lat, lng]);
      }
    }

    if (points.length >= 2) {
      const bounds = L.latLngBounds(points);
      map.fitBounds(bounds, { padding: [44, 44], maxZoom: 14 });
    } else if (points.length === 1) {
      map.setView(points[0], 12);
    }
  }, [map, originShop, destShop, customCoords, polyline]);

  return null;
}

function AdHocPinPicker({
  enabled,
  onPick,
}: {
  enabled: boolean;
  onPick: (coords: Coordinates) => void;
}) {
  useMapEvents({
    click(event) {
      if (!enabled) return;
      onPick({
        lat: Number(event.latlng.lat.toFixed(6)),
        lng: Number(event.latlng.lng.toFixed(6)),
      });
    },
  });
  return null;
}

interface DeliveryMapProps {
  shops: Shop[];
  originShop: Shop | null;
  destShop: Shop | null;
  customCoords: Coordinates | null;
  adHocMode: boolean;
  routeType: RouteType;
  polyline: GeoJsonLineString | null;
  onPickCustomCoords: (coords: Coordinates) => void;
}

export function DeliveryMap({
  shops,
  originShop,
  destShop,
  customCoords,
  adHocMode,
  routeType,
  polyline,
  onPickCustomCoords,
}: DeliveryMapProps) {
  const originIcon = useMemo(
    () => createPinIcon('#38bdf8', originShop?.code || 'ORIGIN'),
    [originShop?.code]
  );
  const destIcon = useMemo(
    () => createPinIcon('#10b981', destShop?.code || 'DEST'),
    [destShop?.code]
  );
  const adHocIcon = useMemo(() => createPinIcon('#f59e0b', 'CUSTOMER PIN'), []);
  const branchDotIcon = useMemo(
    () =>
      L.divIcon({
        className: 'leaflet-div-icon-custom',
        html: '<div style="width:10px;height:10px;border-radius:9999px;background:#64748b;border:2px solid #0f172a;transform:translate(-50%,-50%);"></div>',
        iconSize: [0, 0],
      }),
    []
  );

  const leafletPositions = useMemo<[number, number][]>(() => {
    if (!polyline || !polyline.coordinates) return [];
    return polyline.coordinates.map(([lng, lat]) => [lat, lng]);
  }, [polyline]);

  const defaultCenter: [number, number] = [-6.245, 106.845];

  return (
    <div className="relative h-full min-h-[300px] w-full overflow-hidden rounded-2xl border border-slate-800 bg-slate-900">
      <MapContainer
        center={defaultCenter}
        zoom={11}
        scrollWheelZoom={true}
        className="h-full w-full z-0"
      >
        <TileLayer
          attribution="&copy; OpenStreetMap contributors"
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        <MapViewportController
          originShop={originShop}
          destShop={destShop}
          customCoords={customCoords}
          polyline={polyline}
        />

        <AdHocPinPicker enabled={adHocMode} onPick={onPickCustomCoords} />

        {shops
          .filter(
            (s) => s.id !== originShop?.id && s.id !== destShop?.id
          )
          .map((shop) => (
            <Marker
              key={shop.id}
              position={[shop.latitude, shop.longitude]}
              icon={branchDotIcon}
            >
              <Popup>
                <div className="text-xs text-slate-900">
                  <p className="font-bold">{shop.code}</p>
                  <p>{shop.name}</p>
                  <p className="text-slate-600">{shop.city}</p>
                </div>
              </Popup>
            </Marker>
          ))}

        {originShop && (
          <Marker
            position={[originShop.latitude, originShop.longitude]}
            icon={originIcon}
          >
            <Popup>
              <div className="text-xs text-slate-900">
                <p className="font-bold">Origin: {originShop.code}</p>
                <p>{originShop.name}</p>
              </div>
            </Popup>
          </Marker>
        )}

        {!adHocMode && destShop && (
          <Marker
            position={[destShop.latitude, destShop.longitude]}
            icon={destIcon}
          >
            <Popup>
              <div className="text-xs text-slate-900">
                <p className="font-bold">Destination: {destShop.code}</p>
                <p>{destShop.name}</p>
              </div>
            </Popup>
          </Marker>
        )}

        {adHocMode && customCoords && (
          <Marker
            position={[customCoords.lat, customCoords.lng]}
            icon={adHocIcon}
            draggable={true}
            eventHandlers={{
              dragend(e) {
                const latlng = (e.target as L.Marker).getLatLng();
                onPickCustomCoords({
                  lat: Number(latlng.lat.toFixed(6)),
                  lng: Number(latlng.lng.toFixed(6)),
                });
              },
            }}
          >
            <Popup>
              <div className="text-xs text-slate-900 tabular-nums">
                <p className="font-bold">Ad-Hoc Destination Pin</p>
                <p>
                  {customCoords.lat.toFixed(5)}, {customCoords.lng.toFixed(5)}
                </p>
              </div>
            </Popup>
          </Marker>
        )}

        {leafletPositions.length >= 2 && (
          <Polyline
            positions={leafletPositions}
            pathOptions={{
              color: routeType === 'toll' ? '#38bdf8' : '#10b981',
              weight: 5,
              opacity: 0.9,
              dashArray: polyline?.coordinates.length === 2 ? '6 6' : undefined,
            }}
          />
        )}
      </MapContainer>

      {adHocMode && (
        <div className="pointer-events-none absolute bottom-3 left-3 right-3 z-[400] flex items-center justify-between rounded-xl border border-amber-500/40 bg-slate-950/90 px-3 py-2 text-xs text-amber-200 backdrop-blur">
          <span>Click anywhere on the map or drag the amber pin to set customer drop-off.</span>
          {customCoords && (
            <span className="ml-2 font-mono tabular-nums text-amber-300">
              {customCoords.lat.toFixed(4)}, {customCoords.lng.toFixed(4)}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
