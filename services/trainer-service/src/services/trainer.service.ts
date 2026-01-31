import type { Pool } from 'pg';
import {
  TrainerProfileRepository,
  type TrainerProfile,
  type TrainerProfileInput,
} from '../models/trainerProfile.model';
import {
  TrainerPerformanceRepository,
  type TrainerPerformance,
  type PerformanceUpdateInput,
} from '../models/trainerPerformance.model';
import { TrainerDocumentsRepository, type TrainerDocument } from '../models/trainerDocuments.model';
import { TrainerLocationRepository, type TrainerLocation } from '../models/trainerLocation.model';
import {
  TrainerBaseLocationRepository,
  type TrainerBaseLocation,
} from '../models/trainerBaseLocation.model';

export interface TrainerListOptions {
  search?: string;
  specialties?: string[];
  verified?: boolean;
  limit?: number;
  page?: number;
}

export interface TrainerSummary {
  trainerId: string;
  fullName: string | null;
  bio: string | null;
  specialties: string[] | null;
  ratingAverage: number | null;
  totalReviews: number;
  verified: boolean;
  yearsOfExperience: number | null;
  hourlyRate: number | null;
  activeStudents: number;
  completedSessions: number;
  city: string | null;
  state: string | null;
  country: string | null;
  available: boolean;
}

export interface TrainerOverview {
  profile: TrainerProfile | null;
  performance: TrainerPerformance | null;
  documents: TrainerDocument[];
  location: TrainerLocation | null;
}

export class TrainerService {
  constructor(
    private readonly profileRepo: TrainerProfileRepository,
    private readonly performanceRepo: TrainerPerformanceRepository,
    private readonly documentsRepo: TrainerDocumentsRepository,
    private readonly locationRepo: TrainerLocationRepository,
    private readonly baseLocationRepo: TrainerBaseLocationRepository,
    private readonly pool: Pool,
  ) {}

  async upsertProfile(trainerId: string, input: TrainerProfileInput): Promise<TrainerProfile> {
    return this.profileRepo.upsert(trainerId, input);
  }

  async updatePerformance(trainerId: string, updates: PerformanceUpdateInput): Promise<TrainerPerformance> {
    return this.performanceRepo.upsert(trainerId, updates);
  }

  async incrementSessions(
    trainerId: string,
    payload: { completedIncrement?: number; cancelledIncrement?: number },
  ): Promise<TrainerPerformance> {
    return this.performanceRepo.incrementSessions(trainerId, payload);
  }

  async getOverview(trainerId: string): Promise<TrainerOverview> {
    const [profile, performance, documents, location] = await Promise.all([
      this.profileRepo.getByTrainerId(trainerId),
      this.performanceRepo.getByTrainerId(trainerId),
      this.documentsRepo.listByTrainer(trainerId),
      this.locationRepo.getByTrainer(trainerId),
    ]);

    return {
      profile,
      performance,
      documents,
      location,
    };
  }

  async listTrainers(options: TrainerListOptions = {}): Promise<{ data: TrainerSummary[]; page: number; limit: number; total: number }> {
    const limit = Math.min(Math.max(options.limit ?? 20, 1), 100);
    const page = Math.max(options.page ?? 1, 1);
    const offset = (page - 1) * limit;

    const rows = await this.pool.query<TrainerSummary>(
      `
        SELECT
          tp.trainer_id AS "trainerId",
          tp.full_name AS "fullName",
          tp.bio,
          tp.specialties,
          tp.rating_average AS "ratingAverage",
          tp.total_reviews AS "totalReviews",
          tp.verified,
          tp.years_of_experience AS "yearsOfExperience",
          tp.hourly_rate AS "hourlyRate",
          coalesce(tt.active_students, 0) AS "activeStudents",
          coalesce(tt.completed_sessions, 0) AS "completedSessions",
          tl.city,
          tl.state,
          tl.country,
          coalesce(tl.available, false) AS "available"
        FROM trainer_profiles tp
        LEFT JOIN trainer_performance tt ON tt.trainer_id = tp.trainer_id
        LEFT JOIN trainer_locations tl ON tl.trainer_id = tp.trainer_id
        WHERE ($1::text IS NULL OR LOWER(coalesce(tp.full_name, '')) LIKE LOWER($1))
          AND ($2::text[] IS NULL OR tp.specialties && $2::text[])
          AND ($3::boolean IS NULL OR tp.verified = $3)
        ORDER BY tp.created_at DESC
        LIMIT $4 OFFSET $5
      `,
      [
        options.search ? `%${options.search}%` : null,
        options.specialties && options.specialties.length ? options.specialties : null,
        typeof options.verified === 'boolean' ? options.verified : null,
        limit,
        offset,
      ],
    );

    const countResult = await this.profileRepo.count({
      search: options.search,
      specialties: options.specialties,
      verified: options.verified,
    });

    return {
      data: rows.rows,
      page,
      limit,
      total: countResult,
    };
  }

  /**
   * Confirm trainer location via GPS + map pin
   * WHY: Store exact, trainer-confirmed location after approval
   * 
   * RULES:
   * - Trainer must be approved (checked in controller)
   * - Coordinates must be valid
   * - Replaces any existing base location (geocoded or previous GPS confirmation)
   */
  async confirmLocation(
    trainerId: string,
    latitude: number,
    longitude: number,
    accuracy: number | null
  ): Promise<TrainerBaseLocation> {
    // Validate trainer is approved
    const trainerResult = await this.pool.query(
      `SELECT approval_status FROM trainers WHERE id = $1`,
      [trainerId]
    );

    if (trainerResult.rows.length === 0) {
      throw new Error('Trainer not found');
    }

    const approvalStatus = trainerResult.rows[0].approval_status;
    if (approvalStatus !== 'approved') {
      throw new Error('Trainer must be approved before confirming location');
    }

    // Confirm location
    return this.baseLocationRepo.confirmLocation(trainerId, latitude, longitude, accuracy);
  }

  /**
   * Check if trainer has confirmed location
   * WHY: Used for navigation gating - block access until location confirmed
   */
  async hasConfirmedLocation(trainerId: string): Promise<boolean> {
    return this.baseLocationRepo.hasConfirmedLocation(trainerId);
  }

  /**
   * Get trainer's base location
   * WHY: Check location status and details
   */
  async getBaseLocation(trainerId: string): Promise<TrainerBaseLocation | null> {
    return this.baseLocationRepo.getByTrainerId(trainerId);
  }
}

