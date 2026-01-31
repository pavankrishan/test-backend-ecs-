/**
 * Course Structure Model - Comprehensive EdTech System
 * 
 * Structure: Course → Phase → Level → Session
 * - Courses: Scalable (currently 5, must scale infinitely)
 * - Phases: Scalable per course (currently 3, must scale)
 * - Levels: Fixed 3 per phase (Foundation, Development, Mastery)
 * - Sessions: Fixed 10 per level (30 per phase)
 * 
 * Optimized for 10K-1M users with proper indexing
 */

import type { Pool, PoolClient } from 'pg';

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

export type LevelType = 'foundation' | 'development' | 'mastery';
export type ProjectVisibility = 'private' | 'community' | 'public';
export type SessionPurchaseTier = 10 | 20 | 30;
export type ProjectStatus = 'pending' | 'approved' | 'rejected' | 'revision_required';
export type ProgressStatus = 'not_started' | 'in_progress' | 'completed' | 'locked';

export interface CoursePhase {
  id: string;
  courseId: string;
  title: string;
  description?: string | null;
  sequence: number; // Order within course
  createdAt: Date;
  updatedAt: Date;
}

export interface CourseLevel {
  id: string;
  phaseId: string;
  levelType: LevelType; // foundation, development, mastery
  title: string;
  description?: string | null;
  sequence: number; // 1, 2, or 3 within phase
  totalSessions: number; // Always 10
  createdAt: Date;
  updatedAt: Date;
}

export interface CourseSession {
  id: string;
  levelId: string;
  sessionNumber: number; // 1-10 within level
  title: string;
  description: string;
  
  // Content S3 keys (not public URLs - backend generates signed URLs)
  expertVideoS3Key?: string | null;
  learningSheetPdfS3Key?: string | null;
  
  // Quiz reference (quizzes stored separately in MongoDB)
  quizId?: string | null; // References Quiz._id in MongoDB
  
  // Additional content
  coreActivity?: string | null;
  keyConcepts?: string[] | null;
  
  createdAt: Date;
  updatedAt: Date;
}

export interface StudentCoursePurchase {
  id: string;
  studentId: string;
  courseId: string;
  purchaseTier: SessionPurchaseTier; // 10, 20, or 30 sessions
  purchaseDate: Date;
  expiryDate?: Date | null;
  metadata?: Record<string, unknown> | null; // All payment details: sessionCount, timeSlot, classType, learningMode, etc.
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface StudentProgress {
  id: string;
  studentId: string;
  courseId: string;
  phaseId: string;
  levelId: string;
  sessionId: string;
  
  // Progress tracking
  status: ProgressStatus;
  videoWatched: boolean;
  videoWatchedAt?: Date | null;
  sheetPreviewed: boolean; // Changed from sheetDownloaded - sheets are preview-only, not downloadable
  sheetPreviewedAt?: Date | null;
  quizCompleted: boolean;
  quizScore?: number | null;
  quizMaxScore?: number | null;
  quizCompletedAt?: Date | null;
  
  // Access control
  isUnlocked: boolean;
  unlockedAt?: Date | null;
  
  createdAt: Date;
  updatedAt: Date;
}

export interface StudentProject {
  id: string;
  studentId: string;
  courseId: string;
  phaseId: string;
  levelId: string;
  levelType: LevelType;
  
  // Project content
  projectVideoUrl: string;
  projectPdfUrl: string;
  title: string;
  description?: string | null;
  
  // Visibility rules
  visibility: ProjectVisibility; // private, community, public
  
  // Status and review
  status: ProjectStatus;
  trainerId?: string | null; // Assigned trainer for review
  trainerFeedback?: string | null;
  trainerRating?: number | null; // 1-5 stars
  reviewedAt?: Date | null;
  
  submittedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface ExamAttempt {
  id: string;
  studentId: string;
  levelId: string;
  attemptNumber: number; // 1, 2, or 3
  score: number;
  maxScore: number;
  percentage: number;
  answers: Array<{ questionId: string; selectedAnswerIndex: number }>;
  certificateType?: 'normal' | 'excellence' | null;
  completedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

// ============================================================================
// INPUT TYPES
// ============================================================================

export interface CreatePhaseInput {
  courseId: string;
  title: string;
  description?: string;
  sequence: number;
}

export interface CreateLevelInput {
  phaseId: string;
  levelType: LevelType;
  title: string;
  description?: string;
  sequence: number; // 1, 2, or 3
}

export interface CreateSessionInput {
  levelId: string;
  sessionNumber: number; // 1-10
  title: string;
  description: string;
  expertVideoS3Key?: string; // S3 object key, not public URL
  learningSheetPdfS3Key?: string; // S3 object key, not public URL
  quizId?: string; // Optional quiz ID from MongoDB (quiz created separately)
  coreActivity?: string;
  keyConcepts?: string[];
}

export interface CreatePurchaseInput {
  studentId: string;
  courseId: string;
  purchaseTier: SessionPurchaseTier;
  expiryDate?: Date;
  metadata?: Record<string, unknown>; // Store all payment details (timeSlot, classType, learningMode, etc.)
}

export interface UpdateProgressInput {
  videoWatched?: boolean;
  sheetPreviewed?: boolean; // Changed from sheetDownloaded - sheets are preview-only
  quizCompleted?: boolean;
  quizScore?: number;
  quizMaxScore?: number;
}

// ============================================================================
// DATABASE SCHEMA CREATION
// ============================================================================

export async function createCourseStructureTables(pool: Pool): Promise<void> {
  // Use advisory lock to prevent concurrent initialization
  // Lock ID: 1234567890 (arbitrary unique number for course structure initialization)
  const lockId = 1234567890;
  let lockClient: PoolClient | null = null;
  let hasLock = false;
  
  try {
    // Try to acquire advisory lock (non-blocking)
    lockClient = await pool.connect();
    const lockResult = await lockClient.query('SELECT pg_try_advisory_lock($1) as locked', [lockId]);
    hasLock = lockResult.rows[0]?.locked === true;
    
    if (!hasLock) {
      // Another process is initializing, wait and check if tables exist
      await lockClient.release();
      lockClient = null;
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      // Check if tables already exist (another process may have created them)
      const checkResult = await pool.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_name = 'course_phases'
        ) as exists
      `);
      
      if (checkResult.rows[0]?.exists) {
        // Tables already exist, initialization complete
        return;
      }
      
      // Tables don't exist yet, try one more time with blocking lock
      lockClient = await pool.connect();
      try {
        // Wait up to 5 seconds for lock
        await lockClient.query('SELECT pg_advisory_lock($1)', [lockId]);
        hasLock = true;
      } catch (err) {
        await lockClient.release();
        lockClient = null;
        // If we can't get lock, check one more time if tables exist
        const finalCheck = await pool.query(`
          SELECT EXISTS (
            SELECT FROM information_schema.tables 
            WHERE table_name = 'course_phases'
          ) as exists
        `);
        if (finalCheck.rows[0]?.exists) {
          return;
        }
        // Continue anyway - CREATE IF NOT EXISTS should handle it
      }
    }
  } catch (error) {
    if (lockClient) {
      await lockClient.release();
      lockClient = null;
    }
    // If lock acquisition fails, continue anyway
    // The CREATE IF NOT EXISTS statements should handle concurrency
  }

  try {
    // Create phases table
    await pool.query(`
    CREATE TABLE IF NOT EXISTS course_phases (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
      title VARCHAR(255) NOT NULL,
      description TEXT,
      sequence INTEGER NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      
      CONSTRAINT unique_phase_sequence UNIQUE (course_id, sequence)
    );

    CREATE INDEX IF NOT EXISTS idx_phases_course_id ON course_phases(course_id);
    CREATE INDEX IF NOT EXISTS idx_phases_sequence ON course_phases(course_id, sequence);
  `);

  // Create levels table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS course_levels (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      phase_id UUID NOT NULL REFERENCES course_phases(id) ON DELETE CASCADE,
      level_type VARCHAR(20) NOT NULL CHECK (level_type IN ('foundation', 'development', 'mastery')),
      title VARCHAR(255) NOT NULL,
      description TEXT,
      sequence INTEGER NOT NULL CHECK (sequence IN (1, 2, 3)),
      total_sessions INTEGER NOT NULL DEFAULT 10,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      
      CONSTRAINT unique_level_sequence UNIQUE (phase_id, sequence),
      CONSTRAINT unique_level_type_per_phase UNIQUE (phase_id, level_type)
    );

    CREATE INDEX IF NOT EXISTS idx_levels_phase_id ON course_levels(phase_id);
    CREATE INDEX IF NOT EXISTS idx_levels_sequence ON course_levels(phase_id, sequence);
    CREATE INDEX IF NOT EXISTS idx_levels_type ON course_levels(level_type);
  `);

  // Create sessions table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS course_sessions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      level_id UUID NOT NULL REFERENCES course_levels(id) ON DELETE CASCADE,
      session_number INTEGER NOT NULL CHECK (session_number >= 1 AND session_number <= 10),
      title VARCHAR(255) NOT NULL,
      description TEXT NOT NULL,
      expert_video_s3_key TEXT, -- S3 object key (not public URL)
      learning_sheet_pdf_s3_key TEXT, -- S3 object key (not public URL)
      quiz_id VARCHAR(255), -- References Quiz._id in MongoDB (optional)
      core_activity TEXT,
      key_concepts TEXT[], -- Array of strings
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      
      CONSTRAINT unique_session_number UNIQUE (level_id, session_number)
    );
  `);

  // Migration: Migrate from old URL columns to S3 key columns (do this BEFORE creating indexes)
  await pool.query(`
    DO $$
    BEGIN
      -- Migrate expert_video_url to expert_video_s3_key if needed
      IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'course_sessions' AND column_name = 'expert_video_url'
      ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'course_sessions' AND column_name = 'expert_video_s3_key'
      ) THEN
        ALTER TABLE course_sessions ADD COLUMN expert_video_s3_key TEXT;
        -- Note: Existing URLs in expert_video_url will need manual migration to S3 keys
        -- This is a data migration that should be handled separately
      END IF;
      
      -- Ensure expert_video_s3_key exists for new tables
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'course_sessions' AND column_name = 'expert_video_s3_key'
      ) THEN
        ALTER TABLE course_sessions ADD COLUMN expert_video_s3_key TEXT;
      END IF;
      
      -- Migrate learning_sheet_pdf_url to learning_sheet_pdf_s3_key if needed
      IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'course_sessions' AND column_name = 'learning_sheet_pdf_url'
      ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'course_sessions' AND column_name = 'learning_sheet_pdf_s3_key'
      ) THEN
        ALTER TABLE course_sessions ADD COLUMN learning_sheet_pdf_s3_key TEXT;
        -- Note: Existing URLs in learning_sheet_pdf_url will need manual migration to S3 keys
      END IF;
      
      -- Ensure learning_sheet_pdf_s3_key exists for new tables
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'course_sessions' AND column_name = 'learning_sheet_pdf_s3_key'
      ) THEN
        ALTER TABLE course_sessions ADD COLUMN learning_sheet_pdf_s3_key TEXT;
      END IF;
      
      -- Ensure quiz_id column exists
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'course_sessions' AND column_name = 'quiz_id'
      ) THEN
        ALTER TABLE course_sessions ADD COLUMN quiz_id VARCHAR(255);
      END IF;
      
      -- Remove mcq_questions column if it exists (quizzes are now in MongoDB)
      -- Commented out for safety - uncomment after confirming quiz migration
      -- IF EXISTS (
      --   SELECT 1 FROM information_schema.columns 
      --   WHERE table_name = 'course_sessions' AND column_name = 'mcq_questions'
      -- ) THEN
      --   ALTER TABLE course_sessions DROP COLUMN mcq_questions;
      -- END IF;
    END $$;
  `);

  // Now create indexes (after ensuring all columns exist)
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_sessions_level_id ON course_sessions(level_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_number ON course_sessions(level_id, session_number);
    CREATE INDEX IF NOT EXISTS idx_sessions_quiz_id ON course_sessions(quiz_id) WHERE quiz_id IS NOT NULL;
  `);

  // Create student purchases table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS student_course_purchases (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      student_id UUID NOT NULL, -- References students table (from student-service)
      course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
      purchase_tier INTEGER NOT NULL CHECK (purchase_tier IN (10, 20, 30)),
      purchase_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expiry_date TIMESTAMPTZ,
      metadata JSONB, -- Store all payment details: sessionCount, timeSlot, classType, learningMode, etc.
      is_active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    
    -- Add metadata column if it doesn't exist (for existing databases)
    DO $$ 
    BEGIN 
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'student_course_purchases' AND column_name = 'metadata'
      ) THEN
        ALTER TABLE student_course_purchases ADD COLUMN metadata JSONB;
      END IF;
    END $$;

    CREATE INDEX IF NOT EXISTS idx_purchases_student_id ON student_course_purchases(student_id);
    CREATE INDEX IF NOT EXISTS idx_purchases_course_id ON student_course_purchases(course_id);
    CREATE INDEX IF NOT EXISTS idx_purchases_active ON student_course_purchases(student_id, course_id, is_active) WHERE is_active = true;
    CREATE INDEX IF NOT EXISTS idx_purchases_tier ON student_course_purchases(purchase_tier);
  `);

  // Create processed_events table for event idempotency
  // event_id is TEXT: event IDs are opaque identifiers (UUID or string, e.g. sessions-generated-{id}-{ts})
  await pool.query(`
    CREATE TABLE IF NOT EXISTS processed_events (
      event_id TEXT PRIMARY KEY,
      event_type VARCHAR(100) NOT NULL,
      correlation_id UUID NOT NULL,
      payload JSONB NOT NULL,
      source VARCHAR(100) NOT NULL,
      version VARCHAR(20) NOT NULL DEFAULT '1.0.0',
      processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    
    CREATE INDEX IF NOT EXISTS idx_processed_events_correlation_type 
      ON processed_events(correlation_id, event_type);
    
    CREATE INDEX IF NOT EXISTS idx_processed_events_source 
      ON processed_events(source, processed_at);
    
    CREATE INDEX IF NOT EXISTS idx_processed_events_type 
      ON processed_events(event_type, processed_at);
    
    CREATE UNIQUE INDEX IF NOT EXISTS idx_processed_events_idempotency 
      ON processed_events(correlation_id, event_type);
  `);

  // Create student progress table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS student_progress (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      student_id UUID NOT NULL,
      course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
      phase_id UUID NOT NULL REFERENCES course_phases(id) ON DELETE CASCADE,
      level_id UUID NOT NULL REFERENCES course_levels(id) ON DELETE CASCADE,
      session_id UUID NOT NULL REFERENCES course_sessions(id) ON DELETE CASCADE,
      
      status VARCHAR(20) NOT NULL DEFAULT 'not_started' 
        CHECK (status IN ('not_started', 'in_progress', 'completed', 'locked')),
      
      video_watched BOOLEAN NOT NULL DEFAULT false,
      video_watched_at TIMESTAMPTZ,
      sheet_previewed BOOLEAN NOT NULL DEFAULT false,
      sheet_previewed_at TIMESTAMPTZ,
      quiz_completed BOOLEAN NOT NULL DEFAULT false,
      quiz_score NUMERIC(5, 2),
      quiz_max_score NUMERIC(5, 2),
      quiz_completed_at TIMESTAMPTZ,
      
      is_unlocked BOOLEAN NOT NULL DEFAULT false,
      unlocked_at TIMESTAMPTZ,
      
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      
      CONSTRAINT unique_student_session UNIQUE (student_id, session_id)
    );

    CREATE INDEX IF NOT EXISTS idx_progress_student_id ON student_progress(student_id);
    CREATE INDEX IF NOT EXISTS idx_progress_course_id ON student_progress(course_id);
    CREATE INDEX IF NOT EXISTS idx_progress_session_id ON student_progress(session_id);
    CREATE INDEX IF NOT EXISTS idx_progress_status ON student_progress(student_id, course_id, status);
    CREATE INDEX IF NOT EXISTS idx_progress_unlocked ON student_progress(student_id, is_unlocked) WHERE is_unlocked = true;
    CREATE INDEX IF NOT EXISTS idx_progress_completed ON student_progress(student_id, course_id) WHERE status = 'completed';
    
    -- Composite index for common queries
    CREATE INDEX IF NOT EXISTS idx_progress_student_course ON student_progress(student_id, course_id, phase_id, level_id);
  `);

  // Migration: Handle existing tables with old column names (sheet_downloaded -> sheet_previewed)
  await pool.query(`
    DO $$
    BEGIN
      -- If sheet_downloaded exists but sheet_previewed doesn't, migrate the data
      IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name='student_progress' AND column_name='sheet_downloaded'
      ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name='student_progress' AND column_name='sheet_previewed'
      ) THEN
        -- Add new column
        ALTER TABLE student_progress ADD COLUMN sheet_previewed BOOLEAN NOT NULL DEFAULT false;
        ALTER TABLE student_progress ADD COLUMN sheet_previewed_at TIMESTAMPTZ;
        
        -- Migrate data from old column to new column
        UPDATE student_progress 
        SET sheet_previewed = sheet_downloaded,
            sheet_previewed_at = sheet_downloaded_at
        WHERE sheet_downloaded = true;
        
        -- Drop old columns (optional - comment out if you want to keep them for backup)
        -- ALTER TABLE student_progress DROP COLUMN sheet_downloaded;
        -- ALTER TABLE student_progress DROP COLUMN sheet_downloaded_at;
      END IF;
      
      -- Ensure sheet_previewed column exists (for new tables)
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name='student_progress' AND column_name='sheet_previewed'
      ) THEN
        ALTER TABLE student_progress ADD COLUMN sheet_previewed BOOLEAN NOT NULL DEFAULT false;
        ALTER TABLE student_progress ADD COLUMN sheet_previewed_at TIMESTAMPTZ;
      END IF;
    END $$;
  `);

  // Create student projects table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS student_projects (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      student_id UUID NOT NULL,
      course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
      phase_id UUID NOT NULL REFERENCES course_phases(id) ON DELETE CASCADE,
      level_id UUID NOT NULL REFERENCES course_levels(id) ON DELETE CASCADE,
      level_type VARCHAR(20) NOT NULL CHECK (level_type IN ('foundation', 'development', 'mastery')),
      
      project_video_url TEXT NOT NULL,
      project_pdf_url TEXT NOT NULL,
      title VARCHAR(255) NOT NULL,
      description TEXT,
      
      visibility VARCHAR(20) NOT NULL DEFAULT 'private' 
        CHECK (visibility IN ('private', 'community', 'public')),
      
      status VARCHAR(20) NOT NULL DEFAULT 'pending' 
        CHECK (status IN ('pending', 'approved', 'rejected', 'revision_required')),
      
      trainer_id UUID, -- References trainers table
      trainer_feedback TEXT,
      trainer_rating INTEGER CHECK (trainer_rating >= 1 AND trainer_rating <= 5),
      reviewed_at TIMESTAMPTZ,
      
      submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      
      CONSTRAINT unique_student_level_project UNIQUE (student_id, level_id)
    );

    CREATE INDEX IF NOT EXISTS idx_projects_student_id ON student_projects(student_id);
    CREATE INDEX IF NOT EXISTS idx_projects_course_id ON student_projects(course_id);
    CREATE INDEX IF NOT EXISTS idx_projects_level_id ON student_projects(level_id);
    CREATE INDEX IF NOT EXISTS idx_projects_level_type ON student_projects(level_type);
    CREATE INDEX IF NOT EXISTS idx_projects_visibility ON student_projects(visibility);
    CREATE INDEX IF NOT EXISTS idx_projects_status ON student_projects(status);
    CREATE INDEX IF NOT EXISTS idx_projects_trainer_id ON student_projects(trainer_id) WHERE trainer_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_projects_public ON student_projects(visibility, status) WHERE visibility = 'public' AND status = 'approved';
    
    -- Index for community visibility
    CREATE INDEX IF NOT EXISTS idx_projects_community ON student_projects(visibility, status) 
      WHERE visibility = 'community' AND status = 'approved';
  `);

  // Create exam_attempts table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS exam_attempts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      student_id UUID NOT NULL,
      level_id UUID NOT NULL REFERENCES course_levels(id) ON DELETE CASCADE,
      attempt_number INTEGER NOT NULL CHECK (attempt_number >= 1 AND attempt_number <= 3),
      
      score NUMERIC(6, 2) NOT NULL,
      max_score NUMERIC(6, 2) NOT NULL DEFAULT 150,
      percentage NUMERIC(5, 2) NOT NULL,
      
      answers JSONB NOT NULL, -- Array of {questionId, selectedAnswerIndex}
      
      certificate_type VARCHAR(20) CHECK (certificate_type IN ('normal', 'excellence')),
      
      completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      
      CONSTRAINT unique_student_level_attempt UNIQUE (student_id, level_id, attempt_number)
    );

    CREATE INDEX IF NOT EXISTS idx_exam_attempts_student_id ON exam_attempts(student_id);
    CREATE INDEX IF NOT EXISTS idx_exam_attempts_level_id ON exam_attempts(level_id);
    CREATE INDEX IF NOT EXISTS idx_exam_attempts_student_level ON exam_attempts(student_id, level_id);
  `);

  // Add trigger to update updated_at timestamp
  await pool.query(`
    CREATE OR REPLACE FUNCTION update_updated_at_column()
    RETURNS TRIGGER AS $$
    BEGIN
      NEW.updated_at = NOW();
      RETURN NEW;
    END;
    $$ language 'plpgsql';

    DROP TRIGGER IF EXISTS update_course_phases_updated_at ON course_phases;
    CREATE TRIGGER update_course_phases_updated_at 
      BEFORE UPDATE ON course_phases 
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

    DROP TRIGGER IF EXISTS update_course_levels_updated_at ON course_levels;
    CREATE TRIGGER update_course_levels_updated_at 
      BEFORE UPDATE ON course_levels 
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

    DROP TRIGGER IF EXISTS update_course_sessions_updated_at ON course_sessions;
    CREATE TRIGGER update_course_sessions_updated_at 
      BEFORE UPDATE ON course_sessions 
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

    DROP TRIGGER IF EXISTS update_student_course_purchases_updated_at ON student_course_purchases;
    CREATE TRIGGER update_student_course_purchases_updated_at 
      BEFORE UPDATE ON student_course_purchases 
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

    DROP TRIGGER IF EXISTS update_student_progress_updated_at ON student_progress;
    CREATE TRIGGER update_student_progress_updated_at 
      BEFORE UPDATE ON student_progress 
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

    DROP TRIGGER IF EXISTS update_student_projects_updated_at ON student_projects;
    CREATE TRIGGER update_student_projects_updated_at 
      BEFORE UPDATE ON student_projects 
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

    DROP TRIGGER IF EXISTS update_exam_attempts_updated_at ON exam_attempts;
    CREATE TRIGGER update_exam_attempts_updated_at 
      BEFORE UPDATE ON exam_attempts 
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  `);
  } catch (error) {
    // Re-throw error after releasing lock
    throw error;
  } finally {
    // Release advisory lock if we acquired it
    if (lockClient && hasLock) {
      try {
        await lockClient.query('SELECT pg_advisory_unlock($1)', [lockId]);
      } catch (unlockError) {
        // Ignore unlock errors - lock will expire on connection close anyway
        // Failed to release lock - non-critical, log at debug level
        // Lock will be released automatically when connection closes
      } finally {
        await lockClient.release();
      }
    } else if (lockClient) {
      // Release client even if we didn't get the lock
      await lockClient.release();
    }
  }
}

// ============================================================================
// ROW MAPPING FUNCTIONS
// ============================================================================

function rowToPhase(row: any): CoursePhase {
  return {
    id: row.id,
    courseId: row.course_id,
    title: row.title,
    description: row.description,
    sequence: row.sequence,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToLevel(row: any): CourseLevel {
  return {
    id: row.id,
    phaseId: row.phase_id,
    levelType: row.level_type,
    title: row.title,
    description: row.description,
    sequence: row.sequence,
    totalSessions: row.total_sessions,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToSession(row: any): CourseSession {
  return {
    id: row.id,
    levelId: row.level_id,
    sessionNumber: row.session_number,
    title: row.title,
    description: row.description,
    expertVideoS3Key: row.expert_video_s3_key || row.expert_video_url || null, // Support migration
    learningSheetPdfS3Key: row.learning_sheet_pdf_s3_key || row.learning_sheet_pdf_url || null, // Support migration
    quizId: row.quiz_id || null,
    coreActivity: row.core_activity,
    keyConcepts: row.key_concepts || [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToPurchase(row: any): StudentCoursePurchase {
  return {
    id: row.id,
    studentId: row.student_id,
    courseId: row.course_id,
    purchaseTier: row.purchase_tier,
    purchaseDate: row.purchase_date,
    expiryDate: row.expiry_date,
    metadata: row.metadata ? (typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata) : null,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToProgress(row: any): StudentProgress {
  return {
    id: row.id,
    studentId: row.student_id,
    courseId: row.course_id,
    phaseId: row.phase_id,
    levelId: row.level_id,
    sessionId: row.session_id,
    status: row.status,
    videoWatched: row.video_watched,
    videoWatchedAt: row.video_watched_at,
    sheetPreviewed: row.sheet_previewed,
    sheetPreviewedAt: row.sheet_previewed_at,
    quizCompleted: row.quiz_completed,
    quizScore: row.quiz_score ? parseFloat(row.quiz_score) : null,
    quizMaxScore: row.quiz_max_score ? parseFloat(row.quiz_max_score) : null,
    quizCompletedAt: row.quiz_completed_at,
    isUnlocked: row.is_unlocked,
    unlockedAt: row.unlocked_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToProject(row: any): StudentProject {
  return {
    id: row.id,
    studentId: row.student_id,
    courseId: row.course_id,
    phaseId: row.phase_id,
    levelId: row.level_id,
    levelType: row.level_type,
    projectVideoUrl: row.project_video_url,
    projectPdfUrl: row.project_pdf_url,
    title: row.title,
    description: row.description,
    visibility: row.visibility,
    status: row.status,
    trainerId: row.trainer_id,
    trainerFeedback: row.trainer_feedback,
    trainerRating: row.trainer_rating,
    reviewedAt: row.reviewed_at,
    submittedAt: row.submitted_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ============================================================================
// REPOSITORY CLASS
// ============================================================================

export class CourseStructureRepository {
  constructor(private readonly pool: Pool) {}

  // Expose pool for service layer access
  getPool(): Pool {
    return this.pool;
  }

  // ============================================================================
  // PHASE OPERATIONS
  // ============================================================================

  async createPhase(input: CreatePhaseInput, client?: PoolClient): Promise<CoursePhase> {
    const queryClient = client || this.pool;
    const result = await queryClient.query(
      `INSERT INTO course_phases (course_id, title, description, sequence)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [input.courseId, input.title, input.description || null, input.sequence]
    );
    return rowToPhase(result.rows[0]);
  }

  async getPhasesByCourseId(courseId: string): Promise<CoursePhase[]> {
    const result = await this.pool.query(
      `SELECT * FROM course_phases 
       WHERE course_id = $1 
       ORDER BY sequence ASC`,
      [courseId]
    );
    return result.rows.map(rowToPhase);
  }

  async getPhaseById(phaseId: string): Promise<CoursePhase | null> {
    const result = await this.pool.query(
      `SELECT * FROM course_phases WHERE id = $1`,
      [phaseId]
    );
    return result.rows.length > 0 ? rowToPhase(result.rows[0]) : null;
  }

  // ============================================================================
  // LEVEL OPERATIONS
  // ============================================================================

  async createLevel(input: CreateLevelInput, client?: PoolClient): Promise<CourseLevel> {
    const queryClient = client || this.pool;
    const result = await queryClient.query(
      `INSERT INTO course_levels (phase_id, level_type, title, description, sequence)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [input.phaseId, input.levelType, input.title, input.description || null, input.sequence]
    );
    return rowToLevel(result.rows[0]);
  }

  async getLevelsByPhaseId(phaseId: string): Promise<CourseLevel[]> {
    const result = await this.pool.query(
      `SELECT * FROM course_levels 
       WHERE phase_id = $1 
       ORDER BY sequence ASC`,
      [phaseId]
    );
    return result.rows.map(rowToLevel);
  }

  async getLevelById(levelId: string): Promise<CourseLevel | null> {
    const result = await this.pool.query(
      `SELECT * FROM course_levels WHERE id = $1`,
      [levelId]
    );
    return result.rows.length > 0 ? rowToLevel(result.rows[0]) : null;
  }

  // ============================================================================
  // SESSION OPERATIONS
  // ============================================================================

  async createSession(input: CreateSessionInput, client?: PoolClient): Promise<CourseSession> {
    const queryClient = client || this.pool;
    const result = await queryClient.query(
      `INSERT INTO course_sessions (
         level_id, session_number, title, description,
         expert_video_s3_key, learning_sheet_pdf_s3_key, quiz_id,
         core_activity, key_concepts
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        input.levelId,
        input.sessionNumber,
        input.title,
        input.description,
        input.expertVideoS3Key || null,
        input.learningSheetPdfS3Key || null,
        input.quizId || null,
        input.coreActivity || null,
        input.keyConcepts || [],
      ]
    );
    return rowToSession(result.rows[0]);
  }

  async getSessionsByLevelId(levelId: string): Promise<CourseSession[]> {
    const result = await this.pool.query(
      `SELECT * FROM course_sessions 
       WHERE level_id = $1 
       ORDER BY session_number ASC`,
      [levelId]
    );
    return result.rows.map(rowToSession);
  }

  async getSessionById(sessionId: string): Promise<CourseSession | null> {
    const result = await this.pool.query(
      `SELECT * FROM course_sessions WHERE id = $1`,
      [sessionId]
    );
    return result.rows.length > 0 ? rowToSession(result.rows[0]) : null;
  }

  async updateSessionQuizId(sessionId: string, quizId: string): Promise<CourseSession | null> {
    const result = await this.pool.query(
      `UPDATE course_sessions 
       SET quiz_id = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING *`,
      [quizId, sessionId]
    );
    return result.rows.length > 0 ? rowToSession(result.rows[0]) : null;
  }

  /**
   * PRODUCTION OPTIMIZATION: Get complete course structure (phases, levels, sessions) in single optimized query
   * This replaces multiple sequential queries with one efficient JOIN query for 600K+ users scale
   */
  async getCompleteCourseStructure(courseId: string): Promise<{
    phases: CoursePhase[];
    levels: CourseLevel[];
    sessions: CourseSession[];
  }> {
    // Use a single optimized query with JOINs instead of multiple round trips
    // This reduces database queries from N+M+P to just 1 query
    const result = await this.pool.query(
      `SELECT 
        -- Phase data
        cp.id as phase_id, cp.course_id, cp.title as phase_title, cp.description as phase_description,
        cp.sequence as phase_sequence, cp.created_at as phase_created_at, cp.updated_at as phase_updated_at,
        -- Level data
        cl.id as level_id, cl.phase_id, cl.level_type, cl.title as level_title, 
        cl.description as level_description, cl.sequence as level_sequence, cl.total_sessions,
        cl.created_at as level_created_at, cl.updated_at as level_updated_at,
        -- Session data
        cs.id as session_id, cs.level_id, cs.session_number, cs.title as session_title,
        cs.description as session_description, cs.expert_video_s3_key, cs.learning_sheet_pdf_s3_key,
        cs.quiz_id, cs.core_activity, cs.key_concepts, cs.created_at as session_created_at,
        cs.updated_at as session_updated_at
      FROM course_phases cp
      LEFT JOIN course_levels cl ON cl.phase_id = cp.id
      LEFT JOIN course_sessions cs ON cs.level_id = cl.id
      WHERE cp.course_id = $1
      ORDER BY cp.sequence ASC, cl.sequence ASC, cs.session_number ASC`,
      [courseId]
    );

    // Process results into structured format
    const phaseMap = new Map<string, CoursePhase>();
    const levelMap = new Map<string, CourseLevel>();
    const sessionMap = new Map<string, CourseSession>();

    for (const row of result.rows) {
      // Process phase (only once per phase)
      if (row.phase_id && !phaseMap.has(row.phase_id)) {
        phaseMap.set(row.phase_id, {
          id: row.phase_id,
          courseId: row.course_id,
          title: row.phase_title,
          description: row.phase_description,
          sequence: row.phase_sequence,
          createdAt: row.phase_created_at,
          updatedAt: row.phase_updated_at,
        });
      }

      // Process level (only once per level)
      if (row.level_id && !levelMap.has(row.level_id)) {
        levelMap.set(row.level_id, {
          id: row.level_id,
          phaseId: row.phase_id,
          levelType: row.level_type,
          title: row.level_title,
          description: row.level_description,
          sequence: row.level_sequence,
          totalSessions: row.total_sessions,
          createdAt: row.level_created_at,
          updatedAt: row.level_updated_at,
        });
      }

      // Process session (only once per session) - use rowToSession for consistency
      if (row.session_id && !sessionMap.has(row.session_id)) {
        // Create a row object compatible with rowToSession function
        const sessionRow = {
          id: row.session_id,
          level_id: row.level_id,
          session_number: row.session_number,
          title: row.session_title,
          description: row.session_description || '',
          expert_video_s3_key: row.expert_video_s3_key,
          learning_sheet_pdf_s3_key: row.learning_sheet_pdf_s3_key,
          expert_video_url: null, // For migration compatibility
          learning_sheet_pdf_url: null, // For migration compatibility
          quiz_id: row.quiz_id,
          core_activity: row.core_activity,
          key_concepts: row.key_concepts,
          created_at: row.session_created_at,
          updated_at: row.session_updated_at,
        };
        const session = rowToSession(sessionRow);
        sessionMap.set(row.session_id, session);
      }
    }

    return {
      phases: Array.from(phaseMap.values()),
      levels: Array.from(levelMap.values()),
      sessions: Array.from(sessionMap.values()),
    };
  }

  // ============================================================================
  // PURCHASE OPERATIONS
  // ============================================================================

  async createPurchase(input: CreatePurchaseInput): Promise<StudentCoursePurchase> {
    const result = await this.pool.query(
      `INSERT INTO student_course_purchases 
       (student_id, course_id, purchase_tier, expiry_date, metadata)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [
        input.studentId, 
        input.courseId, 
        input.purchaseTier, 
        input.expiryDate || null,
        input.metadata ? JSON.stringify(input.metadata) : null
      ]
    );
    return rowToPurchase(result.rows[0]);
  }

  async getActivePurchase(studentId: string, courseId: string): Promise<StudentCoursePurchase | null> {
    const result = await this.pool.query(
      `SELECT * FROM student_course_purchases
       WHERE student_id = $1 AND course_id = $2 AND is_active = true
       ORDER BY purchase_date DESC
       LIMIT 1`,
      [studentId, courseId]
    );
    return result.rows.length > 0 ? rowToPurchase(result.rows[0]) : null;
  }

  async upgradePurchase(
    purchaseId: string,
    newTier: SessionPurchaseTier
  ): Promise<StudentCoursePurchase | null> {
    const result = await this.pool.query(
      `UPDATE student_course_purchases
       SET purchase_tier = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING *`,
      [newTier, purchaseId]
    );
    return result.rows.length > 0 ? rowToPurchase(result.rows[0]) : null;
  }

  // ============================================================================
  // PROGRESS OPERATIONS
  // ============================================================================

  async getOrCreateProgress(
    studentId: string,
    courseId: string,
    phaseId: string,
    levelId: string,
    sessionId: string
  ): Promise<StudentProgress> {
    // Try to get existing progress
    let result = await this.pool.query(
      `SELECT * FROM student_progress
       WHERE student_id = $1 AND session_id = $2`,
      [studentId, sessionId]
    );

    if (result.rows.length > 0) {
      return rowToProgress(result.rows[0]);
    }

    // Create new progress entry
    result = await this.pool.query(
      `INSERT INTO student_progress 
       (student_id, course_id, phase_id, level_id, session_id, is_unlocked)
       VALUES ($1, $2, $3, $4, $5, false)
       RETURNING *`,
      [studentId, courseId, phaseId, levelId, sessionId]
    );
    return rowToProgress(result.rows[0]);
  }

  async updateProgress(
    progressId: string,
    input: UpdateProgressInput
  ): Promise<StudentProgress | null> {
    const updates: string[] = [];
    const values: any[] = [];
    let paramCount = 1;

    if (input.videoWatched !== undefined) {
      updates.push(`video_watched = $${paramCount++}`);
      values.push(input.videoWatched);
      if (input.videoWatched) {
        updates.push(`video_watched_at = NOW()`);
      }
    }

    if (input.sheetPreviewed !== undefined) {
      updates.push(`sheet_previewed = $${paramCount++}`);
      values.push(input.sheetPreviewed);
      if (input.sheetPreviewed) {
        updates.push(`sheet_previewed_at = NOW()`);
      }
    }

    if (input.quizCompleted !== undefined) {
      updates.push(`quiz_completed = $${paramCount++}`);
      values.push(input.quizCompleted);
      if (input.quizCompleted) {
        updates.push(`quiz_completed_at = NOW()`);
      }
    }

    if (input.quizScore !== undefined) {
      updates.push(`quiz_score = $${paramCount++}`);
      values.push(input.quizScore);
    }

    if (input.quizMaxScore !== undefined) {
      updates.push(`quiz_max_score = $${paramCount++}`);
      values.push(input.quizMaxScore);
    }

    // Update status based on completion
    if (input.quizCompleted && input.videoWatched) {
      updates.push(`status = 'completed'`);
    } else if (input.videoWatched || input.sheetPreviewed) {
      updates.push(`status = 'in_progress'`);
    }

    if (updates.length === 0) {
      return this.getProgressById(progressId);
    }

    values.push(progressId);
    const query = `UPDATE student_progress 
                   SET ${updates.join(', ')}, updated_at = NOW()
                   WHERE id = $${paramCount}
                   RETURNING *`;
    
    const result = await this.pool.query(query, values);
    return result.rows.length > 0 ? rowToProgress(result.rows[0]) : null;
  }

  async getProgressById(progressId: string): Promise<StudentProgress | null> {
    const result = await this.pool.query(
      `SELECT * FROM student_progress WHERE id = $1`,
      [progressId]
    );
    return result.rows.length > 0 ? rowToProgress(result.rows[0]) : null;
  }

  async getStudentProgressByCourse(
    studentId: string,
    courseId: string
  ): Promise<StudentProgress[]> {
    const result = await this.pool.query(
      `SELECT * FROM student_progress
       WHERE student_id = $1 AND course_id = $2
       ORDER BY phase_id, level_id, session_id`,
      [studentId, courseId]
    );
    return result.rows.map(rowToProgress);
  }

  // ============================================================================
  // PROJECT OPERATIONS
  // ============================================================================

  async createProject(project: {
    studentId: string;
    courseId: string;
    phaseId: string;
    levelId: string;
    levelType: LevelType;
    projectVideoUrl: string;
    projectPdfUrl: string;
    title: string;
    description?: string;
  }): Promise<StudentProject> {
    // Determine visibility based on level type
    let visibility: ProjectVisibility = 'private';
    if (project.levelType === 'development') {
      visibility = 'community';
    } else if (project.levelType === 'mastery') {
      visibility = 'public';
    }

    const result = await this.pool.query(
      `INSERT INTO student_projects 
       (student_id, course_id, phase_id, level_id, level_type,
        project_video_url, project_pdf_url, title, description, visibility)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [
        project.studentId,
        project.courseId,
        project.phaseId,
        project.levelId,
        project.levelType,
        project.projectVideoUrl,
        project.projectPdfUrl,
        project.title,
        project.description || null,
        visibility,
      ]
    );
    return rowToProject(result.rows[0]);
  }

  async getProjectById(projectId: string): Promise<StudentProject | null> {
    const result = await this.pool.query(
      `SELECT * FROM student_projects WHERE id = $1`,
      [projectId]
    );
    return result.rows.length > 0 ? rowToProject(result.rows[0]) : null;
  }

  async getProjectsByStudent(studentId: string, courseId?: string): Promise<StudentProject[]> {
    let query = `SELECT * FROM student_projects WHERE student_id = $1`;
    const params: any[] = [studentId];
    
    if (courseId) {
      query += ` AND course_id = $2`;
      params.push(courseId);
    }
    
    query += ` ORDER BY submitted_at DESC`;
    
    const result = await this.pool.query(query, params);
    return result.rows.map(rowToProject);
  }

  async getPublicProjects(limit: number = 50): Promise<StudentProject[]> {
    const result = await this.pool.query(
      `SELECT * FROM student_projects
       WHERE visibility = 'public' AND status = 'approved'
       ORDER BY submitted_at DESC
       LIMIT $1`,
      [limit]
    );
    return result.rows.map(rowToProject);
  }

  async getCommunityProjects(limit: number = 50): Promise<StudentProject[]> {
    const result = await this.pool.query(
      `SELECT * FROM student_projects
       WHERE visibility IN ('community', 'public') AND status = 'approved'
       ORDER BY submitted_at DESC
       LIMIT $1`,
      [limit]
    );
    return result.rows.map(rowToProject);
  }

  async updateProjectReview(
    projectId: string,
    updates: {
      status: ProjectStatus;
      trainerId: string;
      trainerFeedback?: string;
      trainerRating?: number;
    }
  ): Promise<StudentProject | null> {
    const result = await this.pool.query(
      `UPDATE student_projects
       SET status = $1, trainer_id = $2, trainer_feedback = $3,
           trainer_rating = $4, reviewed_at = NOW(), updated_at = NOW()
       WHERE id = $5
       RETURNING *`,
      [
        updates.status,
        updates.trainerId,
        updates.trainerFeedback || null,
        updates.trainerRating || null,
        projectId,
      ]
    );
    return result.rows.length > 0 ? rowToProject(result.rows[0]) : null;
  }

  async getProjectsByTrainer(
    trainerId: string,
    status?: ProjectStatus
  ): Promise<StudentProject[]> {
    let query = `SELECT * FROM student_projects WHERE trainer_id = $1`;
    const params: any[] = [trainerId];

    if (status) {
      query += ` AND status = $2`;
      params.push(status);
    }

    query += ` ORDER BY submitted_at DESC`;

    const result = await this.pool.query(query, params);
    return result.rows.map(rowToProject);
  }

  // ============================================================================
  // EXAM OPERATIONS
  // ============================================================================

  async createExamAttempt(attempt: {
    studentId: string;
    levelId: string;
    attemptNumber: number;
    score: number;
    maxScore: number;
    percentage: number;
    answers: Array<{ questionId: string; selectedAnswerIndex: number }>;
    certificateType?: 'normal' | 'excellence' | null;
  }): Promise<ExamAttempt> {
    const result = await this.pool.query(
      `INSERT INTO exam_attempts 
       (student_id, level_id, attempt_number, score, max_score, percentage, answers, certificate_type)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        attempt.studentId,
        attempt.levelId,
        attempt.attemptNumber,
        attempt.score,
        attempt.maxScore,
        attempt.percentage,
        JSON.stringify(attempt.answers),
        attempt.certificateType || null,
      ]
    );
    return rowToExamAttempt(result.rows[0]);
  }

  async getExamAttempts(studentId: string, levelId: string): Promise<ExamAttempt[]> {
    const result = await this.pool.query(
      `SELECT * FROM exam_attempts 
       WHERE student_id = $1 AND level_id = $2 
       ORDER BY attempt_number ASC`,
      [studentId, levelId]
    );
    return result.rows.map(rowToExamAttempt);
  }

  async getLatestExamAttempt(studentId: string, levelId: string): Promise<ExamAttempt | null> {
    const result = await this.pool.query(
      `SELECT * FROM exam_attempts 
       WHERE student_id = $1 AND level_id = $2 
       ORDER BY attempt_number DESC 
       LIMIT 1`,
      [studentId, levelId]
    );
    return result.rows.length > 0 ? rowToExamAttempt(result.rows[0]) : null;
  }
}

// Helper function to convert database row to ExamAttempt
function rowToExamAttempt(row: any): ExamAttempt {
  return {
    id: row.id,
    studentId: row.student_id,
    levelId: row.level_id,
    attemptNumber: row.attempt_number,
    score: parseFloat(row.score),
    maxScore: parseFloat(row.max_score),
    percentage: parseFloat(row.percentage),
    answers: typeof row.answers === 'string' ? JSON.parse(row.answers) : row.answers,
    certificateType: row.certificate_type || null,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

