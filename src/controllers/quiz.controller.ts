import { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// Create a new quiz
export const createQuiz = async (req: Request, res: Response): Promise<void> => {
  try {
    const eventId = Array.isArray(req.params.eventId) ? req.params.eventId[0] : req.params.eventId;
    const { title, description } = req.body;

    if (!title) {
      res.status(400).json({ success: false, message: "Quiz title is required" });
      return;
    }

    const quiz = await prisma.quiz.create({
      data: {
        event_id: parseInt(eventId),
        title,
        description,
        status: "DRAFT"
      }
    });

    res.status(201).json({ success: true, quiz });
  } catch (error: any) {
    console.error("Create quiz error:", error);
    res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
};

// Get all quizzes for an event
export const getQuizzes = async (req: Request, res: Response): Promise<void> => {
  try {
    const eventId = Array.isArray(req.params.eventId) ? req.params.eventId[0] : req.params.eventId;

    const quizzes = await prisma.quiz.findMany({
      where: { event_id: parseInt(eventId) },
      include: {
        questions: {
          include: { options: true }
        }
      },
      orderBy: { created_at: 'desc' }
    });

    res.status(200).json({ success: true, quizzes });
  } catch (error: any) {
    console.error("Get quizzes error:", error);
    res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
};

// Get currently active live quiz ONLY for events where current user is registered/staff
export const getActiveQuiz = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id || (req.user as any)?.userId;
    if (!userId) {
      res.status(200).json({ success: true, activeQuiz: null });
      return;
    }

    const userNum = Number(userId);

    // Find active quiz sessions
    const activeSession = await prisma.quizSession.findFirst({
      where: { status: "IN_PROGRESS" },
      include: {
        quiz: {
          include: {
            event: { select: { id: true, title: true } }
          }
        }
      },
      orderBy: { started_at: 'desc' }
    });

    if (activeSession && activeSession.quiz) {
      const eventId = activeSession.quiz.event_id;

      // Check if current user is registered for this event OR is creator/staff
      const [isRegistered, isStaff, isCreator] = await Promise.all([
        prisma.registration.findFirst({
          where: { event_id: eventId, user_id: userNum }
        }),
        prisma.eventUserRole.findFirst({
          where: { event_id: eventId, user_id: userNum }
        }),
        prisma.event.findFirst({
          where: { id: eventId, created_by: userNum }
        })
      ]);

      if (isRegistered || isStaff || isCreator) {
        res.status(200).json({
          success: true,
          activeQuiz: {
            sessionId: activeSession.id,
            quizId: activeSession.quiz.id,
            eventId: eventId,
            eventTitle: activeSession.quiz.event?.title || "Event",
            title: activeSession.quiz.title
          }
        });
        return;
      }
    }

    res.status(200).json({ success: true, activeQuiz: null });
  } catch (error: any) {
    console.error("Get active quiz error:", error);
    res.status(200).json({ success: true, activeQuiz: null });
  }
};

// Add a question to a quiz
export const addQuestion = async (req: Request, res: Response): Promise<void> => {
  try {
    const quizId = Array.isArray(req.params.quizId) ? req.params.quizId[0] : req.params.quizId;
    const { text, time_limit, points, options } = req.body;

    if (!text || !options || !Array.isArray(options)) {
      res.status(400).json({ success: false, message: "Question text and options array are required" });
      return;
    }

    const formattedOptions = options.map((opt: any) => ({
      text: String(opt.text || ''),
      is_correct: Boolean(opt.is_correct)
    }));

    const question = await prisma.question.create({
      data: {
        quiz_id: parseInt(quizId),
        text: String(text),
        time_limit: Number(time_limit) || 30,
        points: Number(points) || 1000,
        options: {
          create: formattedOptions
        }
      },
      include: { options: true }
    });

    res.status(201).json({ success: true, question });
  } catch (error: any) {
    console.error("Add question error:", error);
    res.status(500).json({ success: false, message: error.message || "Failed to add question" });
  }
};

// Start a quiz (Update status to LIVE & create QuizSession)
export const startQuiz = async (req: Request, res: Response): Promise<void> => {
  try {
    const quizId = Array.isArray(req.params.quizId) ? req.params.quizId[0] : req.params.quizId;
    const qIdNum = parseInt(quizId);

    const quiz = await prisma.quiz.update({
      where: { id: qIdNum },
      data: { status: "LIVE" },
      include: {
        event: { select: { id: true, title: true } }
      }
    });

    // Create session in DB if not already in progress
    let session = await prisma.quizSession.findFirst({
      where: { quiz_id: qIdNum, status: "IN_PROGRESS" }
    });

    if (!session) {
      session = await prisma.quizSession.create({
        data: {
          quiz_id: qIdNum,
          status: "IN_PROGRESS",
          started_at: new Date()
        }
      });
    }

    // Trigger push notifications asynchronously to all registered participants
    try {
      const registrations = await prisma.registration.findMany({
        where: { event_id: quiz.event_id, status: 'confirmed' },
        select: { user_id: true }
      });
      const staff = await prisma.eventUserRole.findMany({
        where: { event_id: quiz.event_id },
        select: { user_id: true }
      });

      const recipientIds = Array.from(new Set([
        ...registrations.map(r => r.user_id),
        ...staff.map(s => s.user_id)
      ]));

      const targetUrl = `/events/${quiz.event_id}/quiz/${quiz.id}`;
      const { PushService } = require('../services/push.service');

      recipientIds.forEach(userId => {
        PushService.sendPushToUser(userId, {
          title: "🎯 Live Quiz Started!",
          body: `Quiz "${quiz.title}" for event "${quiz.event.title}" is now LIVE! Click to join.`,
          icon: "/icons/icon-192x192.png",
          badge: "/icons/badge-72x72.png",
          url: targetUrl,
          tag: `live-quiz-${quiz.id}`,
          actions: [{ action: "join", title: "Join Quiz Now" }]
        }).catch((err: any) => console.error("Push notify error for user", userId, err));
      });
    } catch (pushErr) {
      console.error("Failed to queue push notifications for live quiz:", pushErr);
    }

    res.status(200).json({ success: true, quiz, sessionId: session.id });
  } catch (error: any) {
    console.error("Start quiz error:", error);
    res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
};

// Delete a quiz
export const deleteQuiz = async (req: Request, res: Response): Promise<void> => {
  try {
    const quizId = Array.isArray(req.params.quizId) ? req.params.quizId[0] : req.params.quizId;

    await prisma.quiz.delete({
      where: { id: parseInt(quizId) }
    });

    res.status(200).json({ success: true, message: "Quiz deleted successfully" });
  } catch (error: any) {
    console.error("Delete quiz error:", error);
    res.status(500).json({ success: false, message: error.message || "Failed to delete quiz" });
  }
};

// Delete a question
export const deleteQuestion = async (req: Request, res: Response): Promise<void> => {
  try {
    const questionId = Array.isArray(req.params.questionId) ? req.params.questionId[0] : req.params.questionId;

    await prisma.question.delete({
      where: { id: parseInt(questionId) }
    });

    res.status(200).json({ success: true, message: "Question deleted successfully" });
  } catch (error: any) {
    console.error("Delete question error:", error);
    res.status(500).json({ success: false, message: error.message || "Failed to delete question" });
  }
};
