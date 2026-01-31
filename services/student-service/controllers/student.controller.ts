import { Request, Response } from 'express';
import { successResponse, errorResponse } from '@kodingcaravan/shared/utils/responseBuilder';
import { asyncHandler } from '@kodingcaravan/shared/utils/asyncHandler';
import logger from '@kodingcaravan/shared/config/logger';
import type { StudentService } from '../services/student.service';
import type { AggregationService } from '../services/aggregation.service';
import type { ZodRequest } from '@kodingcaravan/shared/types/zodRequest';
import { z } from 'zod';

const listStudentsQuerySchema = z.object({
  search: z.string().trim().optional(),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().optional(),
  status: z.enum(['active', 'inactive']).optional(),
});

const studentIdParamsSchema = z.object({
  studentId: z.string().uuid(),
});

const progressParamsSchema = studentIdParamsSchema.extend({
  courseId: z.string().uuid(),
});

const upsertProgressBodySchema = z.object({
  percentage: z.number().min(0).max(100).optional(),
  completedLessons: z.number().int().min(0).optional(),
  totalLessons: z.number().int().min(0).optional(),
  moduleProgress: z.record(z.any()).optional(),
  streakCount: z.number().int().min(0).optional(),
});

const recordCompletionBodySchema = z.object({
  increment: z.number().int().min(1).optional(),
  totalLessons: z.number().int().min(0).optional(),
  moduleProgress: z.record(z.any()).optional(),
});

const projectCreateSchema = z.object({
  projectTitle: z.string().min(3),
  courseId: z.string().uuid().optional(),
  description: z.string().optional(),
  submissionUrl: z.string().url().optional(),
  attachments: z.array(z.record(z.any())).optional(),
});

const projectUpdateSchema = z.object({
  description: z.string().nullable().optional(),
  submissionUrl: z.string().url().nullable().optional(),
  attachments: z.array(z.record(z.any())).nullable().optional(),
  status: z.enum(['submitted', 'under_review', 'approved', 'needs_revision', 'rejected']).optional(),
  grade: z.number().min(0).max(100).nullable().optional(),
  feedback: z.string().nullable().optional(),
  reviewedAt: z.string().datetime().nullable().optional(),
});

const profileBodySchema = z.object({
  fullName: z.preprocess(
    (val) => (val === '' || (typeof val === 'string' && !val.trim()) ? null : val),
    z.union([z.string().min(2).max(150), z.null()]).optional()
  ),
  age: z.preprocess(
    (val) => (val === undefined || val === null || val === '' ? val : Number(val)),
    z.union([z.number().int().min(5).max(120), z.null()]).optional()
  ),
  gender: z.preprocess(
    (val) => (val === '' || (typeof val === 'string' && !val.trim()) ? null : val),
    z.union([z.string().max(20), z.null()]).optional()
  ),
  dateOfBirth: z.union([z.string().datetime(), z.string().min(1), z.null()]).optional(),
  address: z.string().max(500).nullable().optional(),
  latitude: z.preprocess((val) => (val === undefined || val === null ? val : Number(val)), z.number().min(-90).max(90).nullable().optional()),
  longitude: z.preprocess((val) => (val === undefined || val === null ? val : Number(val)), z.number().min(-180).max(180).nullable().optional()),
  avatarUrl: z.string().max(2000).nullable().optional(),
  goals: z.string().max(1000).nullable().optional(),
  interests: z.array(z.string().max(100)).nullable().optional(),
  learningPreferences: z.record(z.any()).nullable().optional(),
  timezone: z.string().max(100).nullable().optional(),
  occupation: z.string().max(100).nullable().optional(),
  organization: z.string().max(150).nullable().optional(),
  preferredLanguages: z.array(z.string().max(10)).nullable().optional(),
  extra: z.record(z.any()).nullable().optional(),
});

const supportTicketBodySchema = z.object({
  issueType: z.string().trim().min(1).max(100),
  subject: z.string().trim().min(5).max(200),
  description: z.string().trim().min(20),
  email: z.string().trim().email(),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).default('medium'),
  metadata: z.record(z.any()).optional(),
});

type ListStudentsRequest = ZodRequest<{ query: typeof listStudentsQuerySchema }>;
type StudentIdRequest = ZodRequest<{ params: typeof studentIdParamsSchema }>;
type ProgressRequest = ZodRequest<{ params: typeof progressParamsSchema; body?: typeof upsertProgressBodySchema }>;
const projectParamsSchema = studentIdParamsSchema.extend({ projectId: z.string().uuid() });
type CreateSupportTicketRequest = ZodRequest<{ params: typeof studentIdParamsSchema; body: typeof supportTicketBodySchema }>;

export class StudentController {
  constructor(
    private readonly studentService: StudentService,
    private readonly aggregationService?: AggregationService // Optional aggregation service
  ) {}

  listStudents = asyncHandler(async (req: ListStudentsRequest, res: Response) => {
    const { search, limit, page, status } = listStudentsQuerySchema.parse(req.query);
    const result = await this.studentService.listStudents({ search, limit, page, status });

    return successResponse(res, {
      message: 'Students fetched successfully',
      data: result,
    });
  });

  getOverview = asyncHandler(async (req: StudentIdRequest, res: Response) => {
    const { studentId } = studentIdParamsSchema.parse(req.params);
    const overview = await this.studentService.getOverview(studentId);

    if (!overview.account && !overview.profile) {
      return errorResponse(res, {
        statusCode: 404,
        message: 'Student not found',
      });
    }

    return successResponse(res, {
      message: 'Student overview fetched successfully',
      data: overview,
    });
  });

  /**
   * Aggregation endpoint: Get home screen data
   * Combines overview, sessions, courses, notifications
   * Uses Redis caching for performance
   */
  getHome = asyncHandler(async (req: StudentIdRequest, res: Response) => {
    if (!this.aggregationService) {
      return errorResponse(res, {
        statusCode: 501,
        message: 'Aggregation service not available',
      });
    }

    const { studentId } = studentIdParamsSchema.parse(req.params);
    // Allow bypassing cache via query parameter (useful for testing/development)
    const noCache = req.query.noCache === 'true' || req.query.noCache === '1';
    const homeData = await this.aggregationService.getHomeData(studentId, noCache);

    return successResponse(res, {
      message: 'Home data fetched successfully',
      data: homeData,
    });
  });

  /**
   * Aggregation endpoint: Get learning screen data
   * Combines progress, courses, submissions, certificates
   * Uses Redis caching for performance
   */
  getLearning = asyncHandler(async (req: StudentIdRequest, res: Response) => {
    if (!this.aggregationService) {
      return errorResponse(res, {
        statusCode: 501,
        message: 'Aggregation service not available',
      });
    }

    const { studentId } = studentIdParamsSchema.parse(req.params);
    const learningData = await this.aggregationService.getLearningData(studentId);

    return successResponse(res, {
      message: 'Learning data fetched successfully',
      data: learningData,
    });
  });

  /**
   * Get explicit course state for a student-course pair
   * Returns explicit state: purchaseStatus, trainerStatus, sessionsStatus, progressVersion
   * GET /api/students/:studentId/courses/:courseId/state
   */
  getCourseState = asyncHandler(async (req: ProgressRequest, res: Response) => {
    if (!this.aggregationService) {
      return errorResponse(res, {
        statusCode: 501,
        message: 'Aggregation service not available',
      });
    }

    const { studentId, courseId } = progressParamsSchema.parse(req.params);
    
    if (!courseId) {
      return errorResponse(res, {
        statusCode: 400,
        message: 'Course ID is required',
      });
    }

    const courseState = await this.aggregationService.getCourseState(studentId, courseId);

    return successResponse(res, {
      message: 'Course state retrieved successfully',
      data: courseState,
    });
  });

  /**
   * Invalidate cache for a student
   * Called by other services (payment, course) when data changes
   * POST /api/students/:studentId/invalidate-cache
   */
  invalidateCache = asyncHandler(async (req: StudentIdRequest, res: Response) => {
    if (!this.aggregationService) {
      return errorResponse(res, {
        statusCode: 501,
        message: 'Aggregation service not available',
      });
    }

    const { studentId } = studentIdParamsSchema.parse(req.params);
    
    // Invalidate both home and learning caches
    await this.aggregationService.invalidateAllCaches(studentId);

    return successResponse(res, {
      message: 'Cache invalidated successfully',
      data: { studentId },
    });
  });

  getProfile = asyncHandler(async (req: StudentIdRequest, res: Response) => {
    const { studentId } = studentIdParamsSchema.parse(req.params);
    const profile = await this.studentService.getProfile(studentId);

    if (!profile) {
      return errorResponse(res, {
        statusCode: 404,
        message: 'Profile not found',
      });
    }

    return successResponse(res, {
      message: 'Student profile fetched successfully',
      data: profile,
    });
  });

  upsertProfile = asyncHandler(async (req: ZodRequest<{ params: typeof studentIdParamsSchema; body: typeof profileBodySchema }>, res: Response) => {
    const { studentId } = studentIdParamsSchema.parse(req.params);
    const body = profileBodySchema.parse(req.body);

    logger.info('PUT profile received', {
      studentId,
      hasFullName: !!body.fullName,
      hasAge: body.age != null,
      hasGender: !!body.gender,
      hasAddress: !!body.address,
      service: 'student-service',
    });

    const profile = await this.studentService.upsertProfile(studentId, body);
    return successResponse(res, {
      message: 'Student profile updated successfully',
      data: profile,
    });
  });

  geocodeProfiles = asyncHandler(async (req: Request, res: Response) => {
    logger.info('Starting geocoding of existing profiles', {
      correlationId: (req as any).correlationId,
      service: 'student-service',
    });

    const result = await this.studentService.geocodeExistingProfiles();

    return successResponse(res, {
      message: 'Profile geocoding completed',
      data: result,
    });
  });

  getProgress = asyncHandler(async (req: StudentIdRequest, res: Response) => {
    const { studentId } = studentIdParamsSchema.parse(req.params);
    const progress = await this.studentService.getProgress(studentId);

    return successResponse(res, {
      message: 'Student progress retrieved successfully',
      data: progress,
    });
  });

  /**
   * @deprecated This endpoint is deprecated. Progress is now read-only and derived from tutoring_sessions via database triggers.
   * Use GET /:studentId/progress to read progress.
   */
  upsertProgress = asyncHandler(async (req: ProgressRequest, res: Response) => {
    return errorResponse(res, {
      statusCode: 410,
      message: 'This endpoint is deprecated. Progress is now read-only and derived from tutoring_sessions.',
      errors: [{ field: 'endpoint', message: 'Progress updates automatically when tutoring sessions are completed. Use GET /:studentId/progress to read progress.' }],
    });
  });

  recordCompletion = asyncHandler(async (req: ProgressRequest & Request, res: Response) => {
    const { studentId, courseId } = progressParamsSchema.parse(req.params);
    const body = recordCompletionBodySchema.parse(req.body);

    const progress = await this.studentService.recordLessonCompletion(studentId, courseId, body);
    return successResponse(res, {
      message: 'Lesson completion recorded successfully',
      data: progress,
    });
  });

  listProjects = asyncHandler(async (req: StudentIdRequest, res: Response) => {
    const { studentId } = studentIdParamsSchema.parse(req.params);
    const submissions = await this.studentService.listProjectSubmissions(studentId);

    return successResponse(res, {
      message: 'Project submissions fetched successfully',
      data: submissions,
    });
  });

  createProject = asyncHandler(async (req: ZodRequest<{ params: typeof studentIdParamsSchema; body: typeof projectCreateSchema }>, res: Response) => {
    const { studentId } = studentIdParamsSchema.parse(req.params);
    const body = projectCreateSchema.parse(req.body);

    const submission = await this.studentService.createProjectSubmission({
      studentId,
      ...body,
    });

    return successResponse(res, {
      statusCode: 201,
      message: 'Project submission created successfully',
      data: submission,
    });
  });

  getProject = asyncHandler(async (req: ZodRequest<{ params: typeof projectParamsSchema }>, res: Response) => {
    const { studentId, projectId } = projectParamsSchema.parse(req.params);

    const submission = await this.studentService.getProjectSubmission(projectId);
    if (!submission || submission.studentId !== studentId) {
      return errorResponse(res, {
        statusCode: 404,
        message: 'Project submission not found',
      });
    }

    return successResponse(res, {
      message: 'Project submission fetched successfully',
      data: submission,
    });
  });

  updateProject = asyncHandler(async (req: ZodRequest<{ params: typeof projectParamsSchema; body: typeof projectUpdateSchema }>, res: Response) => {
    const { studentId, projectId } = projectParamsSchema.parse(req.params);
    const body = projectUpdateSchema.parse(req.body);

    const submission = await this.studentService.updateProjectSubmission(projectId, {
      ...body,
      reviewedAt: body.reviewedAt ? new Date(body.reviewedAt) : null,
    });

    if (!submission || submission.studentId !== studentId) {
      return errorResponse(res, {
        statusCode: 404,
        message: 'Project submission not found',
      });
    }

    return successResponse(res, {
      message: 'Project submission updated successfully',
      data: submission,
    });
  });

  createSupportTicket = asyncHandler(async (req: CreateSupportTicketRequest, res: Response) => {
    const { studentId } = studentIdParamsSchema.parse(req.params);
    const body = supportTicketBodySchema.parse(req.body);

    const ticket = await this.studentService.createSupportTicket({
      studentId,
      issueType: body.issueType,
      subject: body.subject,
      description: body.description,
      email: body.email,
      priority: body.priority,
      metadata: body.metadata ?? null,
    });

    return successResponse(res, {
      statusCode: 201,
      message: 'Support ticket created successfully',
      data: ticket,
    });
  });

  /**
   * GET /api/students/:studentId/claim-deal/check
   * Check if student can claim their deal
   */
  checkCanClaimDeal = asyncHandler(async (req: StudentIdRequest, res: Response) => {
    const { studentId } = studentIdParamsSchema.parse(req.params);
    const result = await this.studentService.canClaimDeal(studentId);

    return successResponse(res, {
      message: result.canClaim ? 'Student can claim deal' : result.reason || 'Student cannot claim deal',
      data: result,
    });
  });

  /**
   * POST /api/students/:studentId/claim-deal
   * Claim deal for student (mark as claimed)
   */
  claimDeal = asyncHandler(async (req: StudentIdRequest, res: Response) => {
    const { studentId } = studentIdParamsSchema.parse(req.params);
    const result = await this.studentService.claimDeal(studentId);

    if (!result.success) {
      return errorResponse(res, {
        statusCode: 400,
        message: result.message,
      });
    }

    return successResponse(res, {
      message: result.message,
      data: { success: true },
    });
  });

  /**
   * GET /api/students/:studentId/referral-code
   * Get referral code for student
   */
  getReferralCode = asyncHandler(async (req: StudentIdRequest, res: Response) => {
    const { studentId } = studentIdParamsSchema.parse(req.params);
    const code = await this.studentService.getReferralCode(studentId);

    return successResponse(res, {
      message: 'Referral code retrieved successfully',
      data: { referralCode: code },
    });
  });

  /**
   * GET /api/students/:studentId/referral-stats
   * Get referral statistics for student
   */
  getReferralStats = asyncHandler(async (req: StudentIdRequest, res: Response) => {
    const { studentId } = studentIdParamsSchema.parse(req.params);
    const stats = await this.studentService.getReferralStats(studentId);

    return successResponse(res, {
      message: 'Referral stats retrieved successfully',
      data: stats,
    });
  });
}

