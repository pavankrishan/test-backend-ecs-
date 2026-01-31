import type { Pool, PoolClient } from 'pg';
import { AppError } from '@kodingcaravan/shared';
import {
  CourseContentCycleInput,
  CourseContentRepository,
  type CourseContentTree,
} from '../models/courseContent.model';

export class CourseContentService {
  constructor(private readonly repository: CourseContentRepository, private readonly pool: Pool) {}

  async upsertCourseContent(courseId: string, cycles: CourseContentCycleInput[]): Promise<CourseContentTree> {
    if (!cycles.length) {
      throw new AppError('At least one cycle is required', 400);
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      await this.repository.deleteCourseContent(courseId, client);

      for (const [cycleIndex, cycle] of cycles.entries()) {
        const cycleRecord = await this.repository.insertCycle(
          {
            courseId,
            title: cycle.title,
            description: cycle.description,
            sequence: cycle.sequence ?? cycleIndex + 1,
          },
          client
        );

        for (const [levelIndex, level] of cycle.levels.entries()) {
          const levelRecord = await this.repository.insertLevel(
            {
              cycleId: cycleRecord.id,
              title: level.title || `${level.tier.toUpperCase()} Level`,
              tier: level.tier,
              description: level.description,
              sequence: level.sequence ?? levelIndex + 1,
              totalSessions: level.totalSessions ?? level.sessions.length,
            },
            client
          );

          for (const [sessionIndex, session] of level.sessions.entries()) {
            await this.repository.insertSession(
              {
                levelId: levelRecord.id,
                sessionOrder: session.sessionOrder ?? sessionIndex + 1,
                title: session.title,
                description: session.description,
                learningSheetUrl: session.learningSheetUrl,
                expertVideoUrl: session.expertVideoUrl,
                mcqAssessment: session.mcqAssessment,
              },
              client
            );
          }
        }
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    return this.repository.getCourseContent(courseId);
  }

  async getCourseContent(courseId: string): Promise<CourseContentTree> {
    return this.repository.getCourseContent(courseId);
  }
}


