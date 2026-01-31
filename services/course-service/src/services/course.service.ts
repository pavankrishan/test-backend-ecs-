/**
 * Course Service - Business Logic Layer
 */

import {
  CourseRepository,
  Course,
  CourseCreateInput,
  CourseUpdateInput,
  CourseFilters,
} from '../models/course.model';
import { CourseVideo, ICourseVideo } from '../models/courseVideo.model';
import { PDFMaterial, IPDFMaterial } from '../models/pdfMaterial.model';
import { AssignmentRepository } from '../models/assignment.model';
import { getRedis } from '../config/database';
import logger from '@kodingcaravan/shared/config/logger';
import { redisGetWithTimeout, redisSetexWithTimeout, redisDelWithTimeout } from '@kodingcaravan/shared/utils/redisWithTimeout';

export class CourseService {
  constructor(
    private courseRepo: CourseRepository,
    private assignmentRepo: AssignmentRepository
  ) {}

  /**
   * Create a new course
   */
  async createCourse(data: CourseCreateInput): Promise<Course> {
    const course = await this.courseRepo.create(data);

    // Clear cache
    await this.clearCourseCache(course.id);

    return course;
  }

  /**
   * Get course by ID with caching
   */
  async getCourseById(id: string, includeContent = false): Promise<Course | null> {
    const cacheKey = `course:${id}`;

    // Try cache first (with timeout - fails open)
    const cached = await redisGetWithTimeout(cacheKey, 1000);
    if (cached) {
      return JSON.parse(cached);
    }

    const course = await this.courseRepo.findById(id);
    if (!course) {
      return null;
    }

    // Cache for 1 hour (with timeout - fails silently)
    await redisSetexWithTimeout(cacheKey, 3600, JSON.stringify(course), 2000);

    // Include content if requested
    if (includeContent) {
      // This would fetch videos, materials, etc.
      // For now, just return course
    }

    return course;
  }

  /**
   * Get courses with filters and pagination
   */
  async getCourses(filters: CourseFilters = {}): Promise<{
    courses: Course[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    // Only cache for published, active courses
    const shouldCache = filters.status === 'published' && filters.isActive !== false;

    if (shouldCache) {
      const cacheKey = `courses:${JSON.stringify(filters)}`;
      const cached = await redisGetWithTimeout(cacheKey, 1000);
      if (cached) {
        return JSON.parse(cached);
      }
    }

    const result = await this.courseRepo.findMany(filters);
    const page = filters.page || 1;
    const limit = filters.limit || 20;
    const totalPages = Math.ceil(result.total / limit);

    const response = {
      courses: result.courses,
      total: result.total,
      page,
      limit,
      totalPages,
    };

    // Cache for 5 minutes (with timeout - fails silently)
    if (shouldCache) {
      const cacheKey = `courses:${JSON.stringify(filters)}`;
      await redisSetexWithTimeout(cacheKey, 300, JSON.stringify(response), 2000);
    }

    return response;
  }

  /**
   * Update course
   */
  async updateCourse(id: string, data: CourseUpdateInput): Promise<Course | null> {
    const existing = await this.courseRepo.findById(id);
    if (!existing) {
      throw new Error('Course not found');
    }

    const updated = await this.courseRepo.update(id, data);

    // Clear cache
    if (updated) {
      await this.clearCourseCache(id);
    }

    return updated;
  }

  /**
   * Delete course
   */
  async deleteCourse(id: string): Promise<boolean> {
    const existing = await this.courseRepo.findById(id);
    if (!existing) {
      throw new Error('Course not found');
    }

    const deleted = await this.courseRepo.delete(id);

    if (deleted) {
      await this.clearCourseCache(id);
    }

    return deleted;
  }

  /**
   * Get course videos
   * Updated to fetch from new course structure (sessions)
   */
  async getCourseVideos(courseId: string): Promise<ICourseVideo[]> {
    const cacheKey = `course:${courseId}:videos`;

    const cached = await redisGetWithTimeout(cacheKey, 1000);
    if (cached) {
      return JSON.parse(cached);
    }

    // Try new course structure first (sessions)
    try {
      const { CourseStructureRepository } = await import('../models/courseStructure.model');
      const { getPostgresPool } = await import('../config/database');
      const pool = getPostgresPool();
      const structureRepo = new CourseStructureRepository(pool);
      
      // Get all sessions for this course
      const phases = await structureRepo.getPhasesByCourseId(courseId);
      const videos: ICourseVideo[] = [];
      
      // If no phases exist, return empty array (course might not have new structure yet)
      if (!phases || phases.length === 0) {
        // Fallback to old MongoDB structure
        const videos = await CourseVideo.find({ courseId }).sort({ order: 1 }).exec();
        await redisSetexWithTimeout(cacheKey, 3600, JSON.stringify(videos), 2000);
        return videos;
      }
      
      for (const phase of phases) {
        const levels = await structureRepo.getLevelsByPhaseId(phase.id);
        for (const level of levels) {
          const sessions = await structureRepo.getSessionsByLevelId(level.id);
          for (const session of sessions) {
            if (session.expertVideoS3Key) {
              videos.push({
                _id: session.id,
                courseId: courseId,
                moduleNumber: phase.sequence,
                moduleTitle: phase.title,
                lessonNumber: session.sessionNumber,
                lessonTitle: session.title,
                videoUrl: session.expertVideoS3Key, // Using S3 key - URL generation should happen in controller
                videoDuration: null,
                thumbnailUrl: null,
                description: session.description || undefined,
                isPreview: false,
                order: (phase.sequence - 1) * 30 + (level.sequence - 1) * 10 + session.sessionNumber,
                createdAt: session.createdAt,
                updatedAt: session.updatedAt,
              } as unknown as ICourseVideo);
            }
          }
        }
      }
      
      // Sort by order
      videos.sort((a, b) => a.order - b.order);
      
      // Cache for 1 hour (with timeout - fails silently)
      await redisSetexWithTimeout(cacheKey, 3600, JSON.stringify(videos), 2000);
      
      return videos;
    } catch (error: any) {
      // Fallback to old MongoDB structure if new structure fails
      logger.warn('Failed to fetch videos from new structure, falling back to MongoDB', {
        error: error?.message || String(error),
        courseId,
        service: 'course-service',
      });
      try {
        const videos = await CourseVideo.find({ courseId }).sort({ order: 1 }).exec();
        await redisSetexWithTimeout(cacheKey, 3600, JSON.stringify(videos), 2000);
        return videos;
      } catch (mongoError: any) {
        // If MongoDB also fails, return empty array
        logger.error('Both new structure and MongoDB failed', {
          error: mongoError?.message || String(mongoError),
          stack: mongoError?.stack,
          courseId,
          service: 'course-service',
        });
        return [];
      }
    }
  }

  /**
   * Add video to course
   */
  async addCourseVideo(data: {
    courseId: string;
    moduleNumber: number;
    moduleTitle: string;
    lessonNumber: number;
    lessonTitle: string;
    videoUrl: string;
    videoDuration?: number;
    thumbnailUrl?: string;
    description?: string;
    isPreview?: boolean;
    order: number;
  }): Promise<ICourseVideo> {
    const video = new CourseVideo(data);
    await video.save();

    // Clear cache
    await this.clearCourseCache(data.courseId);

    // Update course total lessons
    const course = await this.courseRepo.findById(data.courseId);
    if (course) {
      // Note: totalLessons is not in CourseUpdateInput, so we skip this update
      // The total lessons count should be calculated dynamically from the course structure
    }

    return video;
  }

  /**
   * Get course PDF materials
   * Updated to fetch from new course structure (sessions)
   */
  async getCourseMaterials(courseId: string): Promise<IPDFMaterial[]> {
    const cacheKey = `course:${courseId}:materials`;

    const cached = await redisGetWithTimeout(cacheKey, 1000);
    if (cached) {
      return JSON.parse(cached);
    }

    // Try new course structure first (sessions)
    try {
      const { CourseStructureRepository } = await import('../models/courseStructure.model');
      const { getPostgresPool } = await import('../config/database');
      const pool = getPostgresPool();
      const structureRepo = new CourseStructureRepository(pool);
      
      // Get all sessions for this course
      const phases = await structureRepo.getPhasesByCourseId(courseId);
      const materials: IPDFMaterial[] = [];
      
      for (const phase of phases) {
        const levels = await structureRepo.getLevelsByPhaseId(phase.id);
        for (const level of levels) {
          const sessions = await structureRepo.getSessionsByLevelId(level.id);
          for (const session of sessions) {
            if (session.learningSheetPdfS3Key) {
              materials.push({
                _id: session.id,
                courseId: courseId,
                moduleNumber: phase.sequence,
                moduleTitle: phase.title,
                lessonNumber: session.sessionNumber,
                lessonTitle: session.title,
                pdfUrl: session.learningSheetPdfS3Key, // Using S3 key - URL generation should happen in controller
                description: session.description || undefined,
                order: (phase.sequence - 1) * 30 + (level.sequence - 1) * 10 + session.sessionNumber,
                createdAt: session.createdAt,
                updatedAt: session.updatedAt,
              } as unknown as IPDFMaterial);
            }
          }
        }
      }
      
      // Sort by order
      materials.sort((a, b) => a.order - b.order);
      
      // Cache for 1 hour (with timeout - fails silently)
      await redisSetexWithTimeout(cacheKey, 3600, JSON.stringify(materials), 2000);
      
      return materials;
    } catch (error) {
      // Fallback to old MongoDB structure if new structure fails
      logger.warn('Failed to fetch materials from new structure, falling back to MongoDB', {
        error: error instanceof Error ? error.message : String(error),
        courseId,
        service: 'course-service',
      });
      const materials = await PDFMaterial.find({ courseId }).sort({ order: 1 }).exec();
      await redisSetexWithTimeout(cacheKey, 3600, JSON.stringify(materials), 2000);
      return materials;
    }
  }

  /**
   * Add PDF material to course
   */
  async addCourseMaterial(data: {
    courseId: string;
    title: string;
    description?: string;
    fileUrl: string;
    fileSize?: number;
    pageCount?: number;
    category?: 'notes' | 'handout' | 'reference' | 'exercise';
    order: number;
    isDownloadable?: boolean;
  }): Promise<IPDFMaterial> {
    const material = new PDFMaterial(data);
    await material.save();

    // Clear cache
    await this.clearCourseCache(data.courseId);

    return material;
  }

  /**
   * Get course assignments
   */
  async getCourseAssignments(courseId: string) {
    return this.assignmentRepo.findByCourseId(courseId);
  }

  /**
   * Clear course-related cache
   */
  private async clearCourseCache(courseId: string): Promise<void> {
    const keys = [
      `course:${courseId}`,
      `course:${courseId}:videos`,
      `course:${courseId}:materials`,
    ];

    // Also clear course list caches (pattern matching)
    // Note: scanStream doesn't have timeout wrapper, but it's non-critical
    // If Redis is slow, cache invalidation can be delayed
    try {
      const redis = getRedis();
      const pattern = 'courses:*';
      const stream = redis.scanStream({ match: pattern, count: 100 });
      
      for await (const streamKeys of stream) {
        if (streamKeys.length > 0) {
          await redisDelWithTimeout(streamKeys, 2000);
        }
      }
    } catch (error) {
      logger.warn('Failed to clear course list caches (non-critical)', {
        error: error instanceof Error ? error.message : String(error),
        courseId,
        service: 'course-service',
      });
    }

    // Clear specific course caches (with timeout - fails silently)
    await redisDelWithTimeout(keys, 2000);
  }

  /**
   * Increment student count (when student enrolls)
   */
  async incrementStudentCount(courseId: string): Promise<void> {
    await this.courseRepo.incrementStudents(courseId);
    await this.clearCourseCache(courseId);
  }

  /**
   * Update course rating
   */
  async updateRating(courseId: string, newRating: number, totalRatings: number): Promise<void> {
    await this.courseRepo.updateRating(courseId, newRating, totalRatings);
    await this.clearCourseCache(courseId);
  }
}

