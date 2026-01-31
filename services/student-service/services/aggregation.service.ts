/**
 * Aggregation Service for Student Data
 * 
 * Provides optimized aggregation endpoints that combine multiple data sources
 * with Redis caching for high-performance at scale.
 */

import type { Pool } from 'pg';
import { getRedisClient } from '@kodingcaravan/shared';
import logger from '@kodingcaravan/shared/config/logger';
import { httpGet, isSuccessResponse, parseJsonResponse } from '@kodingcaravan/shared';
import type { StudentService } from './student.service';

// Shorter cache TTL in development for easier testing
const CACHE_TTL_SECONDS = process.env.NODE_ENV === 'development' ? 30 : 300; // 30 seconds in dev, 5 minutes in production
const HOME_CACHE_PREFIX = 'student:home:';
const LEARNING_CACHE_PREFIX = 'student:learning:';
const MAX_UPCOMING_SESSIONS = 1000; // Support up to 1000 sessions (5 courses × 90 sessions = 450, with room for growth)

/**
 * Resolve service URL with Docker detection
 * Priority: Explicit URL env var > SERVICES_HOST > Docker service name > localhost
 */
function resolveServiceUrl(serviceName: string, defaultPort: number, urlEnv?: string): string {
	// Priority 1: Explicit URL from environment variable
	if (urlEnv && process.env[urlEnv]) {
		return process.env[urlEnv] as string;
	}

	const portValue = process.env[`${serviceName.toUpperCase().replace(/-/g, '_')}_PORT`] || 
		process.env[`${serviceName.toUpperCase().replace(/-/g, '_')}_SERVICE_PORT`];
	const port = Number(portValue) || defaultPort;

	// Check if we're in Docker
	const servicesHost = process.env.SERVICES_HOST;
	let isDocker = 
		process.env.DOCKER === 'true' || 
		process.env.IN_DOCKER === 'true' ||
		process.env.DOCKER_CONTAINER === 'true';

	// Check for /.dockerenv file (Docker indicator) - only on Linux
	if (!isDocker && process.platform === 'linux') {
		try {
			const fs = require('fs');
			isDocker = fs.existsSync('/.dockerenv');
		} catch {
			// Ignore errors - not critical
		}
	}

	// Priority 2: Custom SERVICES_HOST provided
	if (servicesHost && servicesHost !== 'http://localhost' && servicesHost !== 'localhost') {
		const trimmedHost = servicesHost.endsWith('/') ? servicesHost.slice(0, -1) : servicesHost;
		return `${trimmedHost}:${port}`;
	}

	// Priority 3: Docker environment - use service names for inter-container communication
	if (isDocker) {
		return `http://${serviceName}:${port}`;
	}

	// Priority 4: Local development (not Docker) - use localhost
	return `http://localhost:${port}`;
}

export interface StudentHomeData {
	overview: {
		account: any;
		profile: any;
		progress: any[]; // Course progress array
		stats: {
			activeCourses: number;
			averageProgress: number;
			pendingProjects: number;
		};
	};
	upcomingSessions: any[];
	recentCourses: any[];
	trendingCourses: any[]; // Popular courses for recommendations
	notifications: {
		unreadCount: number;
	};
}

export interface StudentLearningData {
	progress: any[];
	courses: any[];
	submissions: any[];
	certificates: any[];
	stats: {
		totalCourses: number;
		completedCourses: number;
		averageProgress: number;
	};
}

export class AggregationService {
	constructor(
		private readonly studentService: StudentService,
		private readonly pool: Pool,
		private readonly redis = getRedisClient()
	) {}

	/**
	 * Get aggregated home screen data with Redis caching
	 */
	async getHomeData(studentId: string, noCache: boolean = false): Promise<StudentHomeData> {
		const cacheKey = `${HOME_CACHE_PREFIX}${studentId}`;
		const startTime = Date.now();

		// Try cache first (unless bypassed)
		if (!noCache) {
			const cached = await this.redis.get(cacheKey);
			if (cached) {
				const duration = Date.now() - startTime;
				const parsed = JSON.parse(cached);
				const sessionCount = parsed?.upcomingSessions?.length || 0;
				
				logger.info('[AggregationService] Cache HIT', {
					studentId,
					cacheKey,
					durationMs: duration,
					sessionCount,
					source: 'cache',
				});
				
				return parsed;
			}
		} else {
			logger.info('[AggregationService] Cache BYPASSED - fetching fresh data', {
				studentId,
				cacheKey,
				reason: 'noCache=true',
			});
		}

		// Cache miss - fetch from database
		logger.info('[AggregationService] Cache MISS - fetching fresh data', {
			studentId,
			cacheKey,
			reason: 'cache_miss',
		});

		// OPTIMIZED: Fetch all data in parallel for maximum speed
		// Sessions are already optimized to ~2.8s, so parallel execution is fastest
		const [overview, sessions, recentCourses, trendingCourses, unreadCount] = await Promise.allSettled([
			this.studentService.getOverview(studentId),
			this.fetchUpcomingSessions(studentId).catch((err) => {
				logger.error('Failed to fetch upcoming sessions', {
					error: err instanceof Error ? err.message : String(err),
					stack: err instanceof Error ? err.stack : undefined,
					studentId,
					service: 'student-service',
				});
				return [];
			}),
			this.fetchRecentCourses(studentId).catch((err) => {
				logger.warn('Failed to fetch recent courses', {
					error: err instanceof Error ? err.message : String(err),
					studentId,
					service: 'student-service',
				});
				return [];
			}),
			this.fetchTrendingCourses(10).catch((err) => {
				logger.warn('Failed to fetch trending courses', {
					error: err instanceof Error ? err.message : String(err),
					service: 'student-service',
				});
				return [];
			}),
			this.fetchUnreadNotificationCount(studentId).catch((err) => {
				logger.warn('Failed to fetch unread notification count', {
					error: err instanceof Error ? err.message : String(err),
					studentId,
					service: 'student-service',
				});
				return 0;
			}),
		]);

		// Extract values from settled promises
		const overviewData = overview.status === 'fulfilled' ? overview.value : null;
		const sessionsData = sessions.status === 'fulfilled' ? sessions.value : [];
		const recentCoursesData = recentCourses.status === 'fulfilled' ? recentCourses.value : [];
		const trendingCoursesData = trendingCourses.status === 'fulfilled' ? trendingCourses.value : [];
		const unreadCountData = unreadCount.status === 'fulfilled' ? unreadCount.value : 0;

		// Log any failures for debugging
		if (process.env.NODE_ENV === 'development' || process.env.DEBUG) {
			if (overview.status === 'rejected') {
				logger.error('Overview fetch failed', {
					error: overview.reason instanceof Error ? overview.reason.message : String(overview.reason),
					stack: overview.reason instanceof Error ? overview.reason.stack : undefined,
					studentId,
					service: 'student-service',
				});
			}
			if (sessions.status === 'rejected') {
				logger.error('Sessions fetch failed', {
					error: sessions.reason instanceof Error ? sessions.reason.message : String(sessions.reason),
					stack: sessions.reason instanceof Error ? sessions.reason.stack : undefined,
					studentId,
					service: 'student-service',
				});
			}
			if (recentCourses.status === 'rejected') {
				logger.warn('Recent courses fetch failed', {
					error: recentCourses.reason instanceof Error ? recentCourses.reason.message : String(recentCourses.reason),
					studentId,
					service: 'student-service',
				});
			}
			if (trendingCourses.status === 'rejected') {
				logger.warn('Trending courses fetch failed', {
					error: trendingCourses.reason instanceof Error ? trendingCourses.reason.message : String(trendingCourses.reason),
					service: 'student-service',
				});
			}
			if (unreadCount.status === 'rejected') {
				logger.warn('Unread count fetch failed', {
					error: unreadCount.reason instanceof Error ? unreadCount.reason.message : String(unreadCount.reason),
					studentId,
					service: 'student-service',
				});
			}
		}

		// If overview failed, throw error (required data)
		if (!overviewData) {
			const errorMsg = overview.status === 'rejected' 
				? `Failed to fetch student overview: ${overview.reason?.message || overview.reason}`
				: 'Failed to fetch student overview';
			logger.error('Failed to fetch student overview', {
				error: errorMsg,
				studentId,
				service: 'student-service',
			});
			throw new Error(errorMsg);
		}

		// Log progress data for debugging
		if (process.env.NODE_ENV === 'development' || process.env.DEBUG) {
			logger.debug('Home data progress', {
				studentId,
				progressCount: overviewData.progress?.length || 0,
				progressItems: overviewData.progress?.map((p: any) => ({
					courseId: p.courseId,
					percentage: p.percentage,
					percentageType: typeof p.percentage,
					completedLessons: p.completedLessons,
					totalLessons: p.totalLessons,
				})) || [],
				averageProgress: overviewData.stats?.averageProgress,
			});
		}

		const homeData: StudentHomeData = {
			overview: {
				account: overviewData.account,
				profile: overviewData.profile,
				progress: overviewData.progress, // Include progress array for frontend
				stats: overviewData.stats,
			},
			upcomingSessions: sessionsData,
			recentCourses: recentCoursesData,
			trendingCourses: trendingCoursesData, // Add trending courses
			notifications: {
				unreadCount: unreadCountData,
			},
		};

		// Cache for 5 minutes
		await this.redis.setex(cacheKey, CACHE_TTL_SECONDS, JSON.stringify(homeData));
		
		const duration = Date.now() - startTime;
		const sessionCount = homeData.upcomingSessions?.length || 0;
		
		logger.info('[AggregationService] Cache SET - fresh data fetched and cached', {
			studentId,
			cacheKey,
			durationMs: duration,
			sessionCount,
			ttlSeconds: CACHE_TTL_SECONDS,
			source: 'database',
		});

		return homeData;
	}

	/**
	 * Get aggregated learning screen data with Redis caching
	 * Includes: courses with full details, purchase records, progress data
	 */
	async getLearningData(studentId: string): Promise<StudentLearningData> {
		const cacheKey = `${LEARNING_CACHE_PREFIX}${studentId}`;

		// Try cache first
		const cached = await this.redis.get(cacheKey);
		if (cached) {
			return JSON.parse(cached);
		}

		// Fetch from database
		const overview = await this.studentService.getOverview(studentId);

		// Get course IDs from progress (courses with completed sessions)
		const courseIdsFromProgress = overview.progress.map((p: any) => p.courseId).filter(Boolean);

		// CRITICAL FIX: Also get course IDs from purchase records
		// This ensures purchased courses appear even if enrollment hasn't created progress records yet
		// Fetch ALL active purchases first to ensure we don't miss any
		const purchaseCourseIdsResult = await this.pool.query<{ course_id: string }>(
			`
				SELECT DISTINCT course_id
				FROM student_course_purchases
				WHERE student_id = $1 AND is_active = true
			`,
			[studentId]
		).catch((err: unknown) => {
			logger.warn('Failed to fetch purchase course IDs', {
				error: err instanceof Error ? err.message : String(err),
				studentId,
				service: 'student-service',
			});
			return { rows: [] };
		});

		const courseIdsFromPurchases = purchaseCourseIdsResult.rows.map((row: any) => row.course_id).filter(Boolean);
		
		// CRITICAL: Log purchase query results for debugging
		if (process.env.NODE_ENV === 'development' || process.env.DEBUG) {
			logger.debug('Purchase query results', {
				studentId,
				purchasesFound: purchaseCourseIdsResult.rows.length,
				courseIdsFromPurchasesCount: courseIdsFromPurchases.length,
				courseIdsFromProgressCount: courseIdsFromProgress.length,
				allCourseIdsCount: Array.from(new Set([...courseIdsFromProgress, ...courseIdsFromPurchases])).length,
				service: 'student-service',
			});
		}

		// Combine course IDs from both sources (progress and purchases)
		// CRITICAL: Use purchases as primary source to ensure ALL purchased courses are included
		const allCourseIds = Array.from(new Set([...courseIdsFromPurchases, ...courseIdsFromProgress]));

		// Fetch full course details with purchase records (with error handling)
		const courses = await this.fetchCoursesWithPurchases(studentId, allCourseIds).catch((err) => {
			logger.warn('Failed to fetch courses with purchases', {
				error: err instanceof Error ? err.message : String(err),
				studentId,
				courseIdsCount: allCourseIds.length,
				service: 'student-service',
			});
			return [];
		});

		// CRITICAL: Log courses returned for debugging
		if (process.env.NODE_ENV === 'development' || process.env.DEBUG) {
			logger.debug('Courses returned', {
				studentId,
				requestedCount: allCourseIds.length,
				returnedCourses: courses.length,
				service: 'student-service',
			});
		}

		// Calculate stats including purchased courses
		const totalCourses = Math.max(allCourseIds.length, overview.progress.length);
		const completedCourses = overview.progress.filter((p: any) => p.percentage === 100).length;

		const learningData: StudentLearningData = {
			progress: overview.progress,
			courses: courses, // Full course details with purchase records
			submissions: overview.submissions,
			certificates: overview.certificates,
			stats: {
				totalCourses: totalCourses,
				completedCourses: completedCourses,
				averageProgress: overview.stats.averageProgress,
			},
		};

		// Cache for 5 minutes
		await this.redis.setex(cacheKey, CACHE_TTL_SECONDS, JSON.stringify(learningData));

		return learningData;
	}

	/**
	 * Get explicit course state for a student-course pair
	 * Returns explicit state: purchaseStatus, trainerStatus, sessionsStatus, progressVersion
	 * 
	 * STATE GUARANTEES:
	 * - Fast: Single aggregation query (no joins across services)
	 * - Consistent: Returns current database state (no inference from absence)
	 * - Explicit: Uses explicit flags only (is_active, status, COUNT)
	 * - Safe: Works even mid-processing (returns intermediate states correctly)
	 * 
	 * This is the single source of truth for frontend state management.
	 * Frontend can call this on reconnect to recover missed events.
	 */
	async getCourseState(studentId: string, courseId: string): Promise<{
		courseId: string;
		purchaseStatus: 'PROCESSING' | 'READY';
		trainerStatus: 'NOT_ASSIGNED' | 'ASSIGNED' | 'FAILED';
		sessionsStatus: 'PENDING' | 'READY';
		progressVersion: number;
	}> {
		// STATE GUARANTEE: Explicit purchase status check
		// Uses explicit is_active flag, never infers from absence
		const purchaseResult = await this.pool.query<{
			id: string;
			is_active: boolean;
			created_at: Date;
		}>(
			`SELECT id, is_active, created_at 
			 FROM student_course_purchases 
			 WHERE student_id = $1 AND course_id = $2 
			 ORDER BY created_at DESC LIMIT 1`,
			[studentId, courseId]
		);

		// Explicit status: READY only if purchase exists AND is_active = true
		// PROCESSING if purchase doesn't exist or is_active = false
		const purchaseStatus: 'PROCESSING' | 'READY' = 
			purchaseResult.rows.length > 0 && purchaseResult.rows[0].is_active === true
				? 'READY'
				: 'PROCESSING';

		// STATE GUARANTEE: Explicit trainer allocation status
		// Uses explicit status field, never infers from absence
		const allocationResult = await this.pool.query<{
			id: string;
			trainer_id: string | null;
			status: string;
		}>(
			`SELECT id, trainer_id, status 
			 FROM trainer_allocations 
			 WHERE student_id = $1 AND course_id = $2 
			 ORDER BY created_at DESC LIMIT 1`,
			[studentId, courseId]
		);

		// Explicit status: ASSIGNED only if allocation exists AND has trainer_id AND status is approved/active
		// FAILED if status is failed/cancelled
		// NOT_ASSIGNED if no allocation or status is pending
		let trainerStatus: 'NOT_ASSIGNED' | 'ASSIGNED' | 'FAILED' = 'NOT_ASSIGNED';
		if (allocationResult.rows.length > 0) {
			const allocation = allocationResult.rows[0];
			// Explicit checks: trainer_id must exist AND status must be approved/active
			if (allocation.trainer_id !== null && allocation.trainer_id !== undefined && 
			    (allocation.status === 'approved' || allocation.status === 'active')) {
				trainerStatus = 'ASSIGNED';
			} else if (allocation.status === 'failed' || allocation.status === 'cancelled') {
				trainerStatus = 'FAILED';
			}
			// Otherwise remains NOT_ASSIGNED (e.g., status = 'pending')
		}

		// STATE GUARANTEE: Explicit sessions status
		// Uses COUNT(*) > 0, never infers from absence
		let sessionsStatus: 'PENDING' | 'READY' = 'PENDING';
		if (trainerStatus === 'ASSIGNED' && allocationResult.rows.length > 0) {
			const allocationId = allocationResult.rows[0].id;
			const sessionsResult = await this.pool.query<{ count: string }>(
				`SELECT COUNT(*) as count 
				 FROM tutoring_sessions 
				 WHERE allocation_id = $1`,
				[allocationId]
			);
			const sessionCount = parseInt(sessionsResult.rows[0].count);
			// Explicit: READY only if COUNT > 0
			sessionsStatus = sessionCount > 0 ? 'READY' : 'PENDING';
		}

		// STATE GUARANTEE: Explicit progress version
		// Uses updated_at timestamp, returns 0 if no progress record exists
		const progressResult = await this.pool.query<{
			updated_at: Date;
		}>(
			`SELECT updated_at 
			 FROM student_course_progress 
			 WHERE student_id = $1 AND course_id = $2`,
			[studentId, courseId]
		);

		// Explicit version: timestamp if exists, 0 if not
		const progressVersion = progressResult.rows.length > 0
			? new Date(progressResult.rows[0].updated_at).getTime()
			: 0;

		return {
			courseId,
			purchaseStatus,
			trainerStatus,
			sessionsStatus,
			progressVersion,
		};
	}

	/**
	 * Fetch courses with full details and purchase records
	 */
	private async fetchCoursesWithPurchases(studentId: string, courseIds: string[]): Promise<any[]> {
		if (courseIds.length === 0) {
			return [];
		}

		// Fetch courses with full details
		const coursesResult = await this.pool.query(
			`
				SELECT 
					c.id,
					c.title,
					c.description,
					c.short_description AS "shortDescription",
					c.thumbnail_url AS "thumbnailUrl",
					c.price,
					c.currency,
					c.discount_price AS "discountPrice",
					c.category,
					c.subcategory,
					c.difficulty,
					c.rating,
					c.total_ratings AS "totalRatings",
					c.total_students AS "totalStudents",
					c.duration,
					c.total_lessons AS "totalLessons",
					c.tags,
					c.created_at AS "createdAt",
					c.updated_at AS "updatedAt"
				FROM courses c
				WHERE c.id = ANY($1::uuid[])
				ORDER BY c.created_at DESC
			`,
			[courseIds]
		);

		// CRITICAL FIX: Fetch purchase records for ALL active purchases for this student
		// Fetch ALL purchases first, then filter by courseIds to ensure we don't miss any
		// This ensures we have purchase data even if some course IDs don't have course details
		const purchasesResult = await this.pool.query(
			`
				SELECT 
					scp.id,
					scp.student_id AS "studentId",
					scp.course_id AS "courseId",
					scp.purchase_tier AS "purchaseTier",
					scp.purchase_date AS "purchaseDate",
					scp.expiry_date AS "expiryDate",
					scp.metadata,
					scp.is_active AS "isActive",
					scp.created_at AS "createdAt",
					scp.updated_at AS "updatedAt"
				FROM student_course_purchases scp
				WHERE scp.student_id = $1
					AND scp.is_active = true
				ORDER BY scp.purchase_date DESC
			`,
			[studentId]
		);
		
		// CRITICAL: Filter purchases to only include requested courseIds
		// This ensures we include ALL purchases, even if courseIds list is incomplete
		const courseIdSet = new Set(courseIds);
		const filteredPurchases = purchasesResult.rows.filter((p: any) => 
			p.courseId && courseIdSet.has(p.courseId)
		);
		
		// CRITICAL: Also include purchases for courses NOT in courseIds list
		// This ensures we don't miss any purchased courses
		const purchasesNotInList = purchasesResult.rows.filter((p: any) => 
			p.courseId && !courseIdSet.has(p.courseId)
		);
		
		if (purchasesNotInList.length > 0 && (process.env.NODE_ENV === 'development' || process.env.DEBUG)) {
			logger.warn('Found purchases not in courseIds list', {
				studentId,
				missingCourseIdsCount: purchasesNotInList.length,
				requestedCourseIdsCount: courseIds.length,
				service: 'student-service',
			});
		}
		
		// Use filtered purchases (matching courseIds) for now
		// Missing courses will be added in the missingCourses section below
		const purchasesToUse = filteredPurchases;

		// Create a map of courseId -> purchase (use the most recent purchase if multiple)
		const purchaseMap = new Map<string, any>();
		purchasesToUse.forEach((purchase: any) => {
			if (purchase.courseId) {
				// If multiple purchases exist, keep the most recent one
				const existing = purchaseMap.get(purchase.courseId);
				if (!existing || new Date(purchase.purchaseDate) > new Date(existing.purchaseDate)) {
					purchaseMap.set(purchase.courseId, purchase);
				}
			}
		});
		
		// CRITICAL: Also add purchases that weren't in the original courseIds list
		// This ensures ALL purchased courses are included
		purchasesNotInList.forEach((purchase: any) => {
			if (purchase.courseId) {
				const existing = purchaseMap.get(purchase.courseId);
				if (!existing || new Date(purchase.purchaseDate) > new Date(existing.purchaseDate)) {
					purchaseMap.set(purchase.courseId, purchase);
				}
			}
		});

		// CRITICAL FIX: Fetch trainer allocations for these courses
		// This ensures trainer info appears even if WebSocket isn't connected
		logger.info('[AggregationService] Fetching allocations', {
			studentId,
			courseIdsCount: courseIds.length,
			courseIds,
		});
		
		let allocationsResult;
		try {
			allocationsResult = await this.pool.query(
				`
					SELECT 
						ta.id,
						ta.student_id AS "studentId",
						ta.course_id AS "courseId",
						ta.trainer_id AS "trainerId",
						ta.status,
						ta.metadata,
						ta.created_at AS "createdAt",
						ta.updated_at AS "updatedAt",
						tp.full_name AS "trainerName",
						COALESCE(
							(tp.extra->>'avatarUrl')::text,
							(tp.extra->>'avatar_url')::text,
							NULL
						) AS "trainerPhoto"
					FROM trainer_allocations ta
					LEFT JOIN trainer_profiles tp ON ta.trainer_id = tp.trainer_id
					WHERE ta.student_id = $1
						AND ta.course_id = ANY($2::uuid[])
						AND ta.status IN ('approved', 'active')
					ORDER BY ta.created_at DESC
				`,
				[studentId, courseIds]
			);
			logger.info('[AggregationService] Allocation query executed successfully', {
				studentId,
				courseIdsCount: courseIds.length,
				allocationsFound: allocationsResult.rows.length,
			});
		} catch (err: unknown) {
			logger.error('[AggregationService] Failed to fetch allocations:', {
				error: err instanceof Error ? err.message : String(err),
				studentId,
				courseIdsCount: courseIds.length,
			});
			allocationsResult = { rows: [] };
		}
		
		if (process.env.NODE_ENV === 'development' || process.env.DEBUG) {
			logger.debug('Allocations fetched', {
				allocationsCount: allocationsResult.rows.length,
				studentId,
				courseIdsCount: courseIds.length,
				service: 'student-service',
			});
		}

		// Create a map of courseId -> allocation (use the most recent allocation if multiple)
		const allocationMap = new Map<string, any>();
		allocationsResult.rows.forEach((allocation: any) => {
			if (allocation.courseId) {
				const existing = allocationMap.get(allocation.courseId);
				if (!existing || new Date(allocation.createdAt) > new Date(existing.createdAt)) {
					allocationMap.set(allocation.courseId, allocation);
				}
			}
		});

		// Helper: derive classType and scheduleType from allocation metadata (for learnings card)
		const enrichAllocationForLearning = (alloc: any) => {
			if (!alloc) return null;
			const meta = alloc.metadata && typeof alloc.metadata === 'object' ? alloc.metadata : {};
			const groupSize = meta.groupSize;
			const learningMode = meta.learningMode;
			let classType = 'N/A';
			if (groupSize && learningMode) {
				const groupType = groupSize === 1 ? '1-on-1' : `1-on-${groupSize}`;
				const modeDisplay = learningMode === 'home' ? 'Home' : learningMode === 'hybrid' ? 'Hybrid' : learningMode;
				classType = `${groupType} (${modeDisplay})`;
			} else if (groupSize) {
				classType = groupSize === 1 ? '1-on-1' : `1-on-${groupSize}`;
			} else if (learningMode) {
				classType = learningMode === 'home' ? 'Home' : learningMode === 'hybrid' ? 'Hybrid' : learningMode;
			}
			const isSundayOnly = meta.isSundayOnly === true;
			const schedule = meta.schedule && typeof meta.schedule === 'object' ? meta.schedule : {};
			const mode = schedule.mode || meta.scheduleType || meta.schedule_mode || meta.scheduleMode;
			let scheduleType: string | null = null;
			if (isSundayOnly || (mode && String(mode).toLowerCase().includes('sunday'))) scheduleType = 'Sunday Only';
			else if (mode && String(mode).toLowerCase() === 'everyday') scheduleType = 'Everyday';
			else if (mode && typeof mode === 'string') scheduleType = mode.charAt(0).toUpperCase() + mode.slice(1).toLowerCase();
			return {
				id: alloc.id,
				trainerId: alloc.trainerId,
				trainerName: alloc.trainerName,
				trainerPhoto: alloc.trainerPhoto,
				status: alloc.status,
				classType,
				scheduleType: scheduleType ?? undefined,
			};
		};

		// Combine courses with their purchase records and allocations
		const coursesWithPurchases = coursesResult.rows.map((course: any) => {
			const allocation = allocationMap.get(course.id);
			const courseWithData = {
				...course,
				purchase: purchaseMap.get(course.id) || null,
				allocation: allocation ? enrichAllocationForLearning(allocation) : null,
			};
			
			if (process.env.NODE_ENV === 'development' || process.env.DEBUG) {
				if (allocation) {
					logger.debug('Course with allocation', {
						courseId: course.id,
						trainerId: allocation.trainerId,
						hasTrainerName: !!allocation.trainerName,
						service: 'student-service',
					});
				}
			}
			
			return courseWithData;
		});

		// CRITICAL FIX: Also include purchased courses that don't have course details yet
		// This ensures all purchased courses appear even if course record is missing
		const purchasedCourseIds = Array.from(purchaseMap.keys());
		const existingCourseIds = new Set(coursesResult.rows.map((c: any) => c.id));
		
		// CRITICAL: Include ALL purchased courses, even if not in original courseIds list
		const missingCourses = purchasedCourseIds
			.filter((courseId) => !existingCourseIds.has(courseId))
			.map((courseId) => {
				const purchase = purchaseMap.get(courseId);
				const allocation = allocationMap.get(courseId);
				return {
					id: courseId,
					title: `Course ${courseId.substring(0, 8)}`, // Fallback title
					description: null,
					shortDescription: null,
					thumbnailUrl: null,
					price: null,
					currency: null,
					discountPrice: null,
					category: null,
					subcategory: null,
					difficulty: null,
					rating: null,
					totalRatings: null,
					totalStudents: null,
					duration: '40 min', // Default duration
					totalLessons: null,
					tags: null,
					createdAt: purchase?.createdAt || new Date(),
					updatedAt: purchase?.updatedAt || new Date(),
					purchase: purchase || null,
					allocation: allocation ? enrichAllocationForLearning(allocation) : null,
				};
			});

		// Return all courses (with details + missing ones with purchase records)
		const allCourses = [...coursesWithPurchases, ...missingCourses];
		
		// CRITICAL: Log final courses count for debugging
		if (process.env.NODE_ENV === 'development' || process.env.DEBUG) {
			logger.debug('Final courses count', {
				studentId,
				requestedCount: courseIds.length,
				coursesWithDetails: coursesWithPurchases.length,
				missingCourses: missingCourses.length,
				totalReturned: allCourses.length,
				returnedCourseIds: allCourses.map((c: any) => c?.id).filter(Boolean),
			});
		}
		
		return allCourses;
	}

	/**
	 * Invalidate home cache for a student
	 * Called on: course purchase, booking creation/update, session completion
	 */
	async invalidateHomeCache(studentId: string, reason?: string): Promise<void> {
		const cacheKey = `${HOME_CACHE_PREFIX}${studentId}`;
		const existed = await this.redis.exists(cacheKey);
		await this.redis.del(cacheKey);
		
		logger.info('[AggregationService] Cache INVALIDATED', {
			studentId,
			cacheKey,
			reason: reason || 'manual',
			existedBefore: existed === 1,
		});
	}

	/**
	 * Invalidate learning cache for a student
	 * Called on: course purchase, session completion, progress update
	 */
	async invalidateLearningCache(studentId: string, reason?: string): Promise<void> {
		const cacheKey = `${LEARNING_CACHE_PREFIX}${studentId}`;
		const existed = await this.redis.exists(cacheKey);
		await this.redis.del(cacheKey);
		
		logger.info('[AggregationService] Cache INVALIDATED', {
			studentId,
			cacheKey,
			reason: reason || 'manual',
			existedBefore: existed === 1,
		});
	}

	/**
	 * Invalidate all caches for a student
	 */
	async invalidateAllCaches(studentId: string, reason?: string): Promise<void> {
		await Promise.all([
			this.invalidateHomeCache(studentId, reason),
			this.invalidateLearningCache(studentId, reason),
		]);
		
		logger.info('[AggregationService] All caches invalidated', {
			studentId,
			reason: reason || 'manual',
		});
	}

	/**
	 * Fetch upcoming sessions for student
	 * 
	 * PRODUCTION-GRADE: Comprehensive observability and filter debugging
	 * OPTIMIZATION: Skip querying sessions if student has no active course purchases/allocations
	 */
	private async fetchUpcomingSessions(studentId: string): Promise<any[]> {
		const startTime = Date.now();
		const validStatuses = ['scheduled', 'pending_verification', 'pending_confirmation', 'in_progress'];
		
		try {
			// OPTIMIZED STEP 1: Quick early exit check (single query with UNION)
			// This prevents scanning tutoring_sessions if student has no active courses
			const activeCheck = await this.pool.query<{ has_active: boolean }>(
				`
					SELECT EXISTS (
						SELECT 1 FROM student_course_purchases WHERE student_id = $1 AND is_active = true
						UNION
						SELECT 1 FROM trainer_allocations 
						WHERE student_id = $1 AND status IN ('approved', 'active') AND course_id IS NOT NULL
					) AS has_active
				`,
				[studentId]
			);
			
			if (!activeCheck.rows[0]?.has_active) {
				logger.debug('Student has no active courses, skipping session fetch', {
					studentId,
					executionTimeMs: Date.now() - startTime,
					service: 'student-service',
				});
				return [];
			}
			
			// OPTIMIZED STEP 2: Single main query with all filters
			// Reduced from 8+ queries to just 2 queries total (check + main)
			const result = await this.pool.query(
				`
					SELECT 
						s.id,
						s.course_id AS "courseId",
						s.trainer_id AS "trainerId",
						s.student_id AS "studentId",
						s.status,
						s.scheduled_date AS "scheduledDate",
						s.scheduled_time AS "scheduledTime",
						s.duration,
						s.created_at AS "createdAt",
						s.updated_at AS "updatedAt",
						s.metadata
					FROM tutoring_sessions s
					WHERE s.student_id = $1
						AND s.status = ANY($2::text[])
						AND s.scheduled_date >= (CURRENT_DATE - INTERVAL '1 day')
						AND (
							-- Exclude Sundays until July 31st of current year (holiday rule)
							-- Exception: Sunday-only courses are allowed
							EXTRACT(DOW FROM s.scheduled_date) != 0
							OR (EXTRACT(YEAR FROM s.scheduled_date) = EXTRACT(YEAR FROM CURRENT_DATE) 
							    AND EXTRACT(MONTH FROM s.scheduled_date) > 7)
							OR (EXTRACT(YEAR FROM s.scheduled_date) = EXTRACT(YEAR FROM CURRENT_DATE) 
							    AND EXTRACT(MONTH FROM s.scheduled_date) = 7 
							    AND EXTRACT(DAY FROM s.scheduled_date) > 31)
							OR (s.metadata->>'isSundayOnly')::boolean = true
							OR s.status = 'in_progress'
						)
					ORDER BY s.scheduled_date ASC, s.scheduled_time ASC
					LIMIT ` + MAX_UPCOMING_SESSIONS + `
				`,
				[studentId, validStatuses]
			);

			const sessions = result.rows;
			const rowsAfterFilter = sessions.length;
			const executionTimeMs = Date.now() - startTime;
			
			// Optimized logging (reduced from 8+ queries to 1 query total)
			if (rowsAfterFilter === 0) {
				logger.debug('No upcoming sessions found for student', {
					studentId,
					executionTimeMs,
					service: 'student-service',
				});
			} else {
				logger.debug('Sessions fetched (OPTIMIZED)', {
					studentId,
					sessionCount: rowsAfterFilter,
					executionTimeMs,
					service: 'student-service',
				});
			}
			
			// Return empty array if no sessions (don't fail - let frontend handle empty state)
			if (sessions.length === 0) {
				return [];
			}

			// Get unique course IDs and trainer IDs
			const courseIds = [...new Set(sessions.map((s: any) => s.courseId).filter(Boolean))];
			const trainerIds = [...new Set(sessions.map((s: any) => s.trainerId).filter(Boolean))];

			// Batch fetch course details
			const coursesMap = new Map<string, any>();
			if (courseIds.length > 0) {
				try {
					const coursesResult = await this.pool.query<{
						id: string;
						title: string;
					}>(
						`
							SELECT 
								id,
								title
							FROM courses
							WHERE id = ANY($1::uuid[])
						`,
						[courseIds]
					);

					coursesResult.rows.forEach((course: any) => {
						coursesMap.set(course.id, {
							title: course.title,
						});
					});
				} catch (error: any) {
					logger.warn('Error batch fetching courses', {
						error: error?.message || String(error),
						studentId,
						courseIdsCount: courseIds.length,
						service: 'student-service',
					});
				}
			}

			// Batch fetch trainer profiles
			const trainerProfilesMap = new Map<string, any>();
			if (trainerIds.length > 0) {
				try {
					const trainersResult = await this.pool.query<{
						trainer_id: string;
						full_name: string;
						avatar_url: string | null;
					}>(
						`
							SELECT 
								trainer_id,
								full_name,
								COALESCE(
									(extra->>'avatarUrl')::text,
									(extra->>'avatar_url')::text,
									NULL
								) AS avatar_url
							FROM trainer_profiles
							WHERE trainer_id = ANY($1::uuid[])
						`,
						[trainerIds]
					);

					trainersResult.rows.forEach((trainer: any) => {
						trainerProfilesMap.set(trainer.trainer_id, {
							fullName: trainer.full_name,
							avatarUrl: trainer.avatar_url,
						});
					});
				} catch (error: any) {
					logger.warn('Error batch fetching trainer profiles', {
						error: error?.message || String(error),
						studentId,
						trainerIdsCount: trainerIds.length,
						service: 'student-service',
					});
				}
			}

			// Enrich sessions with course and trainer details
			// Always return sessions even if enrichment fails - missing names are better than no sessions
			return sessions.map((session: any) => {
				try {
					const trainer = session.trainerId ? trainerProfilesMap.get(session.trainerId) : null;
					const course = session.courseId ? coursesMap.get(session.courseId) : null;

					// Format scheduledDate as YYYY-MM-DD string to avoid timezone issues
					let formattedScheduledDate = session.scheduledDate;
					if (session.scheduledDate) {
						if (session.scheduledDate instanceof Date) {
							formattedScheduledDate = `${session.scheduledDate.getFullYear()}-${String(session.scheduledDate.getMonth() + 1).padStart(2, '0')}-${String(session.scheduledDate.getDate()).padStart(2, '0')}`;
						} else if (typeof session.scheduledDate === 'string') {
							// Already a string, use as-is or parse if needed
							const dateObj = new Date(session.scheduledDate);
							if (!isNaN(dateObj.getTime())) {
								formattedScheduledDate = `${dateObj.getFullYear()}-${String(dateObj.getMonth() + 1).padStart(2, '0')}-${String(dateObj.getDate()).padStart(2, '0')}`;
							}
						}
					}

					return {
						...session,
						scheduledDate: formattedScheduledDate,
						trainerName: trainer?.fullName || null,
						trainerPhoto: trainer?.avatarUrl || null,
						courseName: course?.title || null,
					};
				} catch (error) {
					// If enrichment fails for a session, return it anyway (without enrichment)
					logger.warn('Error enriching session', {
						error: error instanceof Error ? error.message : String(error),
						sessionId: session.id,
						studentId,
						service: 'student-service',
					});
					return {
						...session,
						trainerName: null,
						trainerPhoto: null,
						courseName: null,
					};
				}
			});
		} catch (error) {
			// If table doesn't exist or query fails, return empty array
			logger.error('Error fetching upcoming sessions', {
				error: error instanceof Error ? error.message : String(error),
				stack: error instanceof Error ? error.stack : undefined,
				studentId,
				service: 'student-service',
			});
			return [];
		}
	}

	/**
	 * Fetch trending courses (popular courses by enrollment)
	 * Used for home screen recommendations
	 */
	private async fetchTrendingCourses(limit: number = 10): Promise<any[]> {
		const result = await this.pool.query(
			`
				SELECT 
					c.id,
					c.title,
					c.description,
					c.short_description AS "shortDescription",
					c.thumbnail_url AS "thumbnailUrl",
					c.price,
					c.currency,
					c.discount_price AS "discountPrice",
					c.category,
					c.subcategory,
					c.difficulty,
					c.rating,
					c.total_ratings AS "totalRatings",
					c.total_students AS "totalStudents",
					c.duration,
					c.total_lessons AS "totalLessons",
					c.tags,
					c.created_at AS "createdAt"
				FROM courses c
				WHERE c.status = 'published'
					AND c.is_active = true
				ORDER BY c.total_students DESC, c.rating DESC, c.created_at DESC
				LIMIT $1
			`,
			[limit]
		);

		return result.rows;
	}

	/**
	 * Fetch recent courses for student (courses they're enrolled in)
	 */
	private async fetchRecentCourses(studentId: string): Promise<any[]> {
		const result = await this.pool.query(
			`
				SELECT 
					c.id,
					c.title,
					c.description,
					c.short_description AS "shortDescription",
					c.thumbnail_url AS "thumbnailUrl",
					c.price,
					c.currency,
					c.discount_price AS "discountPrice",
					c.category,
					c.subcategory,
					c.difficulty,
					c.rating,
					c.total_ratings AS "totalRatings",
					c.total_students AS "totalStudents",
					c.duration,
					c.total_lessons AS "totalLessons",
					c.tags,
					c.created_at AS "createdAt"
				FROM courses c
				INNER JOIN student_course_progress scp ON scp.course_id = c.id
				WHERE scp.student_id = $1
				ORDER BY scp.created_at DESC
				LIMIT 5
			`,
			[studentId]
		);

		return result.rows;
	}

	/**
	 * Fetch unread notification count from notification service
	 */
	private async fetchUnreadNotificationCount(studentId: string): Promise<number> {
		try {
			// Call notification service to get unread count
			const notificationServiceUrl = resolveServiceUrl('notification-service', 3006, 'NOTIFICATION_SERVICE_URL');
			
			// Notification service expects userId as query parameter
			const response = await httpGet(
				`${notificationServiceUrl}/api/v1/notifications/unread-count?userId=${studentId}`,
				{ timeout: 5000 }
			);

			if (!isSuccessResponse(response.statusCode)) {
				logger.warn('Failed to fetch unread count', {
					statusCode: response.statusCode,
					statusMessage: response.statusMessage,
					studentId,
					service: 'student-service',
				});
				return 0;
			}

			const data = parseJsonResponse(response.data);
			// Response format: { success: true, data: { unreadCount: number } }
			return data?.data?.unreadCount || 0;
		} catch (error) {
			logger.warn('Error fetching unread notification count', {
				error: error instanceof Error ? error.message : String(error),
				stack: error instanceof Error ? error.stack : undefined,
				studentId,
				service: 'student-service',
			});
			return 0;
		}
	}
}

