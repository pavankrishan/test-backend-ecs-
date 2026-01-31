import { TrainerDocumentsRepository, type TrainerDocument, type TrainerDocumentInput, type TrainerDocumentUpdateInput } from '../models/trainerDocuments.model';
import { TrainerProfileRepository } from '../models/trainerProfile.model';

export class VerificationService {
  constructor(
    private readonly documentsRepo: TrainerDocumentsRepository,
    private readonly profileRepo: TrainerProfileRepository,
  ) {}

  async submitDocument(input: TrainerDocumentInput): Promise<TrainerDocument> {
    return this.documentsRepo.create(input);
  }

  async updateDocument(id: string, updates: TrainerDocumentUpdateInput): Promise<TrainerDocument | null> {
    const updated = await this.documentsRepo.update(id, updates);

    if (updated && (updates.status === 'approved' || updates.status === 'rejected')) {
      const documents = await this.documentsRepo.listByTrainer(updated.trainerId);
      const allApproved = documents.every((doc) => doc.status === 'approved');
      if (allApproved) {
        await this.profileRepo.upsert(updated.trainerId, { verified: true });
      }
    }

    return updated;
  }

  async getDocument(id: string): Promise<TrainerDocument | null> {
    return this.documentsRepo.findById(id);
  }

  async listTrainerDocuments(trainerId: string): Promise<TrainerDocument[]> {
    return this.documentsRepo.listByTrainer(trainerId);
  }

  async listPending(limit = 50): Promise<TrainerDocument[]> {
    return this.documentsRepo.listPending(limit);
  }
}

