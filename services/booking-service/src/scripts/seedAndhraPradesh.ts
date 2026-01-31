/**
 * Seed script for PHASE-1 Andhra Pradesh cities and service zones (clusters).
 *
 * - Uses existing `cities` and `clusters` tables
 * - Each "zone" is represented as a cluster with:
 *   - center_latitude / center_longitude
 *   - radius_km (3 km urban, 4 km medium, 5 km periphery)
 * - Zones are named with clear codes, e.g. VJA-01, GNT-02
 *
 * Run (from booking-service root):
 *   pnpm dev -- src/scripts/seedAndhraPradesh.ts
 * or with tsx:
 *   npx tsx src/scripts/seedAndhraPradesh.ts
 */

import type { PoolClient } from 'pg';
import { getPool, initializeDatabase } from '../config/database';

type ZoneType = 'URBAN' | 'MEDIUM' | 'PERIPHERY';

interface CitySeed {
	name: string;
	state: string;
	country: string;
	isActive: boolean;
	shortCode: string; // e.g. VJA, GNT
}

interface ZoneSeed {
	cityCode: string; // shortCode of city, e.g. VJA
	code: string; // zone code, e.g. VJA-01
	label: string; // human-friendly label, e.g. Central / North / Periphery
	centerLat: number;
	centerLng: number;
	zoneType: ZoneType;
}

const CITY_SEEDS: CitySeed[] = [
	{ name: 'Visakhapatnam', state: 'Andhra Pradesh', country: 'India', isActive: true, shortCode: 'VSP' },
	{ name: 'Vijayawada', state: 'Andhra Pradesh', country: 'India', isActive: true, shortCode: 'VJA' },
	{ name: 'Guntur', state: 'Andhra Pradesh', country: 'India', isActive: true, shortCode: 'GNT' },
	{ name: 'Ongole', state: 'Andhra Pradesh', country: 'India', isActive: true, shortCode: 'ONG' },
	{ name: 'Nellore', state: 'Andhra Pradesh', country: 'India', isActive: true, shortCode: 'NLR' },
	{ name: 'Kurnool', state: 'Andhra Pradesh', country: 'India', isActive: true, shortCode: 'KNL' },
	{ name: 'Kadapa', state: 'Andhra Pradesh', country: 'India', isActive: true, shortCode: 'KDP' },
	{ name: 'Rajahmundry', state: 'Andhra Pradesh', country: 'India', isActive: true, shortCode: 'RJY' },
	{ name: 'Kakinada', state: 'Andhra Pradesh', country: 'India', isActive: true, shortCode: 'KAK' },
	{ name: 'Tirupati', state: 'Andhra Pradesh', country: 'India', isActive: true, shortCode: 'TPT' },
	{ name: 'Chittoor', state: 'Andhra Pradesh', country: 'India', isActive: true, shortCode: 'CTR' },
	{ name: 'Anantapur', state: 'Andhra Pradesh', country: 'India', isActive: true, shortCode: 'ATP' },
	{ name: 'Vizianagaram', state: 'Andhra Pradesh', country: 'India', isActive: true, shortCode: 'VZM' },
	{ name: 'Eluru', state: 'Andhra Pradesh', country: 'India', isActive: true, shortCode: 'ELR' },
	{ name: 'Machilipatnam', state: 'Andhra Pradesh', country: 'India', isActive: true, shortCode: 'MTM' },
	{ name: 'Srikakulam', state: 'Andhra Pradesh', country: 'India', isActive: true, shortCode: 'SLK' },
	{ name: 'Narasaraopet', state: 'Andhra Pradesh', country: 'India', isActive: true, shortCode: 'NSP' },
	{ name: 'Chilakaluripet', state: 'Andhra Pradesh', country: 'India', isActive: true, shortCode: 'CLP' },
	{ name: 'Tenali', state: 'Andhra Pradesh', country: 'India', isActive: true, shortCode: 'TNL' },
	{ name: 'Ponnur', state: 'Andhra Pradesh', country: 'India', isActive: true, shortCode: 'PNR' },
];

const ZONE_SEEDS: ZoneSeed[] = [
	// Visakhapatnam (URBAN)
	{ cityCode: 'VSP', code: 'VSP-01', label: 'Central', centerLat: 17.6868, centerLng: 83.2185, zoneType: 'URBAN' },
	{ cityCode: 'VSP', code: 'VSP-02', label: 'North', centerLat: 17.7068, centerLng: 83.2185, zoneType: 'URBAN' },
	{ cityCode: 'VSP', code: 'VSP-03', label: 'Periphery', centerLat: 17.6868, centerLng: 83.2385, zoneType: 'PERIPHERY' },

	// Vijayawada (URBAN)
	{ cityCode: 'VJA', code: 'VJA-01', label: 'Central', centerLat: 16.5062, centerLng: 80.648, zoneType: 'URBAN' },
	{ cityCode: 'VJA', code: 'VJA-02', label: 'North', centerLat: 16.5262, centerLng: 80.648, zoneType: 'URBAN' },
	{ cityCode: 'VJA', code: 'VJA-03', label: 'Periphery', centerLat: 16.5062, centerLng: 80.668, zoneType: 'PERIPHERY' },

	// Guntur (URBAN)
	{ cityCode: 'GNT', code: 'GNT-01', label: 'Central', centerLat: 16.3067, centerLng: 80.4365, zoneType: 'URBAN' },
	{ cityCode: 'GNT', code: 'GNT-02', label: 'North', centerLat: 16.3267, centerLng: 80.4365, zoneType: 'URBAN' },
	{ cityCode: 'GNT', code: 'GNT-03', label: 'Periphery', centerLat: 16.282346,  centerLng: 80.44742, zoneType: 'PERIPHERY' },

	// Ongole (MEDIUM)
	{ cityCode: 'ONG', code: 'ONG-01', label: 'Central', centerLat: 15.5057, centerLng: 80.0499, zoneType: 'MEDIUM' },
	{ cityCode: 'ONG', code: 'ONG-02', label: 'North', centerLat: 15.5257, centerLng: 80.0499, zoneType: 'MEDIUM' },
	{ cityCode: 'ONG', code: 'ONG-03', label: 'Periphery', centerLat: 15.50688, centerLng: 80.0244, zoneType: 'PERIPHERY' },

	// Nellore (URBAN)
	{ cityCode: 'NLR', code: 'NLR-01', label: 'Central', centerLat: 14.4426, centerLng: 79.9865, zoneType: 'URBAN' },
	{ cityCode: 'NLR', code: 'NLR-02', label: 'North', centerLat: 14.4626, centerLng: 79.9865, zoneType: 'URBAN' },
	{ cityCode: 'NLR', code: 'NLR-03', label: 'Periphery', centerLat: 14.4426, centerLng: 80.0065, zoneType: 'PERIPHERY' },

	// Kurnool (URBAN)
	{ cityCode: 'KNL', code: 'KNL-01', label: 'Central', centerLat: 15.8281, centerLng: 78.0373, zoneType: 'URBAN' },
	{ cityCode: 'KNL', code: 'KNL-02', label: 'North', centerLat: 15.8481, centerLng: 78.0373, zoneType: 'URBAN' },
	{ cityCode: 'KNL', code: 'KNL-03', label: 'Periphery', centerLat: 15.8281, centerLng: 78.0573, zoneType: 'PERIPHERY' },

	// Kadapa (URBAN)
	{ cityCode: 'KDP', code: 'KDP-01', label: 'Central', centerLat: 14.4673, centerLng: 78.8242, zoneType: 'URBAN' },
	{ cityCode: 'KDP', code: 'KDP-02', label: 'North', centerLat: 14.4873, centerLng: 78.8242, zoneType: 'URBAN' },
	{ cityCode: 'KDP', code: 'KDP-03', label: 'Periphery', centerLat: 14.4673, centerLng: 78.8442, zoneType: 'PERIPHERY' },

	// Rajahmundry (URBAN)
	{ cityCode: 'RJY', code: 'RJY-01', label: 'Central', centerLat: 17.0005, centerLng: 81.804, zoneType: 'URBAN' },
	{ cityCode: 'RJY', code: 'RJY-02', label: 'North', centerLat: 17.0205, centerLng: 81.804, zoneType: 'URBAN' },
	{ cityCode: 'RJY', code: 'RJY-03', label: 'Periphery', centerLat: 17.0005, centerLng: 81.824, zoneType: 'PERIPHERY' },

	// Kakinada (URBAN)
	{ cityCode: 'KAK', code: 'KAK-01', label: 'Central', centerLat: 16.9891, centerLng: 82.2475, zoneType: 'URBAN' },
	{ cityCode: 'KAK', code: 'KAK-02', label: 'North', centerLat: 17.0091, centerLng: 82.2475, zoneType: 'URBAN' },
	{ cityCode: 'KAK', code: 'KAK-03', label: 'Periphery', centerLat: 16.9891, centerLng: 82.2675, zoneType: 'PERIPHERY' },

	// Tirupati (URBAN)
	{ cityCode: 'TPT', code: 'TPT-01', label: 'Central', centerLat: 13.6288, centerLng: 79.4192, zoneType: 'URBAN' },
	{ cityCode: 'TPT', code: 'TPT-02', label: 'North', centerLat: 13.6488, centerLng: 79.4192, zoneType: 'URBAN' },
	{ cityCode: 'TPT', code: 'TPT-03', label: 'Periphery', centerLat: 13.6288, centerLng: 79.4392, zoneType: 'PERIPHERY' },

	// Chittoor (MEDIUM)
	{ cityCode: 'CTR', code: 'CTR-01', label: 'Central', centerLat: 13.2172, centerLng: 79.1003, zoneType: 'MEDIUM' },
	{ cityCode: 'CTR', code: 'CTR-02', label: 'North', centerLat: 13.2372, centerLng: 79.1003, zoneType: 'MEDIUM' },
	{ cityCode: 'CTR', code: 'CTR-03', label: 'Periphery', centerLat: 13.2172, centerLng: 79.1203, zoneType: 'PERIPHERY' },

	// Anantapur (URBAN)
	{ cityCode: 'ATP', code: 'ATP-01', label: 'Central', centerLat: 14.6819, centerLng: 77.6006, zoneType: 'URBAN' },
	{ cityCode: 'ATP', code: 'ATP-02', label: 'North', centerLat: 14.7019, centerLng: 77.6006, zoneType: 'URBAN' },
	{ cityCode: 'ATP', code: 'ATP-03', label: 'Periphery', centerLat: 14.6819, centerLng: 77.6206, zoneType: 'PERIPHERY' },

	// Vizianagaram (MEDIUM)
	{ cityCode: 'VZM', code: 'VZM-01', label: 'Central', centerLat: 18.1067, centerLng: 83.3956, zoneType: 'MEDIUM' },
	{ cityCode: 'VZM', code: 'VZM-02', label: 'North', centerLat: 18.1267, centerLng: 83.3956, zoneType: 'MEDIUM' },
	{ cityCode: 'VZM', code: 'VZM-03', label: 'Periphery', centerLat: 18.1067, centerLng: 83.4156, zoneType: 'PERIPHERY' },

	// Eluru (MEDIUM)
	{ cityCode: 'ELR', code: 'ELR-01', label: 'Central', centerLat: 16.7107, centerLng: 81.0952, zoneType: 'MEDIUM' },
	{ cityCode: 'ELR', code: 'ELR-02', label: 'North', centerLat: 16.7307, centerLng: 81.0952, zoneType: 'MEDIUM' },
	{ cityCode: 'ELR', code: 'ELR-03', label: 'Periphery', centerLat: 16.7107, centerLng: 81.1152, zoneType: 'PERIPHERY' },

	// Machilipatnam (MEDIUM)
	{ cityCode: 'MTM', code: 'MTM-01', label: 'Central', centerLat: 16.1875, centerLng: 81.1389, zoneType: 'MEDIUM' },
	{ cityCode: 'MTM', code: 'MTM-02', label: 'North', centerLat: 16.2075, centerLng: 81.1389, zoneType: 'MEDIUM' },
	{ cityCode: 'MTM', code: 'MTM-03', label: 'Periphery', centerLat: 16.1875, centerLng: 81.1589, zoneType: 'PERIPHERY' },

	// Srikakulam (MEDIUM)
	{ cityCode: 'SLK', code: 'SLK-01', label: 'Central', centerLat: 18.2969, centerLng: 83.8965, zoneType: 'MEDIUM' },
	{ cityCode: 'SLK', code: 'SLK-02', label: 'North', centerLat: 18.3169, centerLng: 83.8965, zoneType: 'MEDIUM' },
	{ cityCode: 'SLK', code: 'SLK-03', label: 'Periphery', centerLat: 18.2969, centerLng: 83.9165, zoneType: 'PERIPHERY' },

	// Narasaraopet (MEDIUM)
	{ cityCode: 'NSP', code: 'NSP-01', label: 'Central', centerLat: 16.234, centerLng: 80.047, zoneType: 'MEDIUM' },
	{ cityCode: 'NSP', code: 'NSP-02', label: 'North', centerLat: 16.254, centerLng: 80.047, zoneType: 'MEDIUM' },
	{ cityCode: 'NSP', code: 'NSP-03', label: 'Periphery', centerLat: 16.234, centerLng: 80.067, zoneType: 'PERIPHERY' },

	// Chilakaluripet (MEDIUM)
	{ cityCode: 'CLP', code: 'CLP-01', label: 'Central', centerLat: 16.0892, centerLng: 80.167, zoneType: 'MEDIUM' },
	{ cityCode: 'CLP', code: 'CLP-02', label: 'North', centerLat: 16.1092, centerLng: 80.167, zoneType: 'MEDIUM' },
	{ cityCode: 'CLP', code: 'CLP-03', label: 'Periphery', centerLat: 16.0892, centerLng: 80.187, zoneType: 'PERIPHERY' },

	// Tenali (MEDIUM)
	{ cityCode: 'TNL', code: 'TNL-01', label: 'Central', centerLat: 16.2437, centerLng: 80.6409, zoneType: 'MEDIUM' },
	{ cityCode: 'TNL', code: 'TNL-02', label: 'North', centerLat: 16.2637, centerLng: 80.6409, zoneType: 'MEDIUM' },
	{ cityCode: 'TNL', code: 'TNL-03', label: 'Periphery', centerLat: 16.2437, centerLng: 80.6609, zoneType: 'PERIPHERY' },

	// Ponnur (MEDIUM)
	{ cityCode: 'PNR', code: 'PNR-01', label: 'Central', centerLat: 16.0667, centerLng: 80.5667, zoneType: 'MEDIUM' },
	{ cityCode: 'PNR', code: 'PNR-02', label: 'North', centerLat: 16.0867, centerLng: 80.5667, zoneType: 'MEDIUM' },
	{ cityCode: 'PNR', code: 'PNR-03', label: 'Periphery', centerLat: 16.0667, centerLng: 80.5867, zoneType: 'PERIPHERY' },
];

function radiusFor(type: ZoneType): number {
	switch (type) {
		case 'URBAN':
			return 3;
		case 'MEDIUM':
			return 4;
		case 'PERIPHERY':
			return 5;
		default:
			return 3;
	}
}

async function upsertCities(client: PoolClient): Promise<Record<string, string>> {
	const codeToCityId: Record<string, string> = {};

	for (const city of CITY_SEEDS) {
		const res = await client.query<{ id: string }>(
			`
			INSERT INTO cities (name, state, country, is_active, metadata)
			VALUES ($1, $2, $3, $4, jsonb_build_object('shortCode', $5))
			ON CONFLICT (name, state, country) DO UPDATE
			SET
				is_active = EXCLUDED.is_active,
				metadata = EXCLUDED.metadata,
				updated_at = NOW()
			RETURNING id;
			`,
			[city.name, city.state, city.country, city.isActive, city.shortCode]
		);

		if (res.rows[0]) {
			codeToCityId[city.shortCode] = res.rows[0].id;
		}
	}

	return codeToCityId;
}

async function upsertZones(client: PoolClient, codeToCityId: Record<string, string>): Promise<void> {
	for (const zone of ZONE_SEEDS) {
		const cityId = codeToCityId[zone.cityCode];
		if (!cityId) {
			throw new Error(`City ID not found for code ${zone.cityCode}`);
		}

		const radiusKm = radiusFor(zone.zoneType);

		// Use cluster "name" as the zone code (e.g. VJA-01)
		// Store additional info (label, zoneType) in metadata for future extensions.
		await client.query(
			`
			INSERT INTO clusters (city_id, name, center_latitude, center_longitude, radius_km, metadata)
			VALUES ($1, $2, $3, $4, $5, jsonb_build_object('label', $6, 'zoneType', $7))
			ON CONFLICT (city_id, name) DO UPDATE
			SET
				center_latitude = EXCLUDED.center_latitude,
				center_longitude = EXCLUDED.center_longitude,
				radius_km = EXCLUDED.radius_km,
				metadata = EXCLUDED.metadata,
				updated_at = NOW();
			`,
			[cityId, zone.code, zone.centerLat, zone.centerLng, radiusKm, zone.label, zone.zoneType]
		);
	}
}

export async function seedAndhraPradeshCitiesAndZones(): Promise<void> {
	const pool = getPool();
	const client = await pool.connect();

	try {
		// Ensure tables exist
		await initializeDatabase();

		await client.query('BEGIN');

		const codeToCityId = await upsertCities(client);
		await upsertZones(client, codeToCityId);

		await client.query('COMMIT');
		// eslint-disable-next-line no-console
		console.log('✅ Seeded PHASE-1 Andhra Pradesh cities and zones (clusters)');
	} catch (error) {
		await client.query('ROLLBACK');
		// eslint-disable-next-line no-console
		console.error('❌ Failed to seed Andhra Pradesh cities/zones', error);
		throw error;
	} finally {
		client.release();
	}
}

// Allow running as a standalone script
if (require.main === module) {
	seedAndhraPradeshCitiesAndZones()
		.then(() => {
			process.exit(0);
		})
		.catch(() => {
			process.exit(1);
		});
}


