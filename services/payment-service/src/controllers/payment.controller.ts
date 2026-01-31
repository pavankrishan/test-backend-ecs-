import { Request, Response, NextFunction } from 'express';
import { successResponse, AppError } from '@kodingcaravan/shared';
import logger from '@kodingcaravan/shared/config/logger';
import {
	createPayment,
	confirmPayment,
	getPayment,
	getPaymentsForStudent,
	getCoinWallet,
	getCoinTransactions,
	awardCoinsForCourseCompletion,
	awardCoinsForReferral,
	adjustCoins,
	redeemCoins,
	getCoinRewardConfiguration,
	getAllCoinConfigurationFromDB,
	updateCoinConfigurationValue,
	createSessionBookingPayment,
	verifyAndConfirmRazorpayPayment,
} from '../services/payment.service';
import { findPaymentByProviderPaymentId, type PaymentStatus } from '../models/payment.model';

function serializeWallet<T extends { balance: number | string }>(wallet: T): T & { balance: number } {
	return {
		...wallet,
		balance: typeof wallet.balance === 'string' ? Number(wallet.balance) : wallet.balance,
	};
}

function serializeTransaction<T extends { amount: number | string }>(
	transaction: T
): T & { amount: number } {
	return {
		...transaction,
		amount: typeof transaction.amount === 'string' ? Number(transaction.amount) : transaction.amount,
	};
}

export class PaymentController {
	static async health(_: Request, res: Response): Promise<Response> {
		const rewards = await getCoinRewardConfiguration();
		return successResponse(res, {
			message: 'Payment Service operational',
			data: {
				rewards,
			},
		});
	}

	static async createPayment(req: Request, res: Response, next: NextFunction) {
		try {
			const result = await createPayment(req.body);
			return successResponse(res, {
				statusCode: 201,
				message: 'Payment initiated',
				data: result,
			});
		} catch (error) {
			next(error);
		}
	}

	static async confirmPayment(req: Request, res: Response, next: NextFunction) {
		try {
			const { paymentId } = req.params;
			if (!paymentId) {
				throw new AppError('Payment ID is required', 400);
			}

			logger.info('Confirming payment', {
				paymentId,
				status: req.body.status,
				provider: req.body.provider,
				hasProviderPaymentId: !!req.body.providerPaymentId,
				correlationId: req.correlationId,
				service: 'payment-service',
			});

			const payment = await confirmPayment(paymentId, req.body);

			logger.info('Payment confirmed', {
				paymentId: payment.id,
				status: payment.status,
				confirmedAt: payment.confirmedAt,
				correlationId: req.correlationId,
				service: 'payment-service',
			});

			return successResponse(res, {
				message: 'Payment updated',
				data: payment,
			});
		} catch (error) {
			logger.error('Error confirming payment', {
				error: error instanceof Error ? error.message : String(error),
				stack: error instanceof Error ? error.stack : undefined,
				paymentId: req.params.paymentId,
				correlationId: req.correlationId,
				service: 'payment-service',
			});
			next(error);
		}
	}

	static async getPayment(req: Request, res: Response, next: NextFunction) {
		try {
			const { paymentId } = req.params;
			if (!paymentId) {
				throw new AppError('Payment ID is required', 400);
			}
			const payment = await getPayment(paymentId);
			return successResponse(res, {
				message: 'Payment retrieved',
				data: payment,
			});
		} catch (error) {
			next(error);
		}
	}

	static async getPaymentsForStudent(req: Request, res: Response, next: NextFunction) {
		try {
			const { studentId } = req.params;
			if (!studentId) {
				throw new AppError('Student ID is required', 400);
			}
			const limit = req.query.limit ? Number(req.query.limit) : undefined;
			const offset = req.query.offset ? Number(req.query.offset) : undefined;

			if (
				(limit !== undefined && (Number.isNaN(limit) || limit < 1)) ||
				(offset !== undefined && (Number.isNaN(offset) || offset < 0))
			) {
				throw new AppError('Invalid pagination parameters', 400);
			}

			const pagination: { limit?: number; offset?: number } = {};
			if (limit !== undefined) pagination.limit = limit;
			if (offset !== undefined) pagination.offset = offset;

			const payments = await getPaymentsForStudent(studentId, pagination);
			return successResponse(res, {
				message: 'Payments retrieved',
				data: payments,
			});
		} catch (error) {
			next(error);
		}
	}

	static async getWallet(req: Request, res: Response, next: NextFunction) {
		try {
			const { studentId } = req.params;
			if (!studentId) {
				throw new AppError('Student ID is required', 400);
			}
			// getCoinWallet will create the wallet if it doesn't exist
			const wallet = await getCoinWallet(studentId);
			logger.info('Wallet retrieved for student', {
				walletId: wallet.id,
				balance: wallet.balance,
				studentId: wallet.studentId,
				correlationId: req.correlationId,
				service: 'payment-service',
			});
			return successResponse(res, {
				message: 'Wallet retrieved',
				data: serializeWallet(wallet),
			});
		} catch (error) {
			logger.error('Error getting wallet for student', {
				error: error instanceof Error ? error.message : String(error),
				stack: error instanceof Error ? error.stack : undefined,
				studentId: req.params.studentId,
				correlationId: req.correlationId,
				service: 'payment-service',
			});
			next(error);
		}
	}

	static async getWalletTransactions(req: Request, res: Response, next: NextFunction) {
		try {
			const { studentId } = req.params;
			if (!studentId) {
				throw new AppError('Student ID is required', 400);
			}
			const limit = req.query.limit ? Number(req.query.limit) : undefined;
			const offset = req.query.offset ? Number(req.query.offset) : undefined;

			if (
				(limit !== undefined && (Number.isNaN(limit) || limit < 1)) ||
				(offset !== undefined && (Number.isNaN(offset) || offset < 0))
			) {
				throw new AppError('Invalid pagination parameters', 400);
			}

			const pagination: { limit?: number; offset?: number } = {};
			if (limit !== undefined) pagination.limit = limit;
			if (offset !== undefined) pagination.offset = offset;

			const transactions = await getCoinTransactions(studentId, pagination);
			return successResponse(res, {
				message: 'Coin transactions retrieved',
				data: transactions.map(serializeTransaction),
			});
		} catch (error) {
			next(error);
		}
	}

	static async awardCourseCompletion(req: Request, res: Response, next: NextFunction) {
		try {
			const result = await awardCoinsForCourseCompletion(req.body);
			return successResponse(res, {
				statusCode: 201,
				message: 'Course completion coins awarded',
				data: {
					wallet: serializeWallet(result.wallet),
					transaction: serializeTransaction(result.transaction),
				},
			});
		} catch (error) {
			next(error);
		}
	}

	static async awardReferral(req: Request, res: Response, next: NextFunction) {
		try {
			const result = await awardCoinsForReferral(req.body);
			return successResponse(res, {
				statusCode: 201,
				message: 'Referral coins awarded',
				data: {
					wallet: serializeWallet(result.wallet),
					transaction: serializeTransaction(result.transaction),
				},
			});
		} catch (error) {
			next(error);
		}
	}

	static async adjustCoins(req: Request, res: Response, next: NextFunction) {
		try {
			const result = await adjustCoins(req.body);
			return successResponse(res, {
				statusCode: 201,
				message: 'Coins adjusted',
				data: {
					wallet: serializeWallet(result.wallet),
					transaction: serializeTransaction(result.transaction),
				},
			});
		} catch (error) {
			next(error);
		}
	}

	static async redeemCoins(req: Request, res: Response, next: NextFunction) {
		try {
			const result = await redeemCoins(req.body);
			return successResponse(res, {
				message: 'Coins redeemed',
				data: {
					wallet: serializeWallet(result.wallet),
					transaction: serializeTransaction(result.transaction),
				},
			});
		} catch (error) {
			next(error);
		}
	}

	static async createSessionBookingPayment(req: Request, res: Response, next: NextFunction) {
		try {
			const result = await createSessionBookingPayment(req.body);
			return successResponse(res, {
				statusCode: 201,
				message: 'Session booking payment initiated',
				data: result,
			});
		} catch (error) {
			next(error);
		}
	}

	static async handleRazorpayWebhook(req: Request, res: Response, next: NextFunction) {
		try {
			const { event, payload } = req.body;


			// Handle payment.captured event
			if (event === 'payment.captured' || event === 'payment.authorized') {
				const paymentEntity = payload.payment?.entity;
				if (!paymentEntity) {
					return res.status(400).json({ success: false, message: 'Invalid webhook payload' });
				}

				const { id: razorpayPaymentId, order_id: razorpayOrderId, status, method } = paymentEntity;

				// Find payment by providerPaymentId (orderId)
				const payment = await findPaymentByProviderPaymentId(razorpayOrderId);
				
				if (!payment) {
					logger.warn('Payment not found for orderId in webhook', {
						razorpayOrderId,
						event,
						service: 'payment-service',
					});
					return res.status(404).json({ success: false, message: 'Payment not found' });
				}

				// Determine payment status
				let paymentStatus: PaymentStatus = 'processing';
				if (status === 'captured' || status === 'authorized') {
					paymentStatus = 'succeeded';
				} else if (status === 'failed') {
					paymentStatus = 'failed';
				}

				// Update payment status (enrollment will be handled in confirmPayment)
				await confirmPayment(payment.id, {
					status: paymentStatus,
					providerPaymentId: razorpayPaymentId,
					provider: 'razorpay',
					paymentMethod: method || null,
				});


				return res.status(200).json({ success: true, message: 'Webhook processed' });
			}

			// Handle payment.failed event
			if (event === 'payment.failed') {
				const paymentEntity = payload.payment?.entity;
				if (paymentEntity) {
					const { order_id: razorpayOrderId } = paymentEntity;
					const payment = await findPaymentByProviderPaymentId(razorpayOrderId);
					
					if (payment) {
						await confirmPayment(payment.id, {
							status: 'failed',
							provider: 'razorpay',
						});
					}
				}
				return res.status(200).json({ success: true, message: 'Webhook processed' });
			}

			// Handle other events (unhandled events are logged at error level if needed)
			return res.status(200).json({ success: true, message: 'Webhook received' });
		} catch (error) {
			next(error);
		}
	}

	static async verifyPurchaseStatus(req: Request, res: Response, next: NextFunction) {
		try {
			const { paymentId } = req.params;
			if (!paymentId) {
				throw new AppError('Payment ID is required', 400);
			}

			const payment = await getPayment(paymentId);
			const { isRecord } = await import('@kodingcaravan/shared');
			
			// Extract courseId from metadata safely
			let courseId: string | undefined;
			if (isRecord(payment.metadata)) {
				courseId = typeof payment.metadata.courseId === 'string' ? payment.metadata.courseId : undefined;
			}

			// Make parallel requests for better performance
			const checks = await Promise.allSettled([
				payment.status === 'succeeded' && courseId
					? this.checkEnrollmentStatus(payment.studentId, courseId)
					: Promise.resolve('pending' as const),
				payment.status === 'succeeded' && courseId
					? this.checkPurchaseStatus(payment.studentId, courseId)
					: Promise.resolve('pending' as const),
				payment.status === 'succeeded' && courseId
					? this.checkAssignmentStatus(payment.studentId, courseId)
					: Promise.resolve('pending' as const),
			]);

			const enrollmentStatus = checks[0].status === 'fulfilled' ? checks[0].value : 'failed';
			const purchaseStatus = checks[1].status === 'fulfilled' ? checks[1].value : 'failed';
			const assignmentStatus = checks[2].status === 'fulfilled' ? checks[2].value : 'pending';

			return successResponse(res, {
				message: 'Purchase status retrieved',
				data: {
					paymentStatus: payment.status,
					enrollmentStatus,
					purchaseStatus,
					assignmentStatus,
					payment,
				},
			});
		} catch (error) {
			next(error);
		}
	}

	private static async checkEnrollmentStatus(
		studentId: string,
		courseId: string
	): Promise<'enrolled' | 'pending' | 'failed'> {
		try {
			const { httpGet, parseJsonResponse, isSuccessResponse } = await import('@kodingcaravan/shared');
			const studentServiceUrl = process.env.STUDENT_SERVICE_URL || 
				`http://${process.env.SERVICES_HOST || 'localhost'}:${process.env.STUDENT_SERVICE_PORT || 3003}`;
			const progressUrl = `${studentServiceUrl}/api/students/${studentId}/progress`;
			
			const response = await httpGet(progressUrl, { timeout: 5000 });
			
			if (isSuccessResponse(response.statusCode)) {
				const progressData = parseJsonResponse<{ data?: Array<{ courseId: string }> }>(response.data);
				const hasProgress = Array.isArray(progressData.data) 
					? progressData.data.some((p) => p.courseId === courseId)
					: false;
				return hasProgress ? 'enrolled' : 'pending';
			}
			return 'failed';
		} catch (error) {
			logger.error('Enrollment check failed', {
				error: error instanceof Error ? error.message : String(error),
				studentId,
				courseId,
				service: 'payment-service',
			});
			return 'failed';
		}
	}

	private static async checkPurchaseStatus(
		studentId: string,
		courseId: string
	): Promise<'created' | 'pending' | 'failed'> {
		try {
			const { httpGet, isSuccessResponse } = await import('@kodingcaravan/shared');
			const courseServiceUrl = process.env.COURSE_SERVICE_URL || 
				`http://${process.env.SERVICES_HOST || 'localhost'}:${process.env.COURSE_SERVICE_PORT || 3005}`;
			const purchaseUrl = `${courseServiceUrl}/api/v1/purchases/student/${studentId}/course/${courseId}`;
			
			const response = await httpGet(purchaseUrl, { timeout: 5000 });
			
			if (response.statusCode === 200) {
				return 'created';
			} else if (response.statusCode === 404) {
				return 'pending';
			}
			return 'failed';
		} catch (error) {
			logger.error('Purchase check failed', {
				error: error instanceof Error ? error.message : String(error),
				studentId,
				courseId,
				service: 'payment-service',
			});
			return 'failed';
		}
	}

	private static async checkAssignmentStatus(
		studentId: string,
		courseId: string
	): Promise<'assigned' | 'pending' | 'failed'> {
		try {
			const { httpGet, isSuccessResponse } = await import('@kodingcaravan/shared');
			const adminServiceUrl = process.env.ADMIN_SERVICE_URL || 
				`http://${process.env.SERVICES_HOST || 'localhost'}:${process.env.ADMIN_SERVICE_PORT || 3010}`;
			const allocationUrl = `${adminServiceUrl}/api/v1/admin/allocations/student/${studentId}/course/${courseId}`;
			
			const response = await httpGet(allocationUrl, { timeout: 5000 });
			
			if (isSuccessResponse(response.statusCode)) {
				return 'assigned';
			} else if (response.statusCode === 404) {
				return 'pending';
			}
			return 'failed';
		} catch (error) {
			logger.error('Assignment check failed', {
				error: error instanceof Error ? error.message : String(error),
				studentId,
				courseId,
				service: 'payment-service',
			});
			return 'pending'; // Default to pending if check fails
		}
	}

	static async getCoinConfiguration(req: Request, res: Response, next: NextFunction) {
		try {
			const config = await getAllCoinConfigurationFromDB();
			return successResponse(res, {
				message: 'Coin configuration retrieved',
				data: config,
			});
		} catch (error) {
			next(error);
		}
	}

	static async updateCoinConfiguration(req: Request, res: Response, next: NextFunction) {
		try {
			const { key, value } = req.body;
			if (!key || typeof value !== 'number' || value < 0) {
				throw new AppError('Invalid configuration: key and positive value are required', 400);
			}

			// Get admin ID from request if available (from auth middleware)
			const updatedBy = (req as any).user?.id || (req as any).admin?.id || null;

			const updated = await updateCoinConfigurationValue(key, value, updatedBy);
			return successResponse(res, {
				message: 'Coin configuration updated',
				data: updated,
			});
		} catch (error) {
			next(error);
		}
	}
}

