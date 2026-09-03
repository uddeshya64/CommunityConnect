import { Router } from 'express';
import { AnnouncementController } from '../controllers/announcement.controller';
import { authenticate, optionalAuthenticate } from '../middlewares/auth.middleware';
import { requirePermission } from '../middlewares/requirePermission.middleware';

const router = Router({ mergeParams: true });

router.get('/', optionalAuthenticate, AnnouncementController.getAnnouncements);
router.post('/', authenticate, requirePermission(['MANAGE_COMMUNICATIONS', 'MANAGE_EVENT']), AnnouncementController.createAnnouncement);
router.post('/:announcementId/react', authenticate, AnnouncementController.toggleReaction);
router.delete('/:announcementId', authenticate, AnnouncementController.deleteAnnouncement);

export default router;
