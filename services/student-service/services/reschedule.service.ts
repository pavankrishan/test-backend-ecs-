import type { Pool } from 'pg';

import {
  RescheduleRepository,
  type RescheduleRequest,
  type RescheduleCreateInput,
  type RescheduleUpdateInput,
  type RescheduleStatus,
  type RescheduleStatusUpdate,
} from '../models/reschedule.model';

export interface RescheduleListOptions {
  status?: RescheduleStatus;
  studentId?: string;
  courseId?: string;
  limit?: number;
  page?: number;
}

export class RescheduleService {
  constructor(private readonly repository: RescheduleRepository, private readonly pool: Pool) {}

  async createRequest(input: RescheduleCreateInput): Promise<RescheduleRequest> {
    return this.repository.create(input);
  }

  async updateRequest(id: string, updates: RescheduleUpdateInput): Promise<RescheduleRequest | null> {
    return this.repository.update(id, updates);
  }

  async updateStatus(id: string, update: RescheduleStatusUpdate): Promise<RescheduleRequest | null> {
    return this.repository.updateStatus(id, update);
  }

  async getRequest(id: string): Promise<RescheduleRequest | null> {
    return this.repository.findById(id);
  }

  async listRequests(options: RescheduleListOptions = {}): Promise<{ data: RescheduleRequest[]; total: number; page: number; limit: number }> {
    const limit = Math.min(Math.max(options.limit ?? 20, 1), 100);
    const page = Math.max(options.page ?? 1, 1);
    const offset = (page - 1) * limit;

    const [data, total] = await Promise.all([
      this.repository.list(
        {
          status: options.status,
          studentId: options.studentId,
          courseId: options.courseId,
          limit,
          offset,
        },
        undefined,
      ),
      this.repository.count(
        {
          status: options.status,
          studentId: options.studentId,
          courseId: options.courseId,
        },
        undefined,
      ),
    ]);

    return {
      data,
      total,
      page,
      limit,
    };
  }
}

