import { Response } from 'express';
import { z } from 'zod';
import { asyncHandler } from '@kodingcaravan/shared/utils/asyncHandler';
import type { ZodRequest } from '@kodingcaravan/shared/types/zodRequest';
import { ChatService } from '../services/chat.service';
import { successResponse, errorResponse } from '../utils/response';

const sendMessageSchemaBase = z.object({
  conversationId: z.string().length(24).optional(),
  senderId: z.string().length(24),
  recipientIds: z.array(z.string().length(24)).min(1),
  content: z.string().max(5000).nullable().optional(),
  type: z.enum(['text', 'system', 'image', 'video', 'audio', 'file']).optional(),
  metadata: z.record(z.any()).nullable().optional(),
  attachments: z
    .array(
      z.object({
        url: z.string().url(),
        type: z.enum(['image', 'video', 'audio', 'file']).optional(),
        size: z.number().int().positive().optional(),
        mimeType: z.string().optional(),
        metadata: z.record(z.any()).nullable().optional(),
      }),
    )
    .optional(),
});

const sendMessageSchema = sendMessageSchemaBase.superRefine((data, ctx) => {
  if (!data.content && (!data.attachments || data.attachments.length === 0)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Either content or attachments must be provided.',
      path: ['content'],
    });
  }
});

const conversationMessagesQuerySchema = z.object({
  conversationId: z.string().length(24),
  limit: z.coerce.number().int().positive().optional(),
  cursor: z.string().optional(),
});

const conversationListQuerySchema = z.object({
  userId: z.string().length(24),
  limit: z.coerce.number().int().positive().optional(),
  page: z.coerce.number().int().positive().optional(),
});

const messageIdParamsSchema = z.object({
  messageId: z.string().length(24),
});

const conversationIdParamsSchema = z.object({
  conversationId: z.string().length(24),
});

const markReadBodySchema = z.object({
  userId: z.string().length(24),
});

type SendMessageRequest = ZodRequest<{ body: typeof sendMessageSchemaBase }>;
type ConversationMessagesRequest = ZodRequest<{ params: typeof conversationIdParamsSchema; query: typeof conversationMessagesQuerySchema }>;
type ConversationListRequest = ZodRequest<{ query: typeof conversationListQuerySchema }>;
type MarkReadRequest = ZodRequest<{ params: typeof conversationIdParamsSchema; body: typeof markReadBodySchema }>;
type MessageIdRequest = ZodRequest<{ params: typeof messageIdParamsSchema }>;

export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  sendMessage = asyncHandler(async (req: SendMessageRequest, res: Response) => {
    const body = sendMessageSchema.parse(req.body);

    try {
      const message = await this.chatService.sendMessage(body);
      return successResponse(res, {
        statusCode: 201,
        message: 'Message sent successfully',
        data: this.chatService.formatMessage(message),
      });
    } catch (error: any) {
      return errorResponse(res, {
        statusCode: 400,
        message: error.message ?? 'Failed to send message',
      });
    }
  });

  getMessage = asyncHandler(async (req: MessageIdRequest, res: Response) => {
    const { messageId } = messageIdParamsSchema.parse(req.params);
    const message = await this.chatService.getMessageById(messageId);
    if (!message) {
      return errorResponse(res, { statusCode: 404, message: 'Message not found' });
    }

    return successResponse(res, {
      message: 'Message fetched successfully',
      data: this.chatService.formatMessage(message),
    });
  });

  getConversationMessages = asyncHandler(async (req: ConversationMessagesRequest, res: Response) => {
    const { conversationId } = conversationIdParamsSchema.parse(req.params);
    const { limit, cursor } = conversationMessagesQuerySchema.parse(req.query);

    const result = await this.chatService.getConversationMessages({
      conversationId,
      limit,
      cursor,
    });

    return successResponse(res, {
      message: 'Conversation messages fetched successfully',
      data: {
        items: result.items.map((message) => this.chatService.formatMessage(message)),
        nextCursor: result.nextCursor,
      },
    });
  });

  listUserConversations = asyncHandler(async (req: ConversationListRequest, res: Response) => {
    const { userId, limit, page } = conversationListQuerySchema.parse(req.query);
    const result = await this.chatService.listUserConversations({
      userId,
      limit,
      page,
    });

    return successResponse(res, {
      message: 'Conversations fetched successfully',
      data: {
        items: result.items.map((item) => ({
          conversationId: item.conversationId,
          participants: item.participants,
          unreadCount: item.unreadCount,
          updatedAt: item.updatedAt,
          lastMessage: item.lastMessage ? this.chatService.formatMessage(item.lastMessage) : null,
        })),
        pagination: {
          total: result.total,
          page: result.page,
          limit: result.limit,
          pages: Math.ceil(result.total / Math.max(result.limit, 1)),
        },
      },
    });
  });

  markConversationRead = asyncHandler(async (req: MarkReadRequest, res: Response) => {
    const { conversationId } = conversationIdParamsSchema.parse(req.params);
    const { userId } = markReadBodySchema.parse(req.body);
    const count = await this.chatService.markConversationRead(conversationId, userId);

    return successResponse(res, {
      message: 'Conversation marked as read',
      data: {
        updatedMessages: count,
      },
    });
  });

  deleteMessage = asyncHandler(async (req: MessageIdRequest, res: Response) => {
    const { messageId } = messageIdParamsSchema.parse(req.params);
    const userId = (req.body?.userId as string | undefined) ?? (req.query?.userId as string | undefined);
    if (!userId || userId.length !== 24) {
      return errorResponse(res, {
        statusCode: 400,
        message: 'userId is required to delete a message.',
      });
    }

    try {
      const deleted = await this.chatService.deleteMessage(messageId, userId);
      if (!deleted) {
        return errorResponse(res, {
          statusCode: 404,
          message: 'Message not found',
        });
      }

      return successResponse(res, {
        message: 'Message deleted successfully',
      });
    } catch (error: any) {
      return errorResponse(res, {
        statusCode: 403,
        message: error.message ?? 'Failed to delete message',
      });
    }
  });
}

