import { Request, Response } from 'express';
import { successResponse, errorResponse } from '@kodingcaravan/shared/utils/responseBuilder';
import { z } from 'zod';
import { CourseContentService } from '../services/courseContent.service';

const mcqSchema = z.object({
  passingScore: z.number().int().min(0).max(100).optional(),
  questions: z
    .array(
      z.object({
        prompt: z.string().min(3),
        options: z.array(z.string().min(1)).min(2),
        answerIndex: z.number().int().min(0),
        explanation: z.string().optional(),
      })
    )
    .min(1),
});

const sessionSchema = z.object({
  title: z.string().min(3),
  description: z.string().min(10),
  learningSheetUrl: z.string().url().optional(),
  expertVideoUrl: z.string().url().optional(),
  sessionOrder: z.number().int().positive().optional(),
  mcqAssessment: mcqSchema.optional(),
});

const levelSchema = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  tier: z.enum(['foundation', 'intermediate', 'master']),
  sequence: z.number().int().positive().optional(),
  totalSessions: z.number().int().positive().optional(),
  sessions: z.array(sessionSchema).min(1),
});

const cycleSchema = z.object({
  title: z.string().min(3),
  description: z.string().optional(),
  sequence: z.number().int().positive().optional(),
  levels: z.array(levelSchema).min(1),
});

const upsertSchema = z.object({
  cycles: z.array(cycleSchema).min(1),
});

export class CourseContentController {
  constructor(private readonly service: CourseContentService) {}

  upsertCourseContent = async (req: Request, res: Response) => {
    try {
      const { cycles } = upsertSchema.parse(req.body);
      const { courseId } = req.params;

      const content = await this.service.upsertCourseContent(courseId, cycles);

      return successResponse(res, {
        statusCode: 201,
        message: 'Course content saved successfully',
        data: content,
      });
    } catch (error: any) {
      return errorResponse(res, {
        statusCode: error.statusCode || 400,
        message: error.message || 'Failed to save course content',
        errors: error.errors,
      });
    }
  };

  getCourseContent = async (req: Request, res: Response) => {
    try {
      const { courseId } = req.params;
      const content = await this.service.getCourseContent(courseId);

      return successResponse(res, {
        message: 'Course content retrieved',
        data: content,
      });
    } catch (error: any) {
      return errorResponse(res, {
        statusCode: error.statusCode || 500,
        message: error.message || 'Failed to fetch course content',
      });
    }
  };
}

