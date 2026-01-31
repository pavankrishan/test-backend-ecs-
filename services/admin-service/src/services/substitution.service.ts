import { AppError } from '@kodingcaravan/shared';
import logger from '@kodingcaravan/shared/config/logger';
import { getPool } from '../config/database';
import type { Pool } from 'pg';

// Import substitution model types and repository
// Note: We'll define the repository inline to avoid cross-service dependencies
interface CreateSubstitutionInput {
  sessionDate: Date;
  originalTrainerId: string;
  substituteTrainerId: string;
  studentId: string;
}

interface TrainerSessionSubstitution {
  id: string;
  sessionDate: Date;
  originalTrainerId: string;
  substituteTrainerId: string;
  studentId: string;
  createdAt: Date;
}

class TrainerSessionSubstitutionRepository {
  constructor(private pool: Pool) {}

  async create(input: CreateSubstitutionInput): Promise<TrainerSessionSubstitution> {
    const dayOfWeek = new Date(input.sessionDate).getDay();
    if (dayOfWeek === 0) {
      throw new Error('Substitutions cannot be scheduled on Sundays');
    }

    const result = await this.pool.query(
      `
        INSERT INTO trainer_session_substitutions (
          session_date,
          original_trainer_id,
          substitute_trainer_id,
          student_id,
          created_at
        )
        VALUES ($1, $2, $3, $4, NOW())
        ON CONFLICT (session_date, original_trainer_id, student_id) 
        DO UPDATE SET
          substitute_trainer_id = EXCLUDED.substitute_trainer_id,
          created_at = NOW()
        RETURNING *
      `,
      [input.sessionDate, input.originalTrainerId, input.substituteTrainerId, input.studentId]
    );

    return this.mapRow(result.rows[0]);
  }

  async findById(id: string): Promise<TrainerSessionSubstitution | null> {
    const result = await this.pool.query(
      `SELECT * FROM trainer_session_substitutions WHERE id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return null;
    }

    return this.mapRow(result.rows[0]);
  }

  async findByDateRange(
    trainerId: string,
    startDate: Date,
    endDate: Date,
    options?: { asSubstitute?: boolean }
  ): Promise<TrainerSessionSubstitution[]> {
    let query = `
      SELECT * FROM trainer_session_substitutions
      WHERE session_date BETWEEN $1 AND $2
    `;
    const params: any[] = [startDate, endDate];

    if (options?.asSubstitute) {
      query += ` AND substitute_trainer_id = $3`;
      params.push(trainerId);
    } else {
      query += ` AND original_trainer_id = $3`;
      params.push(trainerId);
    }

    query += ` ORDER BY session_date DESC`;

    const result = await this.pool.query(query, params);
    return result.rows.map((row) => this.mapRow(row));
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.pool.query(
      `DELETE FROM trainer_session_substitutions WHERE id = $1`,
      [id]
    );

    return (result.rowCount ?? 0) > 0;
  }

  private mapRow(row: any): TrainerSessionSubstitution {
    return {
      id: row.id,
      sessionDate: new Date(row.session_date),
      originalTrainerId: row.original_trainer_id,
      substituteTrainerId: row.substitute_trainer_id,
      studentId: row.student_id,
      createdAt: new Date(row.created_at),
    };
  }
}

export class SubstitutionService {
  private pool = getPool();
  private substitutionRepo: TrainerSessionSubstitutionRepository;

  constructor() {
    this.substitutionRepo = new TrainerSessionSubstitutionRepository(this.pool);
  }

  /**
   * Create a session substitution
   * Validates that it's a working day and trainers/student exist
   */
  async createSubstitution(
    input: CreateSubstitutionInput,
    adminId: string
  ): Promise<any> {
    // Validate it's a working day
    const dayOfWeek = new Date(input.sessionDate).getDay();
    if (dayOfWeek === 0) {
      throw new AppError('Substitutions cannot be scheduled on Sundays (holidays)', 400);
    }

    // Validate trainers are different
    if (input.originalTrainerId === input.substituteTrainerId) {
      throw new AppError('Original trainer and substitute trainer must be different', 400);
    }

    // Validate student has active allocation with original trainer
    const allocationCheck = await this.pool.query(
      `
        SELECT id FROM trainer_student_allocations
        WHERE trainer_id = $1
          AND student_id = $2
          AND start_date <= $3
          AND (end_date IS NULL OR end_date >= $3)
        LIMIT 1
      `,
      [input.originalTrainerId, input.studentId, input.sessionDate]
    );

    if (allocationCheck.rows.length === 0) {
      throw new AppError(
        'Student does not have an active allocation with the original trainer on this date',
        400
      );
    }

    // Check if substitution already exists
    const existing = await this.pool.query(
      `
        SELECT id FROM trainer_session_substitutions
        WHERE session_date = $1
          AND original_trainer_id = $2
          AND student_id = $3
      `,
      [input.sessionDate, input.originalTrainerId, input.studentId]
    );

    if (existing.rows.length > 0) {
      // Update existing substitution
      const result = await this.pool.query(
        `
          UPDATE trainer_session_substitutions
          SET substitute_trainer_id = $1,
              created_at = NOW()
          WHERE id = $2
          RETURNING *
        `,
        [input.substituteTrainerId, existing.rows[0].id]
      );
      return this.mapSubstitutionRow(result.rows[0]);
    }

    // Create new substitution
    const substitution = await this.substitutionRepo.create(input);
    
    // Emit SESSION_SUBSTITUTED event
    try {
      const { getEventBus } = await import('@kodingcaravan/shared/events/eventBus');
      const eventBus = getEventBus();
      
      // Get session info if available
      const sessionResult = await this.pool.query(
        `SELECT id, scheduled_time FROM tutoring_sessions 
         WHERE trainer_id = $1 AND student_id = $2 AND DATE(scheduled_date) = $3
         LIMIT 1`,
        [input.originalTrainerId, input.studentId, input.sessionDate]
      );
      
      const sessionId = sessionResult.rows[0]?.id || '';
      const timeSlot = sessionResult.rows[0]?.scheduled_time || '4:00 PM';
      
      await eventBus.emit({
        type: 'SESSION_SUBSTITUTED',
        timestamp: Date.now(),
        userId: adminId,
        role: 'admin',
        sessionId,
        originalTrainerId: input.originalTrainerId,
        substituteTrainerId: input.substituteTrainerId,
        studentId: input.studentId,
        date: input.sessionDate.toISOString().split('T')[0],
        timeSlot,
        metadata: {
          createdBy: adminId,
        },
      });
    } catch (error: any) {
      console.error('[Substitution Service] Failed to emit SESSION_SUBSTITUTED event (non-critical):', error?.message);
    }
    
    return this.mapSubstitutionRow(substitution);
  }

  /**
   * Get substitutions for a trainer
   */
  async getTrainerSubstitutions(
    trainerId: string,
    startDate: Date,
    endDate: Date,
    options?: { asSubstitute?: boolean }
  ): Promise<any[]> {
    const substitutions = await this.substitutionRepo.findByDateRange(
      trainerId,
      startDate,
      endDate,
      options
    );

    // Enrich with trainer and student names (batch fetch to avoid N+1)
    if (substitutions.length === 0) {
      return [];
    }

    // Extract unique IDs for batch fetching
    const trainerIds = [...new Set([
      ...substitutions.map(s => s.originalTrainerId).filter(Boolean),
      ...substitutions.map(s => s.substituteTrainerId).filter(Boolean),
    ])];
    const studentIds = [...new Set(substitutions.map(s => s.studentId).filter(Boolean))];

    // Batch fetch trainers
    const trainersMap = new Map<string, { name: string }>();
    if (trainerIds.length > 0) {
      try {
        const trainersResult = await this.pool.query<{ id: string; name: string }>(
          'SELECT id, name FROM trainers WHERE id = ANY($1::uuid[])',
          [trainerIds]
        );
        trainersResult.rows.forEach(row => trainersMap.set(row.id, { name: row.name }));
      } catch (error: any) {
        logger.warn('Failed to batch fetch trainers for substitutions', {
          error: error?.message || String(error),
          trainerIdsCount: trainerIds.length,
          service: 'admin-service',
        });
      }
    }

    // Batch fetch students
    const studentsMap = new Map<string, { name: string }>();
    if (studentIds.length > 0) {
      try {
        const studentsResult = await this.pool.query<{ id: string; name: string }>(
          'SELECT id, name FROM students WHERE id = ANY($1::uuid[])',
          [studentIds]
        );
        studentsResult.rows.forEach(row => studentsMap.set(row.id, { name: row.name }));
      } catch (error: any) {
        logger.warn('Failed to batch fetch students for substitutions', {
          error: error?.message || String(error),
          studentIdsCount: studentIds.length,
          service: 'admin-service',
        });
      }
    }

    // Enrich substitutions with batch-fetched data
    const enriched = substitutions.map((sub) => {
      const originalTrainer = trainersMap.get(sub.originalTrainerId) || { name: 'Unknown' };
      const substituteTrainer = trainersMap.get(sub.substituteTrainerId) || { name: 'Unknown' };
      const student = studentsMap.get(sub.studentId) || { name: 'Unknown' };

      return {
        id: sub.id,
        sessionDate: sub.sessionDate.toISOString().split('T')[0],
        originalTrainerId: sub.originalTrainerId,
        originalTrainerName: originalTrainer.name,
        substituteTrainerId: sub.substituteTrainerId,
        substituteTrainerName: substituteTrainer.name,
        studentId: sub.studentId,
        studentName: student.name,
        createdAt: sub.createdAt.toISOString(),
      };
    });

    return enriched;
  }

  /**
   * Delete a substitution
   */
  async deleteSubstitution(substitutionId: string): Promise<boolean> {
    return this.substitutionRepo.delete(substitutionId);
  }

  /**
   * Get substitution by ID
   */
  async getSubstitutionById(substitutionId: string): Promise<any | null> {
    const substitution = await this.substitutionRepo.findById(substitutionId);
    if (!substitution) {
      return null;
    }

    // Enrich with names
    const [originalTrainer, substituteTrainer, student] = await Promise.all([
      this.pool.query('SELECT name FROM trainers WHERE id = $1', [substitution.originalTrainerId]),
      this.pool.query('SELECT name FROM trainers WHERE id = $1', [substitution.substituteTrainerId]),
      this.pool.query('SELECT name FROM students WHERE id = $1', [substitution.studentId]),
    ]);

    return {
      id: substitution.id,
      sessionDate: substitution.sessionDate.toISOString().split('T')[0],
      originalTrainerId: substitution.originalTrainerId,
      originalTrainerName: originalTrainer.rows[0]?.name || 'Unknown',
      substituteTrainerId: substitution.substituteTrainerId,
      substituteTrainerName: substituteTrainer.rows[0]?.name || 'Unknown',
      studentId: substitution.studentId,
      studentName: student.rows[0]?.name || 'Unknown',
      createdAt: substitution.createdAt.toISOString(),
    };
  }

  private mapSubstitutionRow(row: any): any {
    return {
      id: row.id,
      sessionDate: row.sessionDate instanceof Date 
        ? row.sessionDate.toISOString().split('T')[0]
        : new Date(row.session_date).toISOString().split('T')[0],
      originalTrainerId: row.originalTrainerId || row.original_trainer_id,
      substituteTrainerId: row.substituteTrainerId || row.substitute_trainer_id,
      studentId: row.studentId || row.student_id,
      createdAt: row.createdAt instanceof Date 
        ? row.createdAt.toISOString()
        : new Date(row.created_at).toISOString(),
    };
  }
}

