/**
 * Assignment Controller - HTTP Request Handlers
 */

import { Request, Response } from 'express';
import { AssignmentService } from '../services/assignment.service';
import { successResponse, errorResponse } from '@kodingcaravan/shared/utils/responseBuilder';

export class AssignmentController {
  constructor(private assignmentService: AssignmentService) {}

  /**
   * POST /api/assignments
   * Create assignment
   */
  createAssignment = async (req: Request, res: Response) => {
    try {
      const assignment = await this.assignmentService.createAssignment(req.body);
      return successResponse(res, {
        statusCode: 201,
        message: 'Assignment created successfully',
        data: assignment,
      });
    } catch (error: any) {
      return errorResponse(res, {
        statusCode: 500,
        message: error.message || 'Failed to create assignment',
      });
    }
  };

  /**
   * GET /api/assignments/course/:courseId
   * Get assignments for a course
   */
  getCourseAssignments = async (req: Request, res: Response) => {
    try {
      const { courseId } = req.params;
      if (!courseId) {
        return errorResponse(res, { statusCode: 400, message: 'Course ID is required' });
      }
      const assignments = await this.assignmentService.getCourseAssignments(courseId);
      return successResponse(res, {
        message: 'Assignments retrieved successfully',
        data: assignments,
      });
    } catch (error: any) {
      return errorResponse(res, {
        statusCode: 500,
        message: error.message || 'Failed to retrieve assignments',
      });
    }
  };

  /**
   * GET /api/assignments/:id
   * Get assignment by ID
   */
  getAssignmentById = async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      if (!id) {
        return errorResponse(res, { statusCode: 400, message: 'Assignment ID is required' });
      }
      const assignment = await this.assignmentService.getAssignmentById(id);
      if (!assignment) {
        return errorResponse(res, { statusCode: 404, message: 'Assignment not found' });
      }
      return successResponse(res, {
        message: 'Assignment retrieved successfully',
        data: assignment,
      });
    } catch (error: any) {
      return errorResponse(res, {
        statusCode: 500,
        message: error.message || 'Failed to retrieve assignment',
      });
    }
  };

  /**
   * POST /api/assignments/:id/submit
   * Submit assignment
   */
  submitAssignment = async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      if (!id) {
        return errorResponse(res, { statusCode: 400, message: 'Assignment ID is required' });
      }
      const studentId = (req as any).user?.id || (req as any).user?.userId;
      if (!studentId) {
        return errorResponse(res, { statusCode: 401, message: 'Unauthorized' });
      }

      const submission = await this.assignmentService.submitAssignment({
        assignmentId: id,
        studentId,
        ...req.body,
      });

      return successResponse(res, {
        statusCode: 201,
        message: 'Assignment submitted successfully',
        data: submission,
      });
    } catch (error: any) {
      return errorResponse(res, {
        statusCode: error.statusCode || 500,
        message: error.message || 'Failed to submit assignment',
      });
    }
  };

  /**
   * POST /api/assignments/submissions/:id/grade
   * Grade assignment submission
   */
  gradeSubmission = async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      if (!id) {
        return errorResponse(res, { statusCode: 400, message: 'Submission ID is required' });
      }
      const { score, feedback } = req.body;

      if (!score || score < 0) {
        return errorResponse(res, {
          statusCode: 400,
          message: 'Valid score is required',
        });
      }

      const submission = await this.assignmentService.gradeAssignment(id, score, feedback);
      if (!submission) {
        return errorResponse(res, { statusCode: 404, message: 'Submission not found' });
      }

      return successResponse(res, {
        message: 'Assignment graded successfully',
        data: submission,
      });
    } catch (error: any) {
      return errorResponse(res, {
        statusCode: 500,
        message: error.message || 'Failed to grade assignment',
      });
    }
  };

  /**
   * GET /api/assignments/:id/submissions
   * Get all submissions for an assignment
   */
  getSubmissions = async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      if (!id) {
        return errorResponse(res, { statusCode: 400, message: 'Assignment ID is required' });
      }
      const submissions = await this.assignmentService.getSubmissions(id);
      return successResponse(res, {
        message: 'Submissions retrieved successfully',
        data: submissions,
      });
    } catch (error: any) {
      return errorResponse(res, {
        statusCode: 500,
        message: error.message || 'Failed to retrieve submissions',
      });
    }
  };

  /**
   * GET /api/assignments/:id/submissions/student/:studentId
   * Get student's submission for an assignment
   */
  getStudentSubmission = async (req: Request, res: Response) => {
    try {
      const { id, studentId } = req.params;
      if (!id || !studentId) {
        return errorResponse(res, { statusCode: 400, message: 'Assignment ID and Student ID are required' });
      }
      const submission = await this.assignmentService.getStudentSubmission(id, studentId);
      if (!submission) {
        return errorResponse(res, { statusCode: 404, message: 'Submission not found' });
      }
      return successResponse(res, {
        message: 'Submission retrieved successfully',
        data: submission,
      });
    } catch (error: any) {
      return errorResponse(res, {
        statusCode: 500,
        message: error.message || 'Failed to retrieve submission',
      });
    }
  };
}

