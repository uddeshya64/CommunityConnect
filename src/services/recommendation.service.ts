import { PrismaClient, AgendaStatus } from '@prisma/client';
import { CalendarSyncService } from './calendarSync.service';

function getPrisma(): PrismaClient {
  return new PrismaClient();
}

// Common English stopwords to remove during keyword extraction
const STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'is', 'are', 'was', 'were', 'in', 'on',
  'at', 'by', 'for', 'with', 'about', 'to', 'from', 'of', 'how', 'what', 'why',
  'this', 'that', 'these', 'those', 'it', 'its', 'into', 'with', 'using', 'build'
]);

/**
 * Tokenize and normalize text into word frequency vectors
 */
function extractTermFrequencies(text: string): Map<string, number> {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9+#\s-]/g, ' ')
    .split(/\s+/)
    .filter(word => word.length > 1 && !STOP_WORDS.has(word));

  const tfMap = new Map<string, number>();
  for (const word of words) {
    tfMap.set(word, (tfMap.get(word) || 0) + 1);
  }
  return tfMap;
}

/**
 * Calculate Cosine Similarity between two text strings (0.0 to 1.0)
 */
export function calculateTextSimilarity(text1: string, text2: string): number {
  if (!text1 || !text2) return 0;

  const tf1 = extractTermFrequencies(text1);
  const tf2 = extractTermFrequencies(text2);

  if (tf1.size === 0 || tf2.size === 0) return 0;

  let dotProduct = 0;
  let magnitude1 = 0;
  let magnitude2 = 0;

  for (const [, count] of tf1) {
    magnitude1 += count * count;
  }
  magnitude1 = Math.sqrt(magnitude1);

  for (const [word, count] of tf2) {
    magnitude2 += count * count;
    if (tf1.has(word)) {
      dotProduct += (tf1.get(word)! * count);
    }
  }
  magnitude2 = Math.sqrt(magnitude2);

  if (magnitude1 === 0 || magnitude2 === 0) return 0;

  return Math.min(1.0, dotProduct / (magnitude1 * magnitude2));
}

export class RecommendationService {
  /**
   * Generates personal agenda recommendations for a user registering for an event
   * Saves ALL session suggestions and checks for external Google Calendar time conflicts
   */
  static async generatePersonalAgenda(userId: number, eventId: number) {
    const db = getPrisma();

    // 1. Fetch User Profile
    const user = await db.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        skills: true,
        bio: true,
        profession: true
      }
    });

    if (!user) {
      throw new Error(`User with ID ${userId} not found`);
    }

    // 2. Fetch Event & Timelines (Sessions)
    const event = await db.event.findUnique({
      where: { id: eventId },
      include: {
        type: true,
        timelines: {
          orderBy: { start_time: 'asc' }
        }
      }
    });

    if (!event || !event.timelines || event.timelines.length === 0) {
      return [];
    }

    // 3. Compute exact date range covering all event timelines with buffer
    let minTime = event.start_date ? new Date(event.start_date).getTime() : Date.now();
    let maxTime = event.end_date ? new Date(event.end_date).getTime() : Date.now();

    event.timelines.forEach(t => {
      const tStart = new Date(t.start_time).getTime();
      const tEnd = t.end_time ? new Date(t.end_time).getTime() : tStart + 3600000;
      if (tStart < minTime) minTime = tStart;
      if (tEnd > maxTime) maxTime = tEnd;
    });

    // Add +1 day buffer to rangeStart and rangeEnd to prevent UTC/time zone truncation
    const rangeStart = new Date(minTime - 86400000);
    const rangeEnd = new Date(maxTime + 86400000);

    let externalEvents: any[] = [];
    try {
      externalEvents = await CalendarSyncService.fetchExternalGoogleCalendarEvents(
        userId,
        rangeStart,
        rangeEnd
      );
    } catch (e) {
      console.warn('[CALENDAR_SYNC_WARN] Could not fetch external events:', e);
    }

    // 4. Build User Skills & Interest Vector Corpus with weighted skill tags
    const userSkillsList = (user.skills || []).map(s => s.trim().toLowerCase());
    const userProfileCorpus = [
      ...userSkillsList,
      ...userSkillsList, // double weight for user skill tags
      user.bio || '',
      user.profession || ''
    ].join(' ');

    // 5. Score each timeline session using NLP Skill Tag Vector & Cosine Similarity
    const scoredSessions = event.timelines.map(session => {
      const timelineTags: string[] = Array.isArray((session as any).tags)
        ? (session as any).tags
        : (typeof (session as any).tags === 'string' ? [(session as any).tags] : []);

      const sessionCorpus = [
        session.title,
        session.description || '',
        session.speaker_name || '',
        session.location || '',
        event.title || '',
        event.type?.name || '',
        ...timelineTags,
        ...timelineTags // double weight explicit timeline tags for vector scoring
      ].join(' ');

      let similarityScore = calculateTextSimilarity(userProfileCorpus, sessionCorpus);

      // Extract matched skill tags between user profile and session text / timeline tags
      const matchedSkillTags = userSkillsList.filter(skill => 
        skill.length > 1 && (
          sessionCorpus.toLowerCase().includes(skill) ||
          timelineTags.some(t => String(t).toLowerCase().includes(skill))
        )
      );

      // Include explicit session tags that match user skills or general tags
      timelineTags.forEach(t => {
        const tagStr = String(t).trim();
        if (tagStr && !matchedSkillTags.includes(tagStr)) {
          const isUserSkill = userSkillsList.some(s => s.includes(tagStr.toLowerCase()) || tagStr.toLowerCase().includes(s));
          if (isUserSkill) {
            matchedSkillTags.push(tagStr);
          }
        }
      });

      // Check ALL external Google Calendar time conflicts
      const sessionStart = new Date(session.start_time).getTime();
      const sessionEnd = session.end_time
        ? new Date(session.end_time).getTime()
        : sessionStart + 3600000;

      const externalConflicts = externalEvents.filter(ext => {
        const extStart = new Date(ext.start).getTime();
        const extEnd = new Date(ext.end).getTime();
        return sessionStart < extEnd && sessionEnd > extStart;
      });

      const externalConflict = externalConflicts.length > 0 ? externalConflicts[0] : null;

      if (externalConflicts.length > 0) {
        similarityScore = Math.max(0.05, similarityScore - 0.3);
      }

      // Boost score if direct skill tag match exists
      if (matchedSkillTags.length > 0) {
        similarityScore = Math.min(1.0, similarityScore + 0.25);
      }

      // Scaled base score
      const normalizedScore = Number((0.35 + (similarityScore * 0.63)).toFixed(2));

      return {
        session,
        score: normalizedScore,
        matchedSkillTags,
        externalConflicts,
        externalConflict
      };
    });

    // 6. Save ALL session suggestions in DB safely using Prisma ORM or Fallback Raw SQL
    let userAgendas: any[] = [];

    if ((db as any).userAgenda) {
      userAgendas = await Promise.all(
        scoredSessions.map(async item => {
          return (db as any).userAgenda.upsert({
            where: {
              user_id_timeline_id: {
                user_id: userId,
                timeline_id: item.session.id
              }
            },
            create: {
              user_id: userId,
              event_id: eventId,
              timeline_id: item.session.id,
              status: AgendaStatus.RECOMMENDED || 'RECOMMENDED',
              match_score: item.score
            },
            update: {
              match_score: item.score
            },
            include: {
              timeline: true,
              event: {
                select: {
                  id: true,
                  title: true,
                  start_date: true,
                  end_date: true,
                  location: true
                }
              }
            }
          });
        })
      );
    } else {
      // Fallback Raw SQL if Prisma client in memory has not reloaded
      for (const item of scoredSessions) {
        await db.$executeRawUnsafe(
          `INSERT INTO user_agendas (user_id, event_id, timeline_id, status, match_score, created_at)
           VALUES ($1, $2, $3, 'RECOMMENDED'::"AgendaStatus", $4, NOW())
           ON CONFLICT (user_id, timeline_id)
           DO UPDATE SET match_score = $4;`,
          userId,
          eventId,
          item.session.id,
          item.score
        );
      }

      userAgendas = await db.$queryRawUnsafe(
        `SELECT ua.*, 
                json_build_object('id', et.id, 'title', et.title, 'description', et.description, 'speaker_name', et.speaker_name, 'start_time', et.start_time, 'end_time', et.end_time, 'location', et.location, 'tags', et.tags) as timeline,
                json_build_object('id', e.id, 'title', e.title, 'start_date', e.start_date, 'end_date', e.end_date, 'location', e.location) as event
         FROM user_agendas ua
         JOIN event_timelines et ON ua.timeline_id = et.id
         JOIN events e ON ua.event_id = e.id
         WHERE ua.user_id = $1 AND ua.event_id = $2
         ORDER BY et.start_time ASC;`,
        userId,
        eventId
      );
    }

    // Attach externalConflicts & matchedSkillTags details to returned response
    return userAgendas.map(agenda => {
      const scored = scoredSessions.find(s => s.session.id === agenda.timeline_id);
      return {
        ...agenda,
        matchedSkillTags: scored?.matchedSkillTags || [],
        externalConflicts: scored?.externalConflicts || []
      };
    });
  }

  /**
   * Retrieve User Personal Agenda across all registered events
   */
  static async getUserAgenda(userId: number) {
    const db = getPrisma();
    let agendas: any[] = [];

    if ((db as any).userAgenda) {
      agendas = await (db as any).userAgenda.findMany({
        where: { user_id: userId },
        include: {
          timeline: true,
          event: {
            select: {
              id: true,
              title: true,
              start_date: true,
              end_date: true,
              location: true,
              banner_url: true
            }
          }
        },
        orderBy: {
          timeline: {
            start_time: 'asc'
          }
        }
      });
    } else {
      agendas = await db.$queryRawUnsafe(
        `SELECT ua.*, 
                json_build_object('id', et.id, 'title', et.title, 'description', et.description, 'speaker_name', et.speaker_name, 'start_time', et.start_time, 'end_time', et.end_time, 'location', et.location, 'tags', et.tags) as timeline,
                json_build_object('id', e.id, 'title', e.title, 'start_date', e.start_date, 'end_date', e.end_date, 'location', e.location, 'banner_url', e.banner_url) as event
         FROM user_agendas ua
         JOIN event_timelines et ON ua.timeline_id = et.id
         JOIN events e ON ua.event_id = e.id
         WHERE ua.user_id = $1
         ORDER BY et.start_time ASC;`,
        userId
      );
    }

    return agendas;
  }

  /**
   * Update Agenda Item Status (ACCEPT / DECLINE preferred session)
   */
  static async updateAgendaStatus(userId: number, agendaId: number, status: AgendaStatus) {
    const db = getPrisma();

    if ((db as any).userAgenda) {
      const targetAgenda = await (db as any).userAgenda.findUnique({
        where: { id: agendaId },
        include: { timeline: true }
      });

      if (!targetAgenda || targetAgenda.user_id !== userId) {
        throw new Error("Agenda item not found or unauthorized");
      }

      if (status === (AgendaStatus.ACCEPTED || 'ACCEPTED')) {
        const targetStart = new Date(targetAgenda.timeline.start_time).getTime();
        const targetEnd = targetAgenda.timeline.end_time
          ? new Date(targetAgenda.timeline.end_time).getTime()
          : targetStart + 3600000;

        const userEventAgendas = await (db as any).userAgenda.findMany({
          where: {
            user_id: userId,
            event_id: targetAgenda.event_id,
            id: { not: agendaId }
          },
          include: { timeline: true }
        });

        const overlappingAgendaIds = userEventAgendas
          .filter((item: any) => {
            const startB = new Date(item.timeline.start_time).getTime();
            const endB = item.timeline.end_time
              ? new Date(item.timeline.end_time).getTime()
              : startB + 3600000;
            return targetStart < endB && targetEnd > startB;
          })
          .map((item: any) => item.id);

        if (overlappingAgendaIds.length > 0) {
          await (db as any).userAgenda.updateMany({
            where: { id: { in: overlappingAgendaIds } },
            data: { status: AgendaStatus.DECLINED || 'DECLINED' }
          });
        }
      }

      return (db as any).userAgenda.update({
        where: { id: agendaId },
        data: { status },
        include: {
          timeline: true,
          event: true
        }
      });
    }

    // Fallback Raw SQL
    await db.$executeRawUnsafe(
      `UPDATE user_agendas SET status = $1::"AgendaStatus" WHERE id = $2 AND user_id = $3;`,
      status,
      agendaId,
      userId
    );

    const rows: any[] = await db.$queryRawUnsafe(
      `SELECT ua.*, 
              json_build_object('id', et.id, 'title', et.title, 'description', et.description, 'speaker_name', et.speaker_name, 'start_time', et.start_time, 'end_time', et.end_time, 'location', et.location, 'tags', et.tags) as timeline,
              json_build_object('id', e.id, 'title', e.title, 'start_date', e.start_date, 'end_date', e.end_date, 'location', e.location) as event
       FROM user_agendas ua
       JOIN event_timelines et ON ua.timeline_id = et.id
       JOIN events e ON ua.event_id = e.id
       WHERE ua.id = $1;`,
      agendaId
    );
    return rows[0];
  }
}
