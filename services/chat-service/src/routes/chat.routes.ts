import { Router } from 'express';
import type { ChatController } from '../controllers/chat.controller';

export function createChatRoutes(chatController: ChatController): Router {
  const router = Router();

  router.post('/messages', chatController.sendMessage);
  router.get('/messages/:messageId', chatController.getMessage);
  router.delete('/messages/:messageId', chatController.deleteMessage);

  router.get('/conversations', chatController.listUserConversations);
  router.get('/conversations/:conversationId/messages', chatController.getConversationMessages);
  router.patch('/conversations/:conversationId/read', chatController.markConversationRead);

  return router;
}

