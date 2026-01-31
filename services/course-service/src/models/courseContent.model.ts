import type { Pool, PoolClient } from 'pg';

export type CourseCycleLevelTier = 'foundation' | 'intermediate' | 'master';

export interface CourseCycleRecord {
  id: string;
  courseId: string;
  title: string;
  description?: string | null;
  sequence: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CourseCycleLevelRecord {
  id: string;
  cycleId: string;
  title: string;
  tier: CourseCycleLevelTier;
  description?: string | null;
  sequence: number;
  totalSessions: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CourseLevelSessionRecord {
  id: string;
  levelId: string;
  sessionOrder: number;
  title: string;
  description: string;
  learningSheetUrl?: string | null;
  expertVideoUrl?: string | null;
  mcqAssessment?: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CourseContentTree {
  courseId: string;
  cycles: Array<{
    id: string;
    title: string;
    description?: string | null;
    sequence: number;
    levels: Array<{
      id: string;
      title: string;
      tier: CourseCycleLevelTier;
      description?: string | null;
      sequence: number;
      totalSessions: number;
      sessions: Array<{
        id: string;
        sessionOrder: number;
        title: string;
        description: string;
        learningSheetUrl?: string | null;
        expertVideoUrl?: string | null;
        mcqAssessment?: Record<string, unknown> | null;
      }>;
    }>;
  }>;
}

export interface CourseContentCycleInput {
  title: string;
  description?: string;
  sequence?: number;
  levels: CourseContentLevelInput[];
}

export interface CourseContentLevelInput {
  title?: string;
  description?: string;
  tier: CourseCycleLevelTier;
  sequence?: number;
  totalSessions?: number;
  sessions: CourseContentSessionInput[];
}

export interface CourseContentSessionInput {
  title: string;
  description: string;
  learningSheetUrl?: string;
  expertVideoUrl?: string;
  sessionOrder?: number;
  mcqAssessment?: CourseContentMCQ;
}

export interface CourseContentMCQ {
  passingScore?: number;
  questions: Array<{
    prompt: string;
    options: string[];
    answerIndex: number;
    explanation?: string;
  }>;
}

export async function createCourseContentTables(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS course_cycles (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
      title VARCHAR(255) NOT NULL,
      description TEXT,
      sequence INTEGER NOT NULL DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_course_cycles_course_id ON course_cycles(course_id);

    CREATE TABLE IF NOT EXISTS course_cycle_levels (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      cycle_id UUID NOT NULL REFERENCES course_cycles(id) ON DELETE CASCADE,
      title VARCHAR(255) NOT NULL,
      tier VARCHAR(20) NOT NULL CHECK (tier IN ('foundation','intermediate','master')),
      description TEXT,
      sequence INTEGER NOT NULL DEFAULT 1,
      total_sessions INTEGER NOT NULL DEFAULT 10,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_cycle_levels_cycle_id ON course_cycle_levels(cycle_id);

    CREATE TABLE IF NOT EXISTS course_level_sessions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      level_id UUID NOT NULL REFERENCES course_cycle_levels(id) ON DELETE CASCADE,
      session_order INTEGER NOT NULL DEFAULT 1,
      title VARCHAR(255) NOT NULL,
      description TEXT NOT NULL,
      learning_sheet_url TEXT,
      expert_video_url TEXT,
      mcq_assessment JSONB,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_level_sessions_level_id ON course_level_sessions(level_id);
  `);
}

export class CourseContentRepository {
  constructor(private readonly pool: Pool) {}

  async deleteCourseContent(courseId: string, client: PoolClient): Promise<void> {
    await client.query('DELETE FROM course_cycles WHERE course_id = $1', [courseId]);
  }

  async insertCycle(
    data: {
      courseId: string;
      title: string;
      description?: string;
      sequence: number;
    },
    client: PoolClient
  ): Promise<CourseCycleRecord> {
    const result = await client.query(
      `
        INSERT INTO course_cycles (course_id, title, description, sequence)
        VALUES ($1, $2, $3, $4)
        RETURNING *
      `,
      [data.courseId, data.title, data.description || null, data.sequence]
    );
    return result.rows[0] as CourseCycleRecord;
  }

  async insertLevel(
    data: {
      cycleId: string;
      title: string;
      tier: CourseCycleLevelTier;
      description?: string;
      sequence: number;
      totalSessions: number;
    },
    client: PoolClient
  ): Promise<CourseCycleLevelRecord> {
    const result = await client.query(
      `
        INSERT INTO course_cycle_levels (cycle_id, title, tier, description, sequence, total_sessions)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING *
      `,
      [data.cycleId, data.title, data.tier, data.description || null, data.sequence, data.totalSessions]
    );
    return result.rows[0] as CourseCycleLevelRecord;
  }

  async insertSession(
    data: {
      levelId: string;
      sessionOrder: number;
      title: string;
      description: string;
      learningSheetUrl?: string;
      expertVideoUrl?: string;
      mcqAssessment?: CourseContentMCQ;
    },
    client: PoolClient
  ): Promise<CourseLevelSessionRecord> {
    const result = await client.query(
      `
        INSERT INTO course_level_sessions (
          level_id,
          session_order,
          title,
          description,
          learning_sheet_url,
          expert_video_url,
          mcq_assessment
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING *
      `,
      [
        data.levelId,
        data.sessionOrder,
        data.title,
        data.description,
        data.learningSheetUrl || null,
        data.expertVideoUrl || null,
        data.mcqAssessment ? JSON.stringify(data.mcqAssessment) : null,
      ]
    );
    return result.rows[0] as CourseLevelSessionRecord;
  }

  async getCourseContent(courseId: string): Promise<CourseContentTree> {
    const { rows } = await this.pool.query(
      `
        SELECT
          cc.id AS cycle_id,
          cc.title AS cycle_title,
          cc.description AS cycle_description,
          cc.sequence AS cycle_sequence,
          cl.id AS level_id,
          cl.title AS level_title,
          cl.tier AS level_tier,
          cl.description AS level_description,
          cl.sequence AS level_sequence,
          cl.total_sessions AS level_total_sessions,
          cls.id AS session_id,
          cls.session_order,
          cls.title AS session_title,
          cls.description AS session_description,
          cls.learning_sheet_url,
          cls.expert_video_url,
          cls.mcq_assessment
        FROM course_cycles cc
        LEFT JOIN course_cycle_levels cl ON cl.cycle_id = cc.id
        LEFT JOIN course_level_sessions cls ON cls.level_id = cl.id
        WHERE cc.course_id = $1
        ORDER BY cc.sequence ASC, cl.sequence ASC, cls.session_order ASC
      `,
      [courseId]
    );

    const cyclesMap = new Map<string, CourseContentTree['cycles'][number]>();

    for (const row of rows) {
      if (!cyclesMap.has(row.cycle_id)) {
        cyclesMap.set(row.cycle_id, {
          id: row.cycle_id,
          title: row.cycle_title,
          description: row.cycle_description,
          sequence: row.cycle_sequence,
          levels: [],
        });
      }

      const cycle = cyclesMap.get(row.cycle_id)!;

      if (row.level_id) {
        let level = cycle.levels.find((lvl) => lvl.id === row.level_id);
        if (!level) {
          level = {
            id: row.level_id,
            title: row.level_title,
            tier: row.level_tier,
            description: row.level_description,
            sequence: row.level_sequence,
            totalSessions: row.level_total_sessions,
            sessions: [],
          };
          cycle.levels.push(level);
        }

        if (row.session_id) {
          level.sessions.push({
            id: row.session_id,
            sessionOrder: row.session_order,
            title: row.session_title,
            description: row.session_description,
            learningSheetUrl: row.learning_sheet_url,
            expertVideoUrl: row.expert_video_url,
            mcqAssessment: row.mcq_assessment ? (typeof row.mcq_assessment === 'string' ? JSON.parse(row.mcq_assessment) : row.mcq_assessment) : null,
          });
        }
      }
    }

    return {
      courseId,
      cycles: Array.from(cyclesMap.values()),
    };
  }
}


