/**
 * Course Controller - HTTP Request Handlers
 */

import { Request, Response } from 'express';
import { CourseService } from '../services/course.service';
import { successResponse, errorResponse } from '@kodingcaravan/shared/utils/responseBuilder';
import { CourseCreateInput, CourseUpdateInput, CourseFilters } from '../models/course.model';

export class CourseController {
  constructor(private courseService: CourseService) {}

  /**
   * POST /api/courses
   * Create a new course
   */
  createCourse = async (req: Request, res: Response) => {
    try {
      const data: CourseCreateInput = req.body;
      const course = await this.courseService.createCourse(data);
      return successResponse(res, {
        statusCode: 201,
        message: 'Course created successfully',
        data: course,
      });
    } catch (error: any) {
      return errorResponse(res, {
        statusCode: error.statusCode || 500,
        message: error.message || 'Failed to create course',
      });
    }
  };

  /**
   * GET /api/courses/:id
   * Get course by ID
   */
  getCourseById = async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      if (!id) {
        return errorResponse(res, { statusCode: 400, message: 'Course ID is required' });
      }
      const includeContent = req.query.includeContent === 'true';

      const course = await this.courseService.getCourseById(id, includeContent);
      if (!course) {
        return errorResponse(res, { statusCode: 404, message: 'Course not found' });
      }

      return successResponse(res, {
        message: 'Course retrieved successfully',
        data: course,
      });
    } catch (error: any) {
      return errorResponse(res, {
        statusCode: 500,
        message: error.message || 'Failed to retrieve course',
      });
    }
  };

  /**
   * GET /api/courses
   * Get courses with filters
   */
  getCourses = async (req: Request, res: Response) => {
    try {
      const filters: CourseFilters = {
        ...(req.query.category && { category: req.query.category as string }),
        ...(req.query.subcategory && { subcategory: req.query.subcategory as string }),
        ...(req.query.level && { level: req.query.level as string }),
        ...(req.query.minPrice && { minPrice: parseFloat(req.query.minPrice as string) }),
        ...(req.query.maxPrice && { maxPrice: parseFloat(req.query.maxPrice as string) }),
        ...(req.query.trainerId && { trainerId: req.query.trainerId as string }),
        ...(req.query.status && { status: req.query.status as string }),
        ...(req.query.isActive !== undefined && {
          isActive: req.query.isActive === 'true' ? true : req.query.isActive === 'false' ? false : undefined,
        }),
        ...(req.query.language && { language: req.query.language as string }),
        ...(req.query.tags && { tags: (req.query.tags as string).split(',') }),
        ...(req.query.search && { search: req.query.search as string }),
        ...(req.query.sortBy && { sortBy: req.query.sortBy as any }),
        ...(req.query.sortOrder && { sortOrder: req.query.sortOrder as any }),
        page: req.query.page ? parseInt(req.query.page as string) : 1,
        limit: req.query.limit ? parseInt(req.query.limit as string) : 20,
      };

      const result = await this.courseService.getCourses(filters);
      return successResponse(res, {
        message: 'Courses retrieved successfully',
        data: result,
      });
    } catch (error: any) {
      return errorResponse(res, {
        statusCode: 500,
        message: error.message || 'Failed to retrieve courses',
      });
    }
  };

  /**
   * PUT /api/courses/:id
   * Update course
   */
  updateCourse = async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      if (!id) {
        return errorResponse(res, { statusCode: 400, message: 'Course ID is required' });
      }
      const data: CourseUpdateInput = req.body;
      const course = await this.courseService.updateCourse(id, data);

      if (!course) {
        return errorResponse(res, { statusCode: 404, message: 'Course not found' });
      }

      return successResponse(res, {
        message: 'Course updated successfully',
        data: course,
      });
    } catch (error: any) {
      return errorResponse(res, {
        statusCode: error.statusCode || 500,
        message: error.message || 'Failed to update course',
      });
    }
  };

  /**
   * DELETE /api/courses/:id
   * Delete course
   */
  deleteCourse = async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      if (!id) {
        return errorResponse(res, { statusCode: 400, message: 'Course ID is required' });
      }
      const deleted = await this.courseService.deleteCourse(id);
      if (!deleted) {
        return errorResponse(res, { statusCode: 404, message: 'Course not found' });
      }

      return successResponse(res, {
        message: 'Course deleted successfully',
      });
    } catch (error: any) {
      return errorResponse(res, {
        statusCode: error.statusCode || 500,
        message: error.message || 'Failed to delete course',
      });
    }
  };

  /**
   * GET /api/courses/:id/videos
   * Get course videos
   */
  getCourseVideos = async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      if (!id) {
        return errorResponse(res, { statusCode: 400, message: 'Course ID is required' });
      }
      const videos = await this.courseService.getCourseVideos(id);
      return successResponse(res, {
        message: 'Course videos retrieved successfully',
        data: videos,
      });
    } catch (error: any) {
      return errorResponse(res, {
        statusCode: 500,
        message: error.message || 'Failed to retrieve course videos',
      });
    }
  };

  /**
   * GET /api/courses/:id/materials
   * Get course materials
   */
  getCourseMaterials = async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      if (!id) {
        return errorResponse(res, { statusCode: 400, message: 'Course ID is required' });
      }
      const materials = await this.courseService.getCourseMaterials(id);
      return successResponse(res, {
        message: 'Course materials retrieved successfully',
        data: materials,
      });
    } catch (error: any) {
      return errorResponse(res, {
        statusCode: 500,
        message: error.message || 'Failed to retrieve course materials',
      });
    }
  };

  /**
   * GET /api/courses/:id/assignments
   * Get course assignments
   */
  getCourseAssignments = async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      if (!id) {
        return errorResponse(res, { statusCode: 400, message: 'Course ID is required' });
      }
      const assignments = await this.courseService.getCourseAssignments(id);
      return successResponse(res, {
        message: 'Course assignments retrieved successfully',
        data: assignments,
      });
    } catch (error: any) {
      return errorResponse(res, {
        statusCode: 500,
        message: error.message || 'Failed to retrieve course assignments',
      });
    }
  };
}

