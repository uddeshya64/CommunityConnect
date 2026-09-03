import { Router } from 'express';
import { StaffTaskController } from '../controllers/staffTask.controller';
import { authenticate } from '../middlewares/auth.middleware';

const router = Router({ mergeParams: true });

router.use(authenticate);

router.post('/', StaffTaskController.createTask);
router.get('/', StaffTaskController.getTasks);
router.patch('/:taskId/status', StaffTaskController.updateTaskStatus);
router.delete('/:taskId', StaffTaskController.deleteTask);

export default router;
