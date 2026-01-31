import { Router } from 'express';
import type { Router as ExpressRouter } from 'express';
import { ReviewController } from '../controllers/review.controller';
import { requireUserAuth } from '../middlewares/requireUserAuth';

const router: ExpressRouter = Router();

// Student review submission
router.post(
	'/students/sessions/:sessionId/review',
	requireUserAuth,
	ReviewController.submitStudentReview
);

// Trainer review submission (legacy endpoint for compatibility)
router.post(
	'/students/:studentId/courses/:courseId/sessions/:sessionId/review',
	requireUserAuth,
	ReviewController.submitTrainerReview
);

// Get session reviews
router.get(
	'/sessions/:sessionId/reviews',
	requireUserAuth,
	ReviewController.getSessionReviews
);

// Get trainer reviews
router.get(
	'/trainers/:trainerId/reviews',
	requireUserAuth,
	ReviewController.getTrainerReviews
);

// Get trainer rating statistics
router.get(
	'/trainers/:trainerId/rating-stats',
	requireUserAuth,
	ReviewController.getTrainerRatingStats
);

// Get student reviews
router.get(
	'/students/:studentId/reviews',
	requireUserAuth,
	ReviewController.getStudentReviews
);

export default router;

