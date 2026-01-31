/**
 * Video Service - Business Logic for Course Videos
 */

import { CourseVideo, ICourseVideo } from '../models/courseVideo.model';
import { getRedis } from '../config/database';

export class VideoService {
  async getCourseVideos(courseId: string): Promise<ICourseVideo[]> {
    const redis = getRedis();
    const cacheKey = `course:${courseId}:videos`;

    const cached = await redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }

    const videos = await CourseVideo.find({ courseId }).sort({ order: 1 }).exec();

    // Cache for 1 hour
    await redis.setex(cacheKey, 3600, JSON.stringify(videos));

    return videos;
  }

  async getVideoById(videoId: string): Promise<ICourseVideo | null> {
    return CourseVideo.findById(videoId).exec();
  }

  async addVideo(data: {
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
    resources?: Array<{
      type: 'pdf' | 'link' | 'code';
      title: string;
      url: string;
    }>;
  }): Promise<ICourseVideo> {
    const video = new CourseVideo(data);
    await video.save();

    // Clear cache
    const redis = getRedis();
    await redis.del(`course:${data.courseId}:videos`);

    return video;
  }

  async updateVideo(
    videoId: string,
    updates: Partial<ICourseVideo>
  ): Promise<ICourseVideo | null> {
    const video = await CourseVideo.findByIdAndUpdate(videoId, updates, { new: true }).exec();

    if (video) {
      // Clear cache
      const redis = getRedis();
      await redis.del(`course:${video.courseId}:videos`);
    }

    return video;
  }

  async deleteVideo(videoId: string): Promise<boolean> {
    const video = await CourseVideo.findById(videoId).exec();
    if (!video) {
      return false;
    }

    await CourseVideo.findByIdAndDelete(videoId).exec();

    // Clear cache
    const redis = getRedis();
    await redis.del(`course:${video.courseId}:videos`);

    return true;
  }

  async getPreviewVideos(courseId: string): Promise<ICourseVideo[]> {
    return CourseVideo.find({ courseId, isPreview: true })
      .sort({ order: 1 })
      .limit(3)
      .exec();
  }
}

