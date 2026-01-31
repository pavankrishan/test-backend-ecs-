import { AppError } from '@kodingcaravan/shared';
import { getPool } from '../config/database';
import type { Pool } from 'pg';

/**
 * Service for pincode lookup and city resolution
 * Used for auto-fill functionality during trainer application
 */
export class PincodeService {
	private pool: Pool;

	constructor() {
		this.pool = getPool();
	}

	/**
	 * Resolve pincode to city information
	 * Used for auto-fill during application
	 */
	async resolvePincode(pincode: string): Promise<{
		pincode: string;
		cityId: string;
		cityName: string;
		district: string | null;
		state: string;
		country: string;
	} | null> {
		if (!pincode || typeof pincode !== 'string') {
			throw new AppError('Pincode is required', 400);
		}

		// Validate pincode format (6 digits)
		const cleanPincode = pincode.trim();
		if (!/^[0-9]{6}$/.test(cleanPincode)) {
			throw new AppError('Pincode must be 6 digits', 400);
		}

		const result = await this.pool.query(
			`
				SELECT 
					p.pincode,
					c.id AS city_id,
					c.name AS city_name,
					COALESCE(p.district, c.district) AS district,
					c.state,
					c.country
				FROM pincodes p
				INNER JOIN cities c ON p.city_id = c.id
				WHERE p.pincode = $1
				AND c.is_active = true
			`,
			[cleanPincode]
		);

		if (result.rows.length === 0) {
			return null;
		}

		const row = result.rows[0];
		return {
			pincode: row.pincode,
			cityId: row.city_id,
			cityName: row.city_name,
			district: row.district,
			state: row.state,
			country: row.country,
		};
	}

	/**
	 * Get all cities for a given state
	 * Used for city selection dropdowns
	 */
	async getCitiesByState(state: string): Promise<Array<{
		id: string;
		name: string;
		district: string | null;
		state: string;
		country: string;
	}>> {
		if (!state || typeof state !== 'string') {
			throw new AppError('State is required', 400);
		}

		const result = await this.pool.query(
			`
				SELECT 
					id,
					name,
					district,
					state,
					country
				FROM cities
				WHERE state = $1
				AND is_active = true
				ORDER BY name ASC
			`,
			[state]
		);

		return result.rows.map(row => ({
			id: row.id,
			name: row.name,
			district: row.district,
			state: row.state,
			country: row.country,
		}));
	}

	/**
	 * Get all states
	 * Used for state selection dropdowns
	 */
	async getStates(): Promise<Array<{
		state: string;
		country: string;
		cityCount: number;
	}>> {
		const result = await this.pool.query(
			`
				SELECT 
					state,
					country,
					COUNT(*) as city_count
				FROM cities
				WHERE is_active = true
				GROUP BY state, country
				ORDER BY state ASC
			`
		);

		return result.rows.map(row => ({
			state: row.state,
			country: row.country,
			cityCount: parseInt(row.city_count, 10),
		}));
	}

	/**
	 * Validate pincode format
	 */
	static validatePincode(pincode: string): boolean {
		if (!pincode || typeof pincode !== 'string') {
			return false;
		}
		return /^[0-9]{6}$/.test(pincode.trim());
	}
}

export const pincodeService = new PincodeService();

