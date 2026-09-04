import express from "express";
import { createQuiz, getQuizzes, addQuestion, startQuiz, deleteQuiz, deleteQuestion, getActiveQuiz } from "../controllers/quiz.controller";
import { authenticate } from "../middlewares/auth.middleware";

const router = express.Router({ mergeParams: true });

// Protect all quiz routes
router.use(authenticate);

// /api/events/:eventId/quizzes
router.post("/", createQuiz);
router.get("/", getQuizzes);
router.get("/active", getActiveQuiz);

// /api/events/:eventId/quizzes/:quizId
router.delete("/:quizId", deleteQuiz);

// /api/events/:eventId/quizzes/:quizId/questions
router.post("/:quizId/questions", addQuestion);

// /api/events/:eventId/quizzes/:quizId/questions/:questionId
router.delete("/:quizId/questions/:questionId", deleteQuestion);

// /api/events/:eventId/quizzes/:quizId/start
router.post("/:quizId/start", startQuiz);

export default router;
