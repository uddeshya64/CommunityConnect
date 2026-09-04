import { Server, Socket } from "socket.io";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export function setupQuizSockets(io: Server) {
  const quizNamespace = io.of("/quiz");

  quizNamespace.on("connection", (socket: Socket) => {
    console.log(`[Quiz Socket] Client connected: ${socket.id}`);

    // Join a quiz session
    socket.on("join_quiz", async ({ quizId, userId }) => {
      try {
        const idNum = Number(quizId);
        const userNum = Number(userId);
        console.log(`[Quiz Socket] User ${userNum} joining quiz ${idNum}`);
        const roomName = `quiz_${idNum}`;
        socket.join(roomName);

        quizNamespace.to(roomName).emit("user_joined", { userId: userNum });
        
        const session = await prisma.quizSession.findFirst({
          where: { quiz_id: idNum }
        });

        if (session?.status === "COMPLETED") {
          const finalLeaderboard = await prisma.quizLeaderboard.findMany({
            where: { quiz_id: idNum },
            orderBy: { score: 'desc' },
            take: 5,
            include: { user: { select: { name: true } } }
          });
          socket.emit("quiz_ended", {
            quizId: idNum,
            message: "The live activity session has concluded.",
            leaderboard: finalLeaderboard
          });
          return;
        }
        
        if (session && session.status === "IN_PROGRESS" && session.current_question) {
          const question = await prisma.question.findUnique({
            where: { id: session.current_question },
            include: {
              options: {
                select: { id: true, text: true }
              }
            }
          });
          socket.emit("quiz_state", { status: "IN_PROGRESS", question });
        } else {
          socket.emit("quiz_state", { status: "WAITING" });
        }
      } catch (err) {
        console.error("[Quiz Socket] join_quiz error:", err);
      }
    });

    // Start quiz (Organizer only)
    socket.on("start_quiz", async ({ quizId }) => {
      try {
        const idNum = Number(quizId);
        console.log(`[Quiz Socket] Starting quiz ${idNum}`);
        const roomName = `quiz_${idNum}`;
        
        const quiz = await prisma.quiz.findUnique({
          where: { id: idNum }
        });

        // Create or update session
        const session = await prisma.quizSession.create({
          data: {
            quiz_id: idNum,
            status: "IN_PROGRESS",
            started_at: new Date()
          }
        });
        
        // Broadcast to ALL connected participants on the site so popup appears
        quizNamespace.emit("quiz_started", { 
          sessionId: session.id, 
          quizId: idNum, 
          eventId: quiz?.event_id 
        });
      } catch (err) {
        console.error("[Quiz Socket] start_quiz error:", err);
      }
    });

    // Next question (Organizer only)
    socket.on("next_question", async ({ quizId, questionId }) => {
      try {
        const idNum = Number(quizId);
        const qNum = Number(questionId);
        const roomName = `quiz_${idNum}`;
        console.log(`[Quiz Socket] Next question ${qNum} for quiz ${idNum}`);
        
        const question = await prisma.question.findUnique({
          where: { id: qNum },
          include: {
            options: {
              select: { id: true, text: true }
            }
          }
        });
        
        await prisma.quizSession.updateMany({
          where: { quiz_id: idNum, status: "IN_PROGRESS" },
          data: { current_question: qNum }
        });

        quizNamespace.to(roomName).emit("new_question", { question });
      } catch (err) {
        console.error("[Quiz Socket] next_question error:", err);
      }
    });

    // End question and show leaderboard (Organizer only)
    socket.on("end_question", async ({ quizId, questionId }) => {
      try {
        const idNum = Number(quizId);
        const qNum = Number(questionId);
        const roomName = `quiz_${idNum}`;
        
        const leaderboard = await prisma.quizLeaderboard.findMany({
          where: { quiz_id: idNum },
          orderBy: { score: 'desc' },
          take: 5,
          include: { user: { select: { name: true } } }
        });
        
        quizNamespace.to(roomName).emit("question_ended", { questionId: qNum, leaderboard });
      } catch (err) {
        console.error("[Quiz Socket] end_question error:", err);
      }
    });

    // End Entire Quiz Session (Organizer only)
    socket.on("end_quiz", async ({ quizId }) => {
      try {
        const idNum = Number(quizId);
        console.log(`[Quiz Socket] Ending quiz session for quiz ${idNum}`);
        const roomName = `quiz_${idNum}`;
        
        await prisma.quizSession.updateMany({
          where: { quiz_id: idNum, status: "IN_PROGRESS" },
          data: { status: "COMPLETED", ended_at: new Date() }
        });

        await prisma.quiz.updateMany({
          where: { id: idNum },
          data: { status: "COMPLETED" }
        });

        const finalLeaderboard = await prisma.quizLeaderboard.findMany({
          where: { quiz_id: idNum },
          orderBy: { score: 'desc' },
          take: 5,
          include: { user: { select: { name: true } } }
        });

        quizNamespace.to(roomName).emit("quiz_ended", {
          quizId: idNum,
          message: "The host has ended this live activity session.",
          leaderboard: finalLeaderboard
        });
      } catch (err) {
        console.error("[Quiz Socket] end_quiz error:", err);
      }
    });
    
    // Submit answer (Participant)
    socket.on("submit_answer", async ({ quizId, questionId, optionId, userId, timeTaken }) => {
      try {
        const idNum = Number(quizId);
        const qNum = Number(questionId);
        const optNum = Number(optionId);
        const userNum = Number(userId);

        const question = await prisma.question.findUnique({
          where: { id: qNum },
          include: { options: true }
        });
        
        if (!question) return;
        
        const option = question.options.find(o => o.id === optNum);
        let pointsAwarded = 0;
        
        if (option && option.is_correct) {
          const maxTime = question.time_limit || 30;
          const timeRatio = Math.max(0, (maxTime - (Number(timeTaken) || 0)) / maxTime);
          pointsAwarded = Math.round((question.points / 2) + (question.points / 2) * timeRatio);
        }
        
        if (userNum && !isNaN(userNum)) {
          await prisma.quizResponse.create({
            data: {
              user_id: userNum,
              question_id: qNum,
              option_id: optNum,
              points_awarded: pointsAwarded,
              time_taken: Number(timeTaken) || 0
            }
          });
          
          const board = await prisma.quizLeaderboard.findUnique({
            where: { quiz_id_user_id: { quiz_id: idNum, user_id: userNum } }
          });
          
          if (board) {
            await prisma.quizLeaderboard.update({
              where: { id: board.id },
              data: { score: board.score + pointsAwarded }
            });
          } else {
            await prisma.quizLeaderboard.create({
              data: { quiz_id: idNum, user_id: userNum, score: pointsAwarded }
            });
          }
        }
        
        socket.emit("answer_result", { correct: option?.is_correct || false, points: pointsAwarded });
      } catch (error) {
        console.error("[Quiz Socket] Error saving response:", error);
      }
    });

    socket.on("disconnect", () => {
      console.log(`[Quiz Socket] Client disconnected: ${socket.id}`);
    });
  });
}
