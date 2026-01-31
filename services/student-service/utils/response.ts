import type { StudentOverview, StudentSummary } from '../services/student.service';
import type { RescheduleRequest } from '../models/reschedule.model';
import type { ProjectSubmission } from '../models/projectSubmission.model';

export function buildStudentOverviewResponse(overview: StudentOverview) {
  return {
    account: overview.account,
    profile: overview.profile,
    stats: overview.stats,
    progress: overview.progress,
    submissions: overview.submissions,
    certificates: overview.certificates,
  };
}

export function buildStudentListResponse(payload: {
  data: StudentSummary[];
  total: number;
  page: number;
  limit: number;
}) {
  return {
    items: payload.data,
    pagination: {
      total: payload.total,
      page: payload.page,
      limit: payload.limit,
      pages: Math.ceil(payload.total / Math.max(payload.limit, 1)),
    },
  };
}

export function buildRescheduleListResponse(payload: {
  data: RescheduleRequest[];
  total: number;
  page: number;
  limit: number;
}) {
  return {
    items: payload.data,
    pagination: {
      total: payload.total,
      page: payload.page,
      limit: payload.limit,
      pages: Math.ceil(payload.total / Math.max(payload.limit, 1)),
    },
  };
}

export function buildProjectListResponse(payload: ProjectSubmission[]) {
  return {
    items: payload,
    total: payload.length,
  };
}

