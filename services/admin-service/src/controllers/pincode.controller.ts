import { Request, Response } from 'express';
import { pincodeService } from '../services/pincode.service';
import { AppError } from '@kodingcaravan/shared';

/**
 * Controller for pincode lookup endpoints
 * Used for auto-fill functionality during trainer application
 */
export class PincodeController {
	/**
	 * Resolve pincode to city information
	 * GET /api/v1/admin/pincodes/:pincode
	 */
	async resolvePincode(req: Request, res: Response): Promise<void> {
		try {
			const { pincode } = req.params;

			if (!pincode) {
				res.status(400).json({
					success: false,
					message: 'Pincode is required',
				});
				return;
			}

			const result = await pincodeService.resolvePincode(pincode);

			if (!result) {
				res.status(404).json({
					success: false,
					message: 'Pincode not found',
				});
				return;
			}

			res.json({
				success: true,
				data: result,
			});
		} catch (error: any) {
			if (error instanceof AppError) {
				res.status(error.statusCode || 400).json({
					success: false,
					message: error.message,
				});
				return;
			}

			console.error('[Pincode Controller] Error resolving pincode:', error);
			res.status(500).json({
				success: false,
				message: 'Internal server error',
			});
		}
	}

	/**
	 * Get cities by state
	 * GET /api/v1/admin/cities?state=Karnataka
	 */
	async getCitiesByState(req: Request, res: Response): Promise<void> {
		try {
			const { state } = req.query;

			if (!state || typeof state !== 'string') {
				res.status(400).json({
					success: false,
					message: 'State query parameter is required',
				});
				return;
			}

			const cities = await pincodeService.getCitiesByState(state);

			res.json({
				success: true,
				data: cities,
			});
		} catch (error: any) {
			if (error instanceof AppError) {
				res.status(error.statusCode || 400).json({
					success: false,
					message: error.message,
				});
				return;
			}

			console.error('[Pincode Controller] Error getting cities by state:', error);
			res.status(500).json({
				success: false,
				message: 'Internal server error',
			});
		}
	}

	/**
	 * Get all states
	 * GET /api/v1/admin/states
	 */
	async getStates(req: Request, res: Response): Promise<void> {
		try {
			const states = await pincodeService.getStates();

			res.json({
				success: true,
				data: states,
			});
		} catch (error: any) {
			console.error('[Pincode Controller] Error getting states:', error);
			res.status(500).json({
				success: false,
				message: 'Internal server error',
			});
		}
	}
}

export const pincodeController = new PincodeController();

