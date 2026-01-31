import type { Pool } from 'pg';
import logger from '@kodingcaravan/shared/config/logger';

import { StudentProfileRepository, type StudentProfile, type StudentProfileInput } from '../models/studentProfile.model';
import {
  StudentProgressRepository,
  type StudentCourseProgress,
  type ProgressUpsertInput,
} from '../models/studentProgress.model';
import {
  ProjectSubmissionRepository,
  type ProjectSubmission,
  type ProjectSubmissionInput,
  type ProjectSubmissionUpdateInput,
} from '../models/projectSubmission.model';
import {
  SupportTicketRepository,
  type SupportTicket,
  type SupportTicketCreateInput,
} from '../models/supportTicket.model';
import { generateCourseCertificate, type CertificatePayload } from '../utils/certificate';
import { geocodingService, type GeocodeResult } from '../../../shared/dist/src/services/geocoding.service.js';

export interface StudentAccount {
  id: string;
  email: string | null;
  phone: string | null;
  username: string | null;
  isEmailVerified: boolean;
  isPhoneVerified: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface StudentOverview {
  account: StudentAccount | null;
  profile: StudentProfile | null;
  progress: StudentCourseProgress[];
  submissions: ProjectSubmission[];
  certificates: CertificatePayload[];
  stats: {
    activeCourses: number;
    averageProgress: number;
    pendingProjects: number;
  };
}

export interface StudentListOptions {
  search?: string;
  limit?: number;
  page?: number;
  status?: 'active' | 'inactive';
}

export interface StudentSummary {
  studentId: string;
  fullName: string | null;
  email: string | null;
  phone: string | null;
  avatarUrl: string | null;
  isEmailVerified: boolean;
  isPhoneVerified: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  progressCount: number;
  pendingReschedules: number;
}

export class StudentService {
  constructor(
    private readonly profileRepo: StudentProfileRepository,
    private readonly progressRepo: StudentProgressRepository,
    private readonly projectRepo: ProjectSubmissionRepository,
    private readonly supportTicketRepo: SupportTicketRepository,
    private readonly pool: Pool,
  ) {}

  async getAccount(studentId: string): Promise<StudentAccount | null> {
    const result = await this.pool.query<StudentAccount>(
      `
        SELECT
          id,
          email,
          phone,
          username,
          is_email_verified AS "isEmailVerified",
          is_phone_verified AS "isPhoneVerified",
          last_login_at AS "lastLoginAt",
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM students
        WHERE id = $1
      `,
      [studentId],
    );

    return result.rows[0] ?? null;
  }

  async listStudents(options: StudentListOptions = {}): Promise<{ data: StudentSummary[]; total: number; page: number; limit: number }> {
    const { search, status } = options;
    const limit = Math.min(Math.max(options.limit ?? 20, 1), 100);
    const page = Math.max(options.page ?? 1, 1);
    const offset = (page - 1) * limit;

    const filters: string[] = [];
    const params: any[] = [];
    let idx = 1;

    if (search) {
      filters.push(`(LOWER(coalesce(sp.full_name, '')) LIKE $${idx} OR LOWER(coalesce(s.email, '')) LIKE $${idx} OR LOWER(coalesce(s.phone, '')) LIKE $${idx})`);
      params.push(`%${search.toLowerCase()}%`);
      idx += 1;
    }

    if (status) {
      if (status === 'active') {
        filters.push(`(s.last_login_at IS NOT NULL OR EXISTS (SELECT 1 FROM student_course_progress scp WHERE scp.student_id = s.id))`);
      } else if (status === 'inactive') {
        filters.push(`(s.last_login_at IS NULL AND NOT EXISTS (SELECT 1 FROM student_course_progress scp WHERE scp.student_id = s.id))`);
      }
    }

    const whereClause = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

    const dataQuery = `
      SELECT
        s.id AS "studentId",
        sp.full_name AS "fullName",
        s.email,
        s.phone,
        sp.avatar_url AS "avatarUrl",
        s.is_email_verified AS "isEmailVerified",
        s.is_phone_verified AS "isPhoneVerified",
        s.last_login_at AS "lastLoginAt",
        s.created_at AS "createdAt",
        s.updated_at AS "updatedAt",
        COUNT(DISTINCT scp.course_id) AS "progressCount",
        COUNT(CASE WHEN srr.status = 'pending' THEN 1 END) AS "pendingReschedules"
      FROM students s
      LEFT JOIN student_profiles sp ON sp.student_id = s.id
      LEFT JOIN student_course_progress scp ON scp.student_id = s.id
      LEFT JOIN student_reschedule_requests srr ON srr.student_id = s.id
      ${whereClause}
      GROUP BY s.id, sp.full_name, sp.avatar_url
      ORDER BY s.created_at DESC
      LIMIT $${idx} OFFSET $${idx + 1}
    `;

    const countQuery = `
      SELECT COUNT(*)::int AS total
      FROM students s
      LEFT JOIN student_profiles sp ON sp.student_id = s.id
      ${whereClause}
    `;

    const [dataResult, countResult] = await Promise.all([
      this.pool.query<StudentSummary>(dataQuery, [...params, limit, offset]),
      this.pool.query<{ total: number }>(countQuery, params),
    ]);

    return {
      data: dataResult.rows,
      total: countResult.rows[0]?.total ?? 0,
      page,
      limit,
    };
  }

  async getProfile(studentId: string): Promise<StudentProfile | null> {
    return this.profileRepo.getByStudentId(studentId);
  }

  async upsertProfile(studentId: string, input: StudentProfileInput): Promise<StudentProfile> {
    // Get existing profile to check if location is being changed
    const existingProfile = await this.profileRepo.getByStudentId(studentId);
    
    // Check if student has any active course purchases
    const purchasesResult = await this.pool.query<{ count: number }>(
      `
        SELECT COUNT(*)::int AS count
        FROM student_course_purchases
        WHERE student_id = $1 AND is_active = true
      `,
      [studentId]
    );
    const hasPurchases = (purchasesResult.rows[0]?.count ?? 0) > 0;

    // If student has purchases, do not allow changing location but still save other fields (name, age, gender, etc.)
    let processedInput = { ...input };
    let locationChangeStripped = false;
    if (hasPurchases && existingProfile) {
      const existingAddress = (existingProfile.address || '').trim();
      const newAddress = input.address !== undefined ? (input.address || '').trim() : existingAddress;
      const isChangingAddress = input.address !== undefined && newAddress !== existingAddress;
      const existingLat = existingProfile.latitude ?? null;
      const existingLng = existingProfile.longitude ?? null;
      const newLat = input.latitude ?? null;
      const newLng = input.longitude ?? null;
      const isChangingLatitude = input.latitude !== undefined && newLat !== existingLat;
      const isChangingLongitude = input.longitude !== undefined && newLng !== existingLng;

      if (isChangingAddress || isChangingLatitude || isChangingLongitude) {
        locationChangeStripped = true;
        const { address: _a, latitude: _lat, longitude: _lng, ...rest } = processedInput;
        processedInput = { ...rest } as StudentProfileInput;
        processedInput.address = existingProfile.address ?? undefined;
        processedInput.latitude = existingProfile.latitude ?? undefined;
        processedInput.longitude = existingProfile.longitude ?? undefined;
        logger.info('Location change skipped (student has purchases); other profile fields will be saved', {
          studentId,
          service: 'student-service',
        });
      }
    }

    // Process address geocoding only when we are actually updating address (not when we stripped location)
    if (!locationChangeStripped && processedInput.address && processedInput.address.trim().length > 0) {
      // Check if coordinates are already provided
      const hasExistingCoords = input.latitude != null && input.longitude != null;

      if (!hasExistingCoords) {
        try {
          logger.debug('Geocoding address for student', {
            studentId,
            address: input.address?.substring(0, 50) + '...',
            service: 'student-service',
          });

          const geocodeResult = await geocodingService.geocodeAddress(processedInput.address, {
            provider: 'google', // Try Google first
            countryBias: 'IN', // Bias towards India
            timeout: 8000, // 8 second timeout
          });

          processedInput.latitude = geocodeResult.latitude;
          processedInput.longitude = geocodeResult.longitude;

          logger.info('Successfully geocoded address for student', {
            studentId,
            originalAddress: input.address?.substring(0, 50) + '...',
            geocodedAddress: geocodeResult.address?.substring(0, 50) + '...',
            latitude: geocodeResult.latitude,
            longitude: geocodeResult.longitude,
            confidence: geocodeResult.confidence,
            source: geocodeResult.source,
            service: 'student-service',
          });

        } catch (geocodeError: unknown) {
          const errorMessage = geocodeError instanceof Error ? geocodeError.message : String(geocodeError);
          logger.error('Failed to geocode address for student', {
            studentId,
            address: input.address?.substring(0, 50) + '...',
            error: errorMessage,
            stack: geocodeError instanceof Error ? geocodeError.stack : undefined,
            service: 'student-service',
          });

          // Continue without coordinates - the system can handle this
          // Student will need to update their address later or sessions will fail
          logger.warn('Continuing profile update without coordinates for student', {
            studentId,
            service: 'student-service',
          });
        }
      } else {
        logger.debug('Address update already includes coordinates, skipping geocoding', {
          studentId,
          service: 'student-service',
        });
      }
    }

    return this.profileRepo.upsert(studentId, processedInput);
  }

  /**
   * Geocode existing student profiles that have addresses but no coordinates
   */
  async geocodeExistingProfiles(): Promise<{ processed: number; successful: number; failed: number }> {
    logger.info('Starting geocoding of existing profiles', { service: 'student-service' });

    const profiles = await this.pool.query<StudentProfile>(
      `
        SELECT ${this.profileColumns}
        FROM student_profiles
        WHERE address IS NOT NULL
          AND address != ''
          AND (latitude IS NULL OR longitude IS NULL)
        LIMIT 100
      `
    );

    logger.info('Found profiles needing geocoding', {
      count: profiles.rows.length,
      service: 'student-service',
    });

    let successful = 0;
    let failed = 0;

    for (const profile of profiles.rows) {
      if (!profile.address) continue;

      try {
        logger.debug('Geocoding profile for student', {
          studentId: profile.studentId,
          address: profile.address.substring(0, 50) + '...',
          service: 'student-service',
        });

        const geocodeResult = await geocodingService.geocodeAddress(profile.address, {
          provider: 'google',
          countryBias: 'IN',
          timeout: 8000,
        });

        // Update the profile with coordinates
        await this.profileRepo.upsert(profile.studentId, {
          latitude: geocodeResult.latitude,
          longitude: geocodeResult.longitude,
        });

        logger.info('Successfully geocoded profile for student', {
          studentId: profile.studentId,
          latitude: geocodeResult.latitude,
          longitude: geocodeResult.longitude,
          service: 'student-service',
        });
        successful++;

        // Small delay to avoid overwhelming the geocoding service
        await new Promise(resolve => setTimeout(resolve, 200));

      } catch (error) {
        logger.error('Failed to geocode profile for student', {
          studentId: profile.studentId,
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
          service: 'student-service',
        });
        failed++;
      }
    }

    logger.info('Geocoding completed', {
      successful,
      failed,
      total: profiles.rows.length,
      service: 'student-service',
    });

    return {
      processed: profiles.rows.length,
      successful,
      failed,
    };
  }

  /**
   * Get profile columns for queries
   */
  private get profileColumns() {
    return `
      id, student_id AS "studentId", full_name AS "fullName", age, gender, date_of_birth AS "dateOfBirth", address,
      latitude, longitude, avatar_url AS "avatarUrl", goals, interests,
      learning_preferences AS "learningPreferences", timezone, occupation,
      organization, preferred_languages AS "preferredLanguages", extra,
      created_at AS "createdAt", updated_at AS "updatedAt"
    `;
  }

  async getProgress(studentId: string): Promise<StudentCourseProgress[]> {
    return this.progressRepo.listByStudent(studentId);
  }

  /**
   * @deprecated student_course_progress is now read-only and derived from tutoring_sessions via database triggers.
   * Progress is automatically updated when tutoring sessions are completed.
   * This method now returns the current progress (read-only).
   */
  async upsertProgress(studentId: string, courseId: string, input: Omit<ProgressUpsertInput, 'studentId' | 'courseId'>): Promise<StudentCourseProgress> {
    logger.warn('upsertProgress is deprecated - progress is now derived from tutoring_sessions via database triggers', {
      studentId,
      courseId,
      service: 'student-service',
    });
    
    // Return current progress (read-only)
    const current = await this.progressRepo.getByStudentAndCourse(studentId, courseId);
    
    if (!current) {
      // If no progress exists yet, return default (triggers will create it on first session completion)
      throw new Error(
        'Progress record not found. Progress is automatically created when the first tutoring session is completed. ' +
        'Complete a tutoring session to initialize progress.'
      );
    }
    
    // Check if course was just completed (for coin awarding)
    // Note: This check is based on current progress, not the input
    const wasCompleted = current.percentage === 100;
    const isCompleting = current.percentage === 100 && !wasCompleted;
    
    // Award coins if course was just completed (percentage reached 100%)
    if (isCompleting) {
      this.awardCoinsForCourseCompletion(studentId, courseId).catch((error) => {
        logger.error('Failed to award coins for course completion', {
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
          studentId,
          courseId,
          service: 'student-service',
        });
      });
    }
    
    return current;
  }

  /**
   * @deprecated student_course_progress is now read-only and derived from tutoring_sessions via database triggers.
   * Progress is automatically updated when tutoring sessions are completed.
   * This method now returns the current progress (read-only).
   */
  async recordLessonCompletion(
    studentId: string,
    courseId: string,
    payload: { increment?: number; totalLessons?: number; moduleProgress?: Record<string, unknown> | null },
  ): Promise<StudentCourseProgress> {
    logger.warn('recordLessonCompletion is deprecated - progress is now derived from tutoring_sessions via database triggers', {
      studentId,
      courseId,
      service: 'student-service',
    });
    
    // Return current progress (read-only)
    const current = await this.progressRepo.getByStudentAndCourse(studentId, courseId);
    
    if (!current) {
      throw new Error(
        'Progress record not found. Progress is automatically created when the first tutoring session is completed. ' +
        'Complete a tutoring session to initialize progress.'
      );
    }
    
    // Check if course was just completed (for coin awarding)
    const wasCompleted = current.percentage === 100;
    const isCompleting = current.percentage === 100 && !wasCompleted;
    
    // Award coins if course was just completed
    if (isCompleting) {
      this.awardCoinsForCourseCompletion(studentId, courseId).catch((error) => {
        logger.error('Failed to award coins for course completion', {
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
          studentId,
          courseId,
          service: 'student-service',
        });
      });
    }
    
    return current;
  }

  /**
   * Resolve service URL with Docker detection
   * Priority: Explicit URL env var > SERVICES_HOST > Docker service name > localhost
   */
  private resolveServiceUrl(serviceName: string, defaultPort: number, urlEnv?: string): string {
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

  /**
   * Award coins for course completion by calling payment service
   */
  private async awardCoinsForCourseCompletion(studentId: string, courseId: string): Promise<void> {
    try {
      const paymentServiceUrl = this.resolveServiceUrl('payment-service', 3007, 'PAYMENT_SERVICE_URL');
      
      const awardUrl = `${paymentServiceUrl}/api/v1/payments/coins/course-completion`;
      
      const { request } = await import('http');
      const { request: httpsRequest } = await import('https');
      const { URL } = await import('url');

      const url = new URL(awardUrl);
      const isHttps = url.protocol === 'https:';
      const httpModule = isHttps ? httpsRequest : request;
      
      const requestBody = JSON.stringify({
        studentId,
        courseId,
      });

      const response = await new Promise<{ statusCode: number; statusMessage: string; data: string }>((resolve, reject) => {
        const req = httpModule({
          hostname: url.hostname,
          port: url.port || (isHttps ? 443 : 80),
          path: url.pathname,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(requestBody),
          },
        }, (res) => {
          let data = '';
          res.on('data', (chunk) => {
            data += chunk.toString();
          });
          res.on('end', () => {
            resolve({
              statusCode: res.statusCode || 500,
              statusMessage: res.statusMessage || '',
              data,
            });
          });
        });

        req.on('error', (error) => {
          reject(error);
        });

        req.write(requestBody);
        req.end();
      });

      if (response.statusCode >= 200 && response.statusCode < 300) {
        logger.info('Coins awarded successfully for course completion', {
          studentId,
          courseId,
          service: 'student-service',
        });
      } else {
        logger.warn('Failed to award coins', {
          statusCode: response.statusCode,
          statusText: response.statusMessage,
          studentId,
          courseId,
          service: 'student-service',
        });
      }
    } catch (error: any) {
      logger.error('Error awarding coins for course completion', {
        error: error?.message || String(error),
        stack: error?.stack,
        studentId,
        courseId,
        service: 'student-service',
      });
      // Don't throw - coin awarding failure shouldn't fail progress update
    }
  }

  async createProjectSubmission(input: ProjectSubmissionInput): Promise<ProjectSubmission> {
    return this.projectRepo.create(input);
  }

  async updateProjectSubmission(id: string, updates: ProjectSubmissionUpdateInput): Promise<ProjectSubmission | null> {
    return this.projectRepo.update(id, updates);
  }

  async listProjectSubmissions(
    studentId: string,
    options?: { limit?: number }
  ): Promise<ProjectSubmission[]> {
    return this.projectRepo.listByStudent(studentId, options);
  }

  async getProjectSubmission(id: string): Promise<ProjectSubmission | null> {
    return this.projectRepo.findById(id);
  }

  async createSupportTicket(input: SupportTicketCreateInput): Promise<SupportTicket> {
    return this.supportTicketRepo.create(input);
  }

  async getOverview(studentId: string): Promise<StudentOverview> {
    const [account, profile, progress, submissions] = await Promise.all([
      this.getAccount(studentId),
      this.getProfile(studentId),
      this.getProgress(studentId),
      this.listProjectSubmissions(studentId, { limit: 50 }), // Limit to 50 for bootstrap
    ]);

    // CRITICAL: Always log progress data for debugging (even in production for critical issues)
    logger.debug('getOverview progress data', {
      studentId,
      progressCount: progress.length,
      progressItems: progress.map((p) => ({
        courseId: p.courseId,
        percentage: p.percentage,
        percentageType: typeof p.percentage,
        completedLessons: p.completedLessons,
        totalLessons: p.totalLessons,
      })),
      // Log calculated average for verification
      calculatedAverage: progress.length > 0
        ? Number((progress.reduce((acc, item) => acc + (item.percentage ?? 0), 0) / Math.max(progress.length, 1)).toFixed(2))
        : 0,
    });

    // Count active courses from purchases/allocations (not just progress)
    // A student can have active courses even if no sessions completed yet
    const activeCoursesResult = await this.pool.query<{ count: number }>(
      `
        SELECT COUNT(DISTINCT course_id)::int AS count
        FROM student_course_purchases
        WHERE student_id = $1 AND is_active = true
      `,
      [studentId]
    );
    const activeCoursesFromPurchases = activeCoursesResult.rows[0]?.count ?? 0;

    // Also check allocations (approved/active)
    const activeCoursesFromAllocationsResult = await this.pool.query<{ count: number }>(
      `
        SELECT COUNT(DISTINCT course_id)::int AS count
        FROM trainer_allocations
        WHERE student_id = $1 
          AND status IN ('approved', 'active')
          AND course_id IS NOT NULL
      `,
      [studentId]
    );
    const activeCoursesFromAllocations = activeCoursesFromAllocationsResult.rows[0]?.count ?? 0;

    // Use the maximum of both (some courses might be in purchases but not allocations, or vice versa)
    const activeCourses = Math.max(activeCoursesFromPurchases, activeCoursesFromAllocations, progress.length);

    const certificates: CertificatePayload[] = [];
    for (const prog of progress) {
      if (prog.percentage >= 100) {
        certificates.push(
          generateCourseCertificate({
            studentId,
            studentName: profile?.fullName ?? account?.username ?? 'Learner',
            courseId: prog.courseId,
          }),
        );
      }
    }

    const averageProgress =
      progress.length > 0
        ? Number(
            (
              progress.reduce((acc, item) => acc + (item.percentage ?? 0), 0) / Math.max(progress.length, 1)
            ).toFixed(2),
          )
        : 0;

    const pendingProjects = submissions.filter((submission) => submission.status === 'submitted').length;

    return {
      account,
      profile,
      progress,
      submissions,
      certificates,
      stats: {
        activeCourses,
        averageProgress,
        pendingProjects,
      },
    };
  }

  /**
   * Check if student can claim their deal (new user - no purchases and hasn't claimed deal)
   */
  async canClaimDeal(studentId: string): Promise<{ canClaim: boolean; reason?: string }> {
    // Check if student has any purchases
    const purchasesResult = await this.pool.query<{ count: number }>(
      `
        SELECT COUNT(*)::int AS count
        FROM student_course_purchases
        WHERE student_id = $1 AND is_active = true
      `,
      [studentId]
    );
    const hasPurchases = (purchasesResult.rows[0]?.count ?? 0) > 0;

    if (hasPurchases) {
      return { canClaim: false, reason: 'You have already made a purchase. This deal is only for new users.' };
    }

    // Check if student has already claimed deal
    const studentResult = await this.pool.query<{ has_claimed_deal: boolean }>(
      `
        SELECT COALESCE(has_claimed_deal, false) AS has_claimed_deal
        FROM students
        WHERE id = $1
      `,
      [studentId]
    );

    if (studentResult.rows.length === 0) {
      return { canClaim: false, reason: 'Student not found' };
    }

    const hasClaimedDeal = studentResult.rows[0]?.has_claimed_deal ?? false;

    if (hasClaimedDeal) {
      return { canClaim: false, reason: 'You have already claimed your deal.' };
    }

    // Check if student has used any coupon
    const couponResult = await this.pool.query<{ count: number }>(
      `
        SELECT COUNT(*)::int AS count
        FROM coupon_redemptions
        WHERE student_id = $1
      `,
      [studentId]
    );
    const hasUsedCoupon = (couponResult.rows[0]?.count ?? 0) > 0;

    if (hasUsedCoupon) {
      return { canClaim: false, reason: 'You have already used a coupon code. Only one discount (coupon or deal) can be used per user.' };
    }

    return { canClaim: true };
  }

  /**
   * Claim deal for student (mark as claimed)
   */
  async claimDeal(studentId: string): Promise<{ success: boolean; message: string }> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // Check if student can claim deal
      const canClaimResult = await this.canClaimDeal(studentId);
      if (!canClaimResult.canClaim) {
        await client.query('ROLLBACK');
      return { success: false, message: canClaimResult.reason || 'Cannot claim deal' };
    }

    // Mark deal as claimed
    await client.query(
      `
        UPDATE students
        SET has_claimed_deal = true, updated_at = NOW()
        WHERE id = $1
      `,
      [studentId]
    );

    await client.query('COMMIT');
    return { success: true, message: 'Deal claimed successfully' };
  } catch (error: any) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

  /**
   * Generate or get referral code for student (based on student ID)
   * Uses first 8 characters of student UUID, uppercase
   */
  async getReferralCode(studentId: string): Promise<string> {
    const student = await this.getAccount(studentId);
    if (!student) {
      throw new Error('Student not found');
    }
    
    // Use first 8 characters of student ID, uppercase
    return student.id.substring(0, 8).toUpperCase();
  }

  /**
   * Get referral stats for student
   */
  async getReferralStats(studentId: string): Promise<{
    totalReferrals: number;
    totalCoinsEarned: number;
    pendingRewards: number;
  }> {
    // Check if referrals table exists (it might not in some schemas)
    const tableExistsResult = await this.pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'referrals'
      )
    `);
    
    const tableExists = tableExistsResult.rows[0]?.exists ?? false;
    
    if (!tableExists) {
      // Return empty stats if table doesn't exist
      return {
        totalReferrals: 0,
        totalCoinsEarned: 0,
        pendingRewards: 0,
      };
    }
    
    const result = await this.pool.query<{
      total: number;
      coins: number;
      pending: number;
    }>(`
      SELECT 
        COUNT(*)::int AS total,
        COALESCE(SUM(coins_awarded), 0)::int AS coins,
        COUNT(*) FILTER (WHERE status = 'pending')::int AS pending
      FROM referrals
      WHERE referrer_id = $1
    `, [studentId]);
    
    return {
      totalReferrals: result.rows[0]?.total ?? 0,
      totalCoinsEarned: result.rows[0]?.coins ?? 0,
      pendingRewards: result.rows[0]?.pending ?? 0,
    };
  }
}

