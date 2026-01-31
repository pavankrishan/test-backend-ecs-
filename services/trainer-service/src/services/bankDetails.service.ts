import type { Pool } from 'pg';
import { TrainerBankDetailsRepository, type TrainerBankDetails, type TrainerBankDetailsInput } from '../models/trainerBankDetails.model';

export class BankDetailsService {
  constructor(
    private readonly bankDetailsRepo: TrainerBankDetailsRepository,
    private readonly pool: Pool
  ) {}

  async getBankDetails(trainerId: string): Promise<TrainerBankDetails | null> {
    return this.bankDetailsRepo.findByTrainerId(trainerId);
  }

  async createOrUpdateBankDetails(trainerId: string, input: Omit<TrainerBankDetailsInput, 'trainerId'>): Promise<TrainerBankDetails> {
    const existing = await this.bankDetailsRepo.findByTrainerId(trainerId);
    
    if (existing) {
      return this.bankDetailsRepo.update(trainerId, input);
    }

    return this.bankDetailsRepo.create({
      trainerId,
      ...input,
    });
  }

  async hasBankDetails(trainerId: string): Promise<boolean> {
    const details = await this.bankDetailsRepo.findByTrainerId(trainerId);
    return details !== null;
  }
}

