/**
 * Assignment Service - Business Logic
 */

import { AssignmentRepository, Assignment, AssignmentSubmission } from '../models/assignment.model';

export class AssignmentService {
  constructor(private assignmentRepo: AssignmentRepository) {}

  async createAssignment(data: {
    courseId: string;
    title: string;
    description: string;
    instructions?: string;
    dueDate?: Date;
    maxScore: number;
    passingScore?: number;
    isRequired?: boolean;
    order?: number;
  }): Promise<Assignment> {
    return this.assignmentRepo.create(data);
  }

  async getCourseAssignments(courseId: string): Promise<Assignment[]> {
    return this.assignmentRepo.findByCourseId(courseId);
  }

  async getAssignmentById(id: string): Promise<Assignment | null> {
    return this.assignmentRepo.findById(id);
  }

  async submitAssignment(data: {
    assignmentId: string;
    studentId: string;
    courseId: string;
    submissionText?: string;
    submissionFiles?: string[];
  }): Promise<AssignmentSubmission> {
    // Check if already submitted
    const existing = await this.assignmentRepo.getSubmissionByStudent(
      data.assignmentId,
      data.studentId
    );

    if (existing) {
      if (existing.status === 'submitted' || existing.status === 'graded') {
        throw new Error('Assignment already submitted');
      }
      // Update existing pending submission
      const updated = await this.assignmentRepo.updateSubmission(existing.id, {
        submissionText: data.submissionText,
        submissionFiles: data.submissionFiles,
        status: 'submitted',
      });
      return updated || existing;
    }

    // Create new submission and mark as submitted
    const submission = await this.assignmentRepo.createSubmission(data);
    const updated = await this.assignmentRepo.updateSubmission(submission.id, {
      status: 'submitted',
    });
    return updated || submission;
  }

  async gradeAssignment(
    submissionId: string,
    score: number,
    feedback?: string
  ): Promise<AssignmentSubmission | null> {
    const submission = await this.assignmentRepo.gradeSubmission(submissionId, score, feedback);
    return submission;
  }

  async updateAssignment(
    id: string,
    data: {
      title?: string;
      description?: string;
      instructions?: string;
      dueDate?: Date;
      maxScore?: number;
      passingScore?: number;
      isRequired?: boolean;
      order?: number;
    }
  ): Promise<Assignment | null> {
    return this.assignmentRepo.update(id, data);
  }

  async deleteAssignment(id: string): Promise<boolean> {
    return this.assignmentRepo.delete(id);
  }

  async updateSubmission(
    submissionId: string,
    data: {
      submissionText?: string;
      submissionFiles?: string[];
      status?: 'pending' | 'submitted' | 'graded' | 'returned';
    }
  ): Promise<AssignmentSubmission | null> {
    return this.assignmentRepo.updateSubmission(submissionId, data);
  }

  async deleteSubmission(submissionId: string): Promise<boolean> {
    return this.assignmentRepo.deleteSubmission(submissionId);
  }

  async getSubmissions(assignmentId: string): Promise<AssignmentSubmission[]> {
    return this.assignmentRepo.getSubmissionsByAssignment(assignmentId);
  }

  async getStudentSubmission(
    assignmentId: string,
    studentId: string
  ): Promise<AssignmentSubmission | null> {
    return this.assignmentRepo.getSubmissionByStudent(assignmentId, studentId);
  }
}

