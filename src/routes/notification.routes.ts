import { Router } from 'express';
import { NotificationController } from '../controllers/notification.controller';
import { authenticate } from '../middlewares/auth.middleware';

const router = Router();

router.use(authenticate);

// In-app Notification list
router.get('/', NotificationController.getNotifications);

// System Push Notification Routes
router.get('/push/status', NotificationController.getPushStatus);
router.get('/push/vapid-key', NotificationController.getVapidPublicKey);
router.post('/push/subscribe', NotificationController.subscribePush);
router.post('/push/unsubscribe', NotificationController.unsubscribePush);
router.post('/push/test', NotificationController.sendTestPush);

export default router;
