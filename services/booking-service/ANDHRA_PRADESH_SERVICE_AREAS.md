## Andhra Pradesh PHASE-1 Service Areas

This document describes how **PHASE-1 Andhra Pradesh cities** are modelled and exposed as **service areas (zones)** in the booking-service backend.

- **Scope**: Only **Andhra Pradesh** cities (no Telangana or other states)
- **Usage**:
  - Seeding cities + zones into PostgreSQL
  - Looking up matching zones for a given **city + GPS location**

---

### Data Model

The booking-service already defines:

- **`cities`**: logical service cities
- **`clusters`**: internal service areas within a city (we treat these as **zones**)

#### `cities` table (summary)

- **Key columns**:
  - `id UUID PRIMARY KEY`
  - `name VARCHAR(100)` – e.g. `Vijayawada`
  - `state VARCHAR(100)` – e.g. `Andhra Pradesh`
  - `country VARCHAR(100)` – `India`
  - `is_active BOOLEAN` – city availability
  - `metadata JSONB` – includes `shortCode` for AP cities (e.g. `VJA`)

#### `clusters` table (zones)

Each cluster represents a **zone**:

- **Key columns**:
  - `id UUID PRIMARY KEY`
  - `city_id UUID` → FK to `cities.id`
  - `name VARCHAR(100)` – **zone code**, e.g. `VJA-01`, `GNT-02`
  - `center_latitude NUMERIC(10, 8)`
  - `center_longitude NUMERIC(11, 8)`
  - `radius_km NUMERIC(5, 2)` – service radius for the zone
  - `metadata JSONB` – includes:
    - `label` – human-friendly label (`Central`, `North`, `Periphery`)
    - `zoneType` – `"URBAN" | "MEDIUM" | "PERIPHERY"`

> Note: Zones can **overlap**; we keep each as an independent cluster with its own center + radius.

---

### PHASE-1 Andhra Pradesh Cities

The following cities are seeded as active **Andhra Pradesh** cities:

- Visakhapatnam (`VSP`)
- Vijayawada (`VJA`)
- Guntur (`GNT`)
- Ongole (`ONG`)
- Nellore (`NLR`)
- Kurnool (`KNL`)
- Kadapa (`KDP`)
- Rajahmundry (`RJY`)
- Kakinada (`KAK`)
- Tirupati (`TPT`)
- Chittoor (`CTR`)
- Anantapur (`ATP`)
- Vizianagaram (`VZM`)
- Eluru (`ELR`)
- Machilipatnam (`MTM`)
- Srikakulam (`SLK`)
- Narasaraopet (`NSP`)
- Chilakaluripet (`CLP`)
- Tenali (`TNL`)
- Ponnur (`PNR`)

Each city is created (or updated) in the `cities` table with:

- `state = 'Andhra Pradesh'`
- `country = 'India'`
- `is_active = true`
- `metadata.shortCode = <code>` (e.g. `VJA`)

---

### Zone Rules (Applied via Clusters)

Zones are implemented as clusters with the following **radius rules**:

- **Urban cities** → `radius_km = 3`
- **Medium cities** → `radius_km = 4`
- **Periphery/outskirts** → `radius_km = 5` (limited service)
- Each city has **3 zones** (can be extended to 3–5+ later):
  - `XXX-01` – `Central`
  - `XXX-02` – `North`
  - `XXX-03` – `Periphery`

Example (Vijayawada):

- `VJA-01` – Central zone (3 km)
- `VJA-02` – North zone (3 km)
- `VJA-03` – Periphery zone (5 km)

Each zone has a realistic **lat/lng** center near the city’s main area.

---

### Seeding AP Cities & Zones

Seed script location:

- `kc-backend/services/booking-service/src/scripts/seedAndhraPradesh.ts`

#### What the script does

1. Ensures booking-service tables exist (via `initializeDatabase`).
2. **Upserts cities** into `cities`:
   - Matches on `(name, state, country)`
   - Sets `metadata.shortCode` (e.g. `VJA`)
3. **Upserts zones** into `clusters`:
   - Looks up `city_id` from `metadata.shortCode`
   - Uses `clusters.name` as zone code (`VJA-01`, etc.)
   - Stores:
     - `center_latitude` / `center_longitude`
     - `radius_km` according to `zoneType`
     - `metadata.label` and `metadata.zoneType`

#### How to run

From the booking-service root:

```bash
cd kc-backend/services/booking-service

# Ensure dependencies are installed and DB env vars are set
pnpm install

# Run the seed script (dev runner)
pnpm dev -- src/scripts/seedAndhraPradesh.ts

# Or with tsx directly
npx tsx src/scripts/seedAndhraPradesh.ts
```

Expected logs:

- `✅ Seeded PHASE-1 Andhra Pradesh cities and zones (clusters)`

You can verify in PostgreSQL:

```sql
SELECT name, state, country, is_active, metadata
FROM cities
WHERE state = 'Andhra Pradesh';

SELECT city_id, name, center_latitude, center_longitude, radius_km, metadata
FROM clusters
WHERE city_id IN (
  SELECT id FROM cities WHERE state = 'Andhra Pradesh'
);
```

---

### Zone Lookup API – `zones-by-location`

To find which zones (service areas) cover a specific location inside a city, use:

- **Method**: `POST`
- **Path**: `/api/v1/booking/zones-by-location`

#### Request body

```json
{
  "cityId": "city-uuid",
  "lat": 16.5062,
  "lng": 80.6480
}
```

- `cityId` – UUID from the `cities` table.
- `lat`, `lng` – GPS coordinates for the student’s home.

#### Response: zones found

- Status: `200`

```json
{
  "success": true,
  "data": [
    {
      "id": "cluster-uuid",
      "cityId": "city-uuid",
      "name": "VJA-01",
      "centerLatitude": 16.5062,
      "centerLongitude": 80.648,
      "radiusKm": 3,
      "distanceKm": 0.42
    },
    {
      "id": "cluster-uuid-2",
      "cityId": "city-uuid",
      "name": "VJA-03",
      "centerLatitude": 16.5062,
      "centerLongitude": 80.668,
      "radiusKm": 5,
      "distanceKm": 1.9
    }
  ]
}
```

- Multiple zones may be returned if radii overlap.
- Sorted by `distanceKm` ascending (nearest first).

#### Response: service not available

If:

- The city does not exist, or
- The city is inactive, or
- There are no active clusters for the city, or
- The location is outside all zone radii

then:

- Status: `404`

```json
{
  "success": false,
  "message": "SERVICE_NOT_AVAILABLE"
}
```

Internally this is powered by:

- `ServiceAreaService.findZonesByCityAndLocation(cityId, lat, lng)`
  - Uses **Haversine distance** (`calculateDistance`) against each cluster’s center.
  - Filters where `distanceKm <= radius_km`.

---

### Extensibility (Future States & Cities)

To add new states or more cities:

- **States**:
  - Continue using the existing `cities` table with `state` and `country`.
  - Avoid mixing non-AP data in the AP seed script; create a new script per state (e.g. `seedKarnataka.ts`).

- **New cities**:
  - Add entries to the `CITY_SEEDS` array in a dedicated seed script (or a new one).
  - Provide a unique `shortCode` per city.
  - Define 3–5+ zones in the `ZONE_SEEDS` array with:
    - Realistic `centerLat` / `centerLng`
    - `zoneType` based on density (URBAN / MEDIUM / PERIPHERY)

- **Zone tuning**:
  - You can adjust `radius_km` per zone (e.g. larger for outskirts) without changing any API contracts.
  - Overlapping zones are supported; downstream logic can choose:
    - Nearest zone only, or
    - Prefer urban zones over periphery, etc.

This keeps the system clean, **city-aware**, and ready for incremental rollouts in new states while preserving the PHASE-1 Andhra Pradesh configuration as a first-class service area setup.


