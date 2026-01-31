import { TrainerLocationRepository, type TrainerLocation, type TrainerLocationInput } from '../models/trainerLocation.model';
import type { TrainerProfileRepository } from '../models/trainerProfile.model';
import { isWithinRadius, normalizeCoordinate } from '../utils/location';

export interface FleetSearchOptions {
  latitude?: number;
  longitude?: number;
  radiusKm?: number;
  city?: string;
  state?: string;
  country?: string;
  limit?: number;
  page?: number;
}

export class FleetService {
  constructor(
    private readonly locationRepo: TrainerLocationRepository,
    private readonly profileRepo: TrainerProfileRepository,
  ) {}

  async upsertLocation(input: TrainerLocationInput): Promise<TrainerLocation> {
    const payload: TrainerLocationInput = {
      ...input,
      latitude: normalizeCoordinate(input.latitude),
      longitude: normalizeCoordinate(input.longitude),
    };
    return this.locationRepo.upsertLocation(payload);
  }

  async getLocation(trainerId: string): Promise<TrainerLocation | null> {
    return this.locationRepo.getByTrainer(trainerId);
  }

  async listAvailable(options: FleetSearchOptions = {}): Promise<{ data: TrainerLocation[]; page: number; limit: number; total: number }> {
    const limit = Math.min(Math.max(options.limit ?? 20, 1), 100);
    const page = Math.max(options.page ?? 1, 1);
    const offset = (page - 1) * limit;

    const locations = await this.locationRepo.listAvailable({
      city: options.city,
      state: options.state,
      country: options.country,
      limit,
      offset,
    });

    let filtered = locations;

    if (
      typeof options.latitude === 'number' &&
      typeof options.longitude === 'number' &&
      typeof options.radiusKm === 'number'
    ) {
      filtered = locations.filter((location) => {
        const radius = location.serviceRadiusKm ?? options.radiusKm ?? 0;
        return isWithinRadius(
          { latitude: location.latitude, longitude: location.longitude },
          { latitude: options.latitude!, longitude: options.longitude! },
          radius > 0 ? radius : options.radiusKm!,
        );
      });
    }

    return {
      data: filtered,
      page,
      limit,
      total: filtered.length,
    };
  }
}

