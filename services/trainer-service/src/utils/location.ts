export interface Coordinate {
  latitude: number;
  longitude: number;
}

export function isWithinRadius(origin: Coordinate, target: Coordinate, radiusKm: number): boolean {
  const distance = haversine(
    origin.latitude,
    origin.longitude,
    target.latitude,
    target.longitude,
  );
  return distance <= radiusKm;
}

export function normalizeCoordinate(value: number): number {
  if (!Number.isFinite(value)) {
    throw new Error('Coordinate must be a finite number');
  }
  return Number(value.toFixed(6));
}

function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // km
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function toRad(value: number): number {
  return (value * Math.PI) / 180;
}

