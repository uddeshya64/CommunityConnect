import { Router } from 'express';
import { EventController } from '../controllers/event.controller';
import { authenticate, optionalAuthenticate } from '../middlewares/auth.middleware';
import { EventManageController } from '../controllers/eventManage.controller'
import { requirePermission } from '../middlewares/requirePermission.middleware';
import { EventTimelineController } from '../controllers/eventTimeline.controller';

import upload from "../middlewares/upload";


const router = Router();

// Public Routes (Feed & Details)
// Note: apply 'authenticate' optionally to 'getOne' if your middleware supports optional auth, 
// OR just handle the "no token" case in middleware to not crash but leave req.user undefined.
router.get('/types', optionalAuthenticate, EventController.getTypes);
router.get('/saved', authenticate, EventController.getSaved);
router.get('/contributed', authenticate, EventController.getContributedEvents);
router.get('/', optionalAuthenticate, EventController.getFeed);
router.post( "/:eventId/banner",authenticate, upload.single("banner"),EventController.uploadBanner); // banner image in event
router.post('/:id/save', authenticate, EventController.save);
router.delete('/:id/save', authenticate, EventController.unsave);
router.get('/:id', optionalAuthenticate, EventController.getOne);

router.get('/:eventId/timelines', optionalAuthenticate, EventTimelineController.getByEvent);

// ^ If you want guest users to view events, ensure your 'authenticate' middleware 
// doesn't block requests without tokens, or create a specific 'optionalAuth' middleware.

router.get('/:eventId/manage/overview', authenticate, EventManageController.getOverview);
router.get('/:eventId/manage/participants', authenticate, requirePermission(['MANAGE_ATTENDEES', 'MANAGE_CHECK_IN']), EventManageController.getParticipants);

// Protected Routes (Create, Update, Delete)
router.post('/', authenticate, EventController.create);
router.patch(
  '/:id',
  authenticate,
  upload.none(),
  EventController.update
);
router.delete('/:id', authenticate, EventController.delete);

// Timeline (Agenda) management routes
router.post('/:eventId/timelines', authenticate, requirePermission(['MANAGE_EVENT']), EventTimelineController.create);
router.put('/:eventId/timelines/:timelineId', authenticate, requirePermission(['MANAGE_EVENT']), EventTimelineController.update);
router.delete('/:eventId/timelines/:timelineId', authenticate, requirePermission(['MANAGE_EVENT']), EventTimelineController.delete);

export default router;