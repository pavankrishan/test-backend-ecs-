import type { TrainerOverview, TrainerSummary } from '../services/trainer.service';
import type { TrainerDocument } from '../models/trainerDocuments.model';
import type { TrainerLocation } from '../models/trainerLocation.model';

export function formatTrainerList(payload: { data: TrainerSummary[]; total: number; page: number; limit: number }) {
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

export function formatTrainerOverview(overview: TrainerOverview) {
  return {
    profile: overview.profile,
    performance: overview.performance,
    documents: overview.documents,
    location: overview.location,
  };
}

export function formatDocuments(documents: TrainerDocument[]) {
  return {
    items: documents,
    total: documents.length,
  };
}

export function formatLocation(location: TrainerLocation | null) {
  return location
    ? {
        ...location,
        coordinates: {
          lat: location.latitude,
          lng: location.longitude,
        },
      }
    : null;
}

