/**
 * Video Controller - HTTP Request Handlers for Course Videos
 */

import { Request, Response } from 'express';
import { VideoService } from '../services/video.service';
import { successResponse, errorResponse } from '@kodingcaravan/shared/utils/responseBuilder';

export class VideoController {
  constructor(private videoService: VideoService) {}

  /**
   * GET /api/videos/course/:courseId
   * Get all videos for a course
   */
  getCourseVideos = async (req: Request, res: Response) => {
    try {
      const { courseId } = req.params;
      if (!courseId) {
        return errorResponse(res, { statusCode: 400, message: 'Course ID is required' });
      }
      const videos = await this.videoService.getCourseVideos(courseId);
      return successResponse(res, {
        message: 'Videos retrieved successfully',
        data: videos,
      });
    } catch (error: any) {
      return errorResponse(res, {
        statusCode: 500,
        message: error.message || 'Failed to retrieve videos',
      });
    }
  };

  /**
   * GET /api/videos/:id
   * Get video by ID
   */
  getVideoById = async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      if (!id) {
        return errorResponse(res, { statusCode: 400, message: 'Video ID is required' });
      }
      const video = await this.videoService.getVideoById(id);
      if (!video) {
        return errorResponse(res, { statusCode: 404, message: 'Video not found' });
      }
      return successResponse(res, {
        message: 'Video retrieved successfully',
        data: video,
      });
    } catch (error: any) {
      return errorResponse(res, {
        statusCode: 500,
        message: error.message || 'Failed to retrieve video',
      });
    }
  };

  /**
   * POST /api/videos
   * Add video to course
   */
  addVideo = async (req: Request, res: Response) => {
    try {
      const video = await this.videoService.addVideo(req.body);
      return successResponse(res, {
        statusCode: 201,
        message: 'Video added successfully',
        data: video,
      });
    } catch (error: any) {
      return errorResponse(res, {
        statusCode: 500,
        message: error.message || 'Failed to add video',
      });
    }
  };

  /**
   * PUT /api/videos/:id
   * Update video
   */
  updateVideo = async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      if (!id) {
        return errorResponse(res, { statusCode: 400, message: 'Video ID is required' });
      }
      const video = await this.videoService.updateVideo(id, req.body);
      if (!video) {
        return errorResponse(res, { statusCode: 404, message: 'Video not found' });
      }
      return successResponse(res, {
        message: 'Video updated successfully',
        data: video,
      });
    } catch (error: any) {
      return errorResponse(res, {
        statusCode: 500,
        message: error.message || 'Failed to update video',
      });
    }
  };

  /**
   * DELETE /api/videos/:id
   * Delete video
   */
  deleteVideo = async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      if (!id) {
        return errorResponse(res, { statusCode: 400, message: 'Video ID is required' });
      }
      const deleted = await this.videoService.deleteVideo(id);
      if (!deleted) {
        return errorResponse(res, { statusCode: 404, message: 'Video not found' });
      }
      return successResponse(res, {
        message: 'Video deleted successfully',
      });
    } catch (error: any) {
      return errorResponse(res, {
        statusCode: 500,
        message: error.message || 'Failed to delete video',
      });
    }
  };

  /**
   * GET /api/videos/course/:courseId/preview
   * Get preview videos for a course
   */
  getPreviewVideos = async (req: Request, res: Response) => {
    try {
      const { courseId } = req.params;
      if (!courseId) {
        return errorResponse(res, { statusCode: 400, message: 'Course ID is required' });
      }
      const videos = await this.videoService.getPreviewVideos(courseId);
      return successResponse(res, {
        message: 'Preview videos retrieved successfully',
        data: videos,
      });
    } catch (error: any) {
      return errorResponse(res, {
        statusCode: 500,
        message: error.message || 'Failed to retrieve preview videos',
      });
    }
  };
}

