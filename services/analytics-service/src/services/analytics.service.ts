import { Types, type PipelineStage } from 'mongoose';
import { Analytics, type IAnalytics } from '../models/analytics.model';

export type RecordEventInput = {
  eventType: string;
  userId: string;
  courseId?: string | null;
  metadata?: Record<string, unknown> | null;
  timestamp?: string | Date;
};

export type BulkRecordEventInput = RecordEventInput[];

export type EventFilters = {
  eventTypes?: string[];
  userId?: string;
  courseId?: string;
  startDate?: string | Date;
  endDate?: string | Date;
  page?: number;
  limit?: number;
};

export type EventTypeMetricsOptions = {
  eventTypes?: string[];
  startDate?: string | Date;
  endDate?: string | Date;
  limit?: number;
};

export type TopCoursesOptions = {
  eventType?: string;
  startDate?: string | Date;
  endDate?: string | Date;
  limit?: number;
};

export type TrendInterval = 'hour' | 'day' | 'week';

export type TrendOptions = {
  eventType?: string;
  startDate?: string | Date;
  endDate?: string | Date;
  interval?: TrendInterval;
};

export class AnalyticsService {
  async recordEvent(input: RecordEventInput): Promise<IAnalytics> {
    const doc = await Analytics.create({
      eventType: input.eventType,
      userId: this.toObjectId(input.userId),
      courseId: input.courseId ? this.toObjectId(input.courseId) : undefined,
      metadata: input.metadata ?? {},
      timestamp: input.timestamp ? new Date(input.timestamp) : new Date(),
    });
    return doc;
  }

  async bulkRecordEvents(events: BulkRecordEventInput): Promise<number> {
    if (!events.length) {
      return 0;
    }

    const payload = events.map((event) => ({
      eventType: event.eventType,
      userId: this.toObjectId(event.userId),
      courseId: event.courseId ? this.toObjectId(event.courseId) : undefined,
      metadata: event.metadata ?? {},
      timestamp: event.timestamp ? new Date(event.timestamp) : new Date(),
    }));

    const inserted = await Analytics.insertMany(payload, { ordered: false });
    return inserted.length;
  }

  async listEvents(filters: EventFilters): Promise<{
    items: IAnalytics[];
    page: number;
    limit: number;
    total: number;
  }> {
    const limit = Math.min(Math.max(filters.limit ?? 25, 1), 100);
    const page = Math.max(filters.page ?? 1, 1);
    const skip = (page - 1) * limit;

    const query: Record<string, unknown> = {};

    if (filters.eventTypes?.length) {
      query.eventType = { $in: filters.eventTypes };
    }
    if (filters.userId) {
      query.userId = this.toObjectId(filters.userId);
    }
    if (filters.courseId) {
      query.courseId = this.toObjectId(filters.courseId);
    }

    const timestampQuery: Record<string, Date> = {};
    if (filters.startDate) {
      timestampQuery.$gte = new Date(filters.startDate);
    }
    if (filters.endDate) {
      timestampQuery.$lte = new Date(filters.endDate);
    }
    if (Object.keys(timestampQuery).length) {
      query.timestamp = timestampQuery;
    }

    const [items, total] = await Promise.all([
      Analytics.find(query).sort({ timestamp: -1 }).skip(skip).limit(limit).exec(),
      Analytics.countDocuments(query).exec(),
    ]);

    return {
      items,
      page,
      limit,
      total,
    };
  }

  async getEventTypeMetrics(options: EventTypeMetricsOptions) {
    const match: Record<string, unknown> = {};

    if (options.eventTypes?.length) {
      match.eventType = { $in: options.eventTypes };
    }
    if (options.startDate || options.endDate) {
      match.timestamp = {};
      if (options.startDate) {
        (match.timestamp as Record<string, Date>).$gte = new Date(options.startDate);
      }
      if (options.endDate) {
        (match.timestamp as Record<string, Date>).$lte = new Date(options.endDate);
      }
    }

    const pipeline: Record<string, unknown>[] = [];

    if (Object.keys(match).length) {
      pipeline.push({ $match: match });
    }

    pipeline.push(
      {
        $group: {
          _id: '$eventType',
          count: { $sum: 1 },
          users: { $addToSet: '$userId' },
          lastOccurredAt: { $max: '$timestamp' },
        },
      },
      {
        $project: {
          eventType: '$_id',
          count: 1,
          uniqueUsers: { $size: '$users' },
          lastOccurredAt: 1,
          _id: 0,
        },
      },
      { $sort: { count: -1 } },
    );

    if (options.limit) {
      pipeline.push({ $limit: options.limit });
    }

    const results = await Analytics.aggregate(pipeline as unknown as PipelineStage[]).exec();
    return results;
  }

  async getTopCourses(options: TopCoursesOptions) {
    const match: Record<string, unknown> = {
      courseId: { $ne: null },
    };

    if (options.eventType) {
      match.eventType = options.eventType;
    }
    if (options.startDate || options.endDate) {
      match.timestamp = {};
      if (options.startDate) {
        (match.timestamp as Record<string, Date>).$gte = new Date(options.startDate);
      }
      if (options.endDate) {
        (match.timestamp as Record<string, Date>).$lte = new Date(options.endDate);
      }
    }

    const pipeline: Record<string, unknown>[] = [
      { $match: match },
      {
        $group: {
          _id: '$courseId',
          count: { $sum: 1 },
          users: { $addToSet: '$userId' },
          lastOccurredAt: { $max: '$timestamp' },
        },
      },
      {
        $project: {
          courseId: '$_id',
          count: 1,
          uniqueUsers: { $size: '$users' },
          lastOccurredAt: 1,
          _id: 0,
        },
      },
      { $sort: { count: -1 } },
      { $limit: Math.min(options.limit ?? 10, 50) },
    ];

    const results = await Analytics.aggregate(pipeline as unknown as PipelineStage[]).exec();
    return results;
  }

  async getEventTrends(options: TrendOptions) {
    const match: Record<string, unknown> = {};
    if (options.eventType) {
      match.eventType = options.eventType;
    }
    if (options.startDate || options.endDate) {
      match.timestamp = {};
      if (options.startDate) {
        (match.timestamp as Record<string, Date>).$gte = new Date(options.startDate);
      }
      if (options.endDate) {
        (match.timestamp as Record<string, Date>).$lte = new Date(options.endDate);
      }
    }

    const interval = options.interval ?? 'day';
    const dateExpression =
      interval === 'hour'
        ? {
            $dateTrunc: {
              date: '$timestamp',
              unit: 'hour',
            },
          }
        : interval === 'week'
        ? {
            $dateTrunc: {
              date: '$timestamp',
              unit: 'week',
              binSize: 1,
            },
          }
        : {
            $dateTrunc: {
              date: '$timestamp',
              unit: 'day',
            },
          };

    const pipeline: Record<string, unknown>[] = [];
    if (Object.keys(match).length) {
      pipeline.push({ $match: match });
    }

    pipeline.push(
      {
        $group: {
          _id: dateExpression,
          count: { $sum: 1 },
          uniqueUsers: { $addToSet: '$userId' },
        },
      },
      {
        $project: {
          bucket: '$_id',
          count: 1,
          uniqueUsers: { $size: '$uniqueUsers' },
          _id: 0,
        },
      },
      { $sort: { bucket: 1 } },
    );

    const results = await Analytics.aggregate(pipeline as unknown as PipelineStage[]).exec();
    return results;
  }

  async getUserTimeline(userId: string, options: { limit?: number; cursor?: string }) {
    const limit = Math.min(Math.max(options.limit ?? 50, 1), 100);
    const query: Record<string, unknown> = {
      userId: this.toObjectId(userId),
    };

    if (options.cursor) {
      const cursorDate = new Date(options.cursor);
      if (!Number.isNaN(cursorDate.getTime())) {
        query.timestamp = { $lt: cursorDate };
      }
    }

    const events = await Analytics.find(query)
      .sort({ timestamp: -1 })
      .limit(limit)
      .exec();

    const nextCursor = events.length === limit ? events[events.length - 1].timestamp.toISOString() : null;

    return {
      items: events,
      nextCursor,
    };
  }

  private toObjectId(value: string | Types.ObjectId): Types.ObjectId {
    if (value instanceof Types.ObjectId) {
      return value;
    }
    if (!Types.ObjectId.isValid(value)) {
      throw new Error(`Invalid ObjectId: ${value}`);
    }
    return new Types.ObjectId(value);
  }
}

