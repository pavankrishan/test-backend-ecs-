/**
 * Assignment Model - PostgreSQL Schema
 * Stores course assignments and submissions
 */

import type { Pool } from 'pg';

// Database row types for type safety
interface AssignmentRow {
  id: string;
  course_id: string;
  title: string;
  description: string;
  instructions?: string | null;
  due_date?: Date | null;
  max_score: number;
  passing_score?: number | null;
  is_required: boolean;
  order: number;
  created_at: Date;
  updated_at: Date;
}

interface AssignmentSubmissionRow {
  id: string;
  assignment_id: string;
  student_id: string;
  course_id: string;
  submission_text?: string | null;
  submission_files?: string[] | null;
  score?: number | null;
  feedback?: string | null;
  status: 'pending' | 'submitted' | 'graded' | 'returned';
  submitted_at?: Date | null;
  graded_at?: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface Assignment {
  id: string;
  courseId: string;
  title: string;
  description: string;
  instructions?: string;
  dueDate?: Date;
  maxScore: number;
  passingScore?: number;
  isRequired: boolean;
  order: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface AssignmentSubmission {
  id: string;
  assignmentId: string;
  studentId: string;
  courseId: string;
  submissionText?: string;
  submissionFiles?: string[];
  score?: number;
  feedback?: string;
  status: 'pending' | 'submitted' | 'graded' | 'returned';
  submittedAt?: Date;
  gradedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface AssignmentCreateInput {
  courseId: string;
  title: string;
  description: string;
  instructions?: string;
  dueDate?: Date;
  maxScore: number;
  passingScore?: number;
  isRequired?: boolean;
  order?: number;
}

export interface AssignmentSubmissionCreateInput {
  assignmentId: string;
  studentId: string;
  courseId: string;
  submissionText?: string;
  submissionFiles?: string[];
}

/**
 * Create assignments tables
 */
export async function createAssignmentsTables(pool: Pool): Promise<void> {
  // Assignments table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS assignments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      course_id UUID NOT NULL,
      title VARCHAR(255) NOT NULL,
      description TEXT NOT NULL,
      instructions TEXT,
      due_date TIMESTAMP,
      max_score INTEGER NOT NULL DEFAULT 100 CHECK (max_score > 0),
      passing_score INTEGER CHECK (passing_score IS NULL OR (passing_score >= 0 AND passing_score <= max_score)),
      is_required BOOLEAN DEFAULT true,
      "order" INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_course FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE
    );
  `);

  // Create indexes
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_assignments_course_id ON assignments(course_id);
    CREATE INDEX IF NOT EXISTS idx_assignments_order ON assignments(course_id, "order");
  `);

  // Assignment submissions table - Create first
  await pool.query(`
    CREATE TABLE IF NOT EXISTS assignment_submissions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      assignment_id UUID NOT NULL,
      student_id UUID NOT NULL,
      course_id UUID NOT NULL,
      submission_text TEXT,
      submission_files TEXT[],
      score INTEGER CHECK (score IS NULL OR score >= 0),
      feedback TEXT,
      status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'submitted', 'graded', 'returned')),
      submitted_at TIMESTAMP,
      graded_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_assignment FOREIGN KEY (assignment_id) REFERENCES assignments(id) ON DELETE CASCADE,
      CONSTRAINT fk_submission_course FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE,
      CONSTRAINT unique_student_assignment UNIQUE (assignment_id, student_id)
    );
  `);

  // Add missing columns if they don't exist (for existing tables)
  await pool.query(`
    DO $$ 
    BEGIN
      -- Add course_id column if it doesn't exist
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'assignment_submissions' AND column_name = 'course_id'
      ) THEN
        -- Add as nullable first to handle existing rows
        ALTER TABLE assignment_submissions ADD COLUMN course_id UUID;
        
        -- Try to populate course_id from assignments table for existing rows
        UPDATE assignment_submissions sub
        SET course_id = a.course_id
        FROM assignments a
        WHERE sub.assignment_id = a.id AND sub.course_id IS NULL;
        
        -- Make it NOT NULL after populating
        ALTER TABLE assignment_submissions ALTER COLUMN course_id SET NOT NULL;
        
        -- Add foreign key constraint
        ALTER TABLE assignment_submissions 
        ADD CONSTRAINT fk_submission_course 
        FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE;
      END IF;
      
      -- Add status column if it doesn't exist
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'assignment_submissions' AND column_name = 'status'
      ) THEN
        ALTER TABLE assignment_submissions 
        ADD COLUMN status VARCHAR(20) DEFAULT 'pending' 
        CHECK (status IN ('pending', 'submitted', 'graded', 'returned'));
      END IF;
      
      -- Add feedback column if it doesn't exist
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'assignment_submissions' AND column_name = 'feedback'
      ) THEN
        ALTER TABLE assignment_submissions ADD COLUMN feedback TEXT;
      END IF;
      
      -- Add submitted_at column if it doesn't exist
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'assignment_submissions' AND column_name = 'submitted_at'
      ) THEN
        ALTER TABLE assignment_submissions ADD COLUMN submitted_at TIMESTAMP;
      END IF;
    END $$;
  `);

  // Create indexes
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_submissions_assignment_id ON assignment_submissions(assignment_id);
    CREATE INDEX IF NOT EXISTS idx_submissions_student_id ON assignment_submissions(student_id);
    CREATE INDEX IF NOT EXISTS idx_submissions_course_id ON assignment_submissions(course_id);
    CREATE INDEX IF NOT EXISTS idx_submissions_status ON assignment_submissions(status);
    CREATE INDEX IF NOT EXISTS idx_submissions_course_status ON assignment_submissions(course_id, status);
  `);

}

function rowToAssignment(row: AssignmentRow): Assignment {
  return {
    id: row.id,
    courseId: row.course_id,
    title: row.title,
    description: row.description,
    instructions: row.instructions || undefined,
    dueDate: row.due_date || undefined,
    maxScore: row.max_score,
    passingScore: row.passing_score || undefined,
    isRequired: row.is_required,
    order: row.order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToSubmission(row: AssignmentSubmissionRow): AssignmentSubmission {
  return {
    id: row.id,
    assignmentId: row.assignment_id,
    studentId: row.student_id,
    courseId: row.course_id,
    submissionText: row.submission_text || undefined,
    submissionFiles: row.submission_files || [],
    score: row.score || undefined,
    feedback: row.feedback || undefined,
    status: row.status,
    submittedAt: row.submitted_at || undefined,
    gradedAt: row.graded_at || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class AssignmentRepository {
  constructor(private pool: Pool) {}

  async create(data: AssignmentCreateInput): Promise<Assignment> {
    // Validate passing score
    if (data.passingScore !== undefined && data.passingScore > data.maxScore) {
      throw new Error(`Passing score (${data.passingScore}) cannot exceed maximum score (${data.maxScore})`);
    }

    if (data.maxScore <= 0) {
      throw new Error('Maximum score must be greater than 0');
    }

    const query = `
      INSERT INTO assignments (
        course_id, title, description, instructions, due_date,
        max_score, passing_score, is_required, "order"
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *
    `;

    const values = [
      data.courseId,
      data.title,
      data.description,
      data.instructions || null,
      data.dueDate || null,
      data.maxScore,
      data.passingScore || null,
      data.isRequired !== undefined ? data.isRequired : true,
      data.order || 0,
    ];

    const result = await this.pool.query<AssignmentRow>(query, values);
    return rowToAssignment(result.rows[0]);
  }

  async findByCourseId(courseId: string): Promise<Assignment[]> {
    const query = 'SELECT * FROM assignments WHERE course_id = $1 ORDER BY "order" ASC';
    const result = await this.pool.query<AssignmentRow>(query, [courseId]);
    return result.rows.map(rowToAssignment);
  }

  async findById(id: string): Promise<Assignment | null> {
    const query = 'SELECT * FROM assignments WHERE id = $1';
    const result = await this.pool.query<AssignmentRow>(query, [id]);
    return result.rows.length > 0 ? rowToAssignment(result.rows[0]) : null;
  }

  async createSubmission(data: AssignmentSubmissionCreateInput): Promise<AssignmentSubmission> {
    const query = `
      INSERT INTO assignment_submissions (
        assignment_id, student_id, course_id, submission_text, submission_files, status, submitted_at
      ) VALUES ($1, $2, $3, $4, $5, 'pending', CURRENT_TIMESTAMP)
      RETURNING *
    `;

    const values = [
      data.assignmentId,
      data.studentId,
      data.courseId,
      data.submissionText || null,
      data.submissionFiles || [],
    ];

    const result = await this.pool.query<AssignmentSubmissionRow>(query, values);
    return rowToSubmission(result.rows[0]);
  }

  async gradeSubmission(
    submissionId: string,
    score: number,
    feedback?: string
  ): Promise<AssignmentSubmission | null> {
    // Get submission to validate score against assignment maxScore
    const submissionQuery = `
      SELECT s.*, a.max_score 
      FROM assignment_submissions s
      JOIN assignments a ON s.assignment_id = a.id
      WHERE s.id = $1
    `;
    const submissionResult = await this.pool.query<AssignmentSubmissionRow & { max_score: number }>(
      submissionQuery,
      [submissionId]
    );

    if (submissionResult.rows.length === 0) {
      return null;
    }

    const maxScore = submissionResult.rows[0].max_score;

    // Validate score
    if (score < 0) {
      throw new Error('Score cannot be negative');
    }
    if (score > maxScore) {
      throw new Error(`Score (${score}) cannot exceed maximum score (${maxScore})`);
    }

    const query = `
      UPDATE assignment_submissions
      SET score = $1, feedback = $2, status = 'graded', graded_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE id = $3
      RETURNING *
    `;

    const result = await this.pool.query<AssignmentSubmissionRow>(query, [score, feedback || null, submissionId]);
    return result.rows.length > 0 ? rowToSubmission(result.rows[0]) : null;
  }

  async getSubmissionsByAssignment(assignmentId: string): Promise<AssignmentSubmission[]> {
    const query = 'SELECT * FROM assignment_submissions WHERE assignment_id = $1 ORDER BY submitted_at DESC';
    const result = await this.pool.query<AssignmentSubmissionRow>(query, [assignmentId]);
    return result.rows.map(rowToSubmission);
  }

  async getSubmissionByStudent(
    assignmentId: string,
    studentId: string
  ): Promise<AssignmentSubmission | null> {
    const query = 'SELECT * FROM assignment_submissions WHERE assignment_id = $1 AND student_id = $2';
    const result = await this.pool.query<AssignmentSubmissionRow>(query, [assignmentId, studentId]);
    return result.rows.length > 0 ? rowToSubmission(result.rows[0]) : null;
  }

  async update(id: string, data: Partial<AssignmentCreateInput>): Promise<Assignment | null> {
    const updates: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (data.title !== undefined) {
      updates.push(`title = $${paramIndex++}`);
      values.push(data.title);
    }
    if (data.description !== undefined) {
      updates.push(`description = $${paramIndex++}`);
      values.push(data.description);
    }
    if (data.instructions !== undefined) {
      updates.push(`instructions = $${paramIndex++}`);
      values.push(data.instructions || null);
    }
    if (data.dueDate !== undefined) {
      updates.push(`due_date = $${paramIndex++}`);
      values.push(data.dueDate || null);
    }
    if (data.maxScore !== undefined) {
      updates.push(`max_score = $${paramIndex++}`);
      values.push(data.maxScore);
    }
    if (data.passingScore !== undefined) {
      updates.push(`passing_score = $${paramIndex++}`);
      values.push(data.passingScore || null);
    }
    if (data.isRequired !== undefined) {
      updates.push(`is_required = $${paramIndex++}`);
      values.push(data.isRequired);
    }
    if (data.order !== undefined) {
      updates.push(`"order" = $${paramIndex++}`);
      values.push(data.order);
    }

    if (updates.length === 0) {
      return this.findById(id);
    }

    // Validate passing score if maxScore is being updated
    if (data.maxScore !== undefined || data.passingScore !== undefined) {
      const assignment = await this.findById(id);
      if (assignment) {
        const newMaxScore = data.maxScore ?? assignment.maxScore;
        const newPassingScore = data.passingScore ?? assignment.passingScore;
        if (newPassingScore !== undefined && newPassingScore > newMaxScore) {
          throw new Error(`Passing score (${newPassingScore}) cannot exceed maximum score (${newMaxScore})`);
        }
      }
    }

    updates.push(`updated_at = CURRENT_TIMESTAMP`);
    values.push(id);

    const query = `
      UPDATE assignments
      SET ${updates.join(', ')}
      WHERE id = $${paramIndex}
      RETURNING *
    `;

    const result = await this.pool.query<AssignmentRow>(query, values);
    return result.rows.length > 0 ? rowToAssignment(result.rows[0]) : null;
  }

  async delete(id: string): Promise<boolean> {
    const query = 'DELETE FROM assignments WHERE id = $1';
    const result = await this.pool.query(query, [id]);
    return result.rowCount !== null && result.rowCount > 0;
  }

  async updateSubmission(
    submissionId: string,
    data: {
      submissionText?: string;
      submissionFiles?: string[];
      status?: 'pending' | 'submitted' | 'graded' | 'returned';
    }
  ): Promise<AssignmentSubmission | null> {
    const updates: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (data.submissionText !== undefined) {
      updates.push(`submission_text = $${paramIndex++}`);
      values.push(data.submissionText || null);
    }
    if (data.submissionFiles !== undefined) {
      updates.push(`submission_files = $${paramIndex++}`);
      values.push(data.submissionFiles);
    }
    if (data.status !== undefined) {
      updates.push(`status = $${paramIndex++}`);
      values.push(data.status);
      if (data.status === 'submitted' && !updates.some(u => u.includes('submitted_at'))) {
        updates.push(`submitted_at = CURRENT_TIMESTAMP`);
      }
    }

    if (updates.length === 0) {
      const query = 'SELECT * FROM assignment_submissions WHERE id = $1';
      const result = await this.pool.query<AssignmentSubmissionRow>(query, [submissionId]);
      return result.rows.length > 0 ? rowToSubmission(result.rows[0]) : null;
    }

    updates.push(`updated_at = CURRENT_TIMESTAMP`);
    values.push(submissionId);

    const query = `
      UPDATE assignment_submissions
      SET ${updates.join(', ')}
      WHERE id = $${paramIndex}
      RETURNING *
    `;

    const result = await this.pool.query<AssignmentSubmissionRow>(query, values);
    return result.rows.length > 0 ? rowToSubmission(result.rows[0]) : null;
  }

  async deleteSubmission(submissionId: string): Promise<boolean> {
    const query = 'DELETE FROM assignment_submissions WHERE id = $1';
    const result = await this.pool.query(query, [submissionId]);
    return result.rowCount !== null && result.rowCount > 0;
  }
}

