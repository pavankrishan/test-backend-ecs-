import { Types } from 'mongoose';
import logger from '@kodingcaravan/shared/config/logger';
import { ChatMessage, type ChatMessageDocument, type MessageType } from '../models/message.model';
import { MediaAttachment, type MediaAttachmentType } from '../models/mediaAttachment.model';
import { decryptMessage, encryptMessage } from '../utils/encryption';

export type SendMessageInput = {
  conversationId?: string;
  senderId: string;
  recipientIds: string[];
  content?: string | null;
  type?: MessageType;
  metadata?: Record<string, unknown> | null;
  attachments?: Array<{
    url: string;
    type?: MediaAttachmentType;
    size?: number;
    mimeType?: string;
    metadata?: Record<string, unknown> | null;
  }>;
};

export type ConversationListOptions = {
  userId: string;
  page?: number;
  limit?: number;
};

export type ConversationMessagesOptions = {
  conversationId: string;
  limit?: number;
  cursor?: string;
};

export class ChatService {
  async sendMessage(input: SendMessageInput): Promise<ChatMessageDocument> {
    const senderId = this.toObjectId(input.senderId);
    const recipientIds = input.recipientIds.map((id) => this.toObjectId(id));
    const participants = this.toParticipants(senderId, recipientIds);

    if (!input.content && (!input.attachments || !input.attachments.length)) {
      throw new Error('Message must contain content or attachments.');
    }

    const conversationId = input.conversationId
      ? this.toObjectId(input.conversationId)
      : new Types.ObjectId();

    const encryptedContent =
      typeof input.content === 'string' && input.content.length > 0
        ? encryptMessage(input.content)
        : null;

    const message = await ChatMessage.create({
      conversationId,
      participants,
      senderId,
      content: encryptedContent,
      type: input.type ?? 'text',
      status: 'sent',
      metadata: input.metadata ?? null,
      sentAt: new Date(),
    });

    if (input.attachments?.length) {
      const attachments = await MediaAttachment.insertMany(
        input.attachments.map((attachment) => ({
          messageId: message._id,
          url: attachment.url,
          type: attachment.type ?? 'file',
          size: attachment.size,
          mimeType: attachment.mimeType,
          metadata: attachment.metadata ?? null,
        })),
      );

      message.attachments = attachments.map((attachment) => attachment._id as Types.ObjectId);
      await message.save();
    }

    await message.populate('attachments');
    return message;
  }

  async getMessageById(messageId: string): Promise<ChatMessageDocument | null> {
    const doc = await ChatMessage.findById(this.toObjectId(messageId)).populate('attachments');
    return doc;
  }

  async getConversationMessages(
    options: ConversationMessagesOptions,
  ): Promise<{ items: ChatMessageDocument[]; nextCursor: string | null }> {
    const conversationId = this.toObjectId(options.conversationId);
    const limit = Math.min(Math.max(options.limit ?? 50, 1), 100);

    const query: Record<string, unknown> = {
      conversationId,
    };

    if (options.cursor) {
      const cursorDate = new Date(options.cursor);
      if (!Number.isNaN(cursorDate.getTime())) {
        query.sentAt = { $lt: cursorDate };
      }
    }

    const messages = await ChatMessage.find(query)
      .sort({ sentAt: -1 })
      .limit(limit)
      .populate('attachments')
      .exec();

    const nextCursor = messages.length === limit ? messages[messages.length - 1].sentAt.toISOString() : null;

    return {
      items: messages.reverse(), // return ascending order
      nextCursor,
    };
  }

  async listUserConversations(
    options: ConversationListOptions,
  ): Promise<{
    items: Array<{
      conversationId: Types.ObjectId;
      participants: Types.ObjectId[];
      lastMessage: ChatMessageDocument | null;
      unreadCount: number;
      updatedAt: Date | null;
    }>;
    page: number;
    limit: number;
    total: number;
  }> {
    const userObjectId = this.toObjectId(options.userId);
    const limit = Math.min(Math.max(options.limit ?? 20, 1), 100);
    const page = Math.max(options.page ?? 1, 1);
    const skip = (page - 1) * limit;

    const aggregation = await ChatMessage.aggregate([
      {
        $match: {
          participants: userObjectId,
        },
      },
      {
        $sort: { sentAt: -1 },
      },
      {
        $group: {
          _id: '$conversationId',
          lastMessage: { $first: '$$ROOT' },
          participants: { $first: '$participants' },
          unreadCount: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $ne: ['$senderId', userObjectId] },
                    {
                      $not: {
                        $in: [userObjectId, '$readBy.userId'],
                      },
                    },
                  ],
                },
                1,
                0,
              ],
            },
          },
          updatedAt: { $first: '$sentAt' },
        },
      },
      { $skip: skip },
      { $limit: limit },
    ]);

    const totalAggregation = await ChatMessage.aggregate([
      {
        $match: {
          participants: userObjectId,
        },
      },
      {
        $group: {
          _id: '$conversationId',
        },
      },
      {
        $count: 'total',
      },
    ]);

    const total = totalAggregation[0]?.total ?? 0;

    const messageIds = aggregation.map((item: any) => item.lastMessage._id as Types.ObjectId);
    const messages = await ChatMessage.find({ _id: { $in: messageIds } })
      .populate('attachments')
      .exec();

    const messageMap = new Map<string, ChatMessageDocument>();
    messages.forEach((message) => {
      messageMap.set(String(message._id), message);
    });

    const items = aggregation.map((entry: any) => {
      const lastMessage = messageMap.get(String(entry.lastMessage._id)) ?? null;
      return {
        conversationId: entry._id,
        participants: entry.participants,
        lastMessage,
        unreadCount: entry.unreadCount,
        updatedAt: entry.updatedAt ?? lastMessage?.sentAt ?? null,
      };
    });

    return {
      items,
      page,
      limit,
      total,
    };
  }

  async markConversationRead(conversationId: string, userId: string): Promise<number> {
    const conversationObjectId = this.toObjectId(conversationId);
    const userObjectId = this.toObjectId(userId);

    const unreadMessages = await ChatMessage.find({
      conversationId: conversationObjectId,
      senderId: { $ne: userObjectId },
      'readBy.userId': { $ne: userObjectId },
    }).exec();

    const now = new Date();
    let updated = 0;

    for (const message of unreadMessages) {
      message.readBy.push({ userId: userObjectId, readAt: now });
      message.status = 'read';
      await message.save();
      updated += 1;
    }

    await ChatMessage.updateMany(
      {
        conversationId: conversationObjectId,
        senderId: { $ne: userObjectId },
      },
      {
        $set: { status: 'read' },
      },
    );

    return updated;
  }

  async deleteMessage(messageId: string, requesterId: string): Promise<boolean> {
    const doc = await ChatMessage.findById(messageId);
    if (!doc) {
      return false;
    }

    const requesterObjectId = this.toObjectId(requesterId);
    if (doc.senderId.toString() !== requesterObjectId.toString()) {
      throw new Error('Only the sender can delete a message.');
    }

    await MediaAttachment.deleteMany({ messageId: doc._id });
    await doc.deleteOne();
    return true;
  }

  formatMessage(message: ChatMessageDocument) {
    const plain = message.toObject({ virtuals: true });
    if (plain.content) {
      try {
        plain.content = decryptMessage(plain.content);
      } catch (error) {
        logger.warn('Failed to decrypt message content', {
          error: error instanceof Error ? error.message : String(error),
          messageId: plain._id?.toString(),
          service: 'chat-service',
        });
      }
    }
    return plain;
  }

  private toObjectId(value: string | Types.ObjectId): Types.ObjectId {
    if (value instanceof Types.ObjectId) {
      return value;
    }
    if (!Types.ObjectId.isValid(value)) {
      throw new Error(`Invalid ObjectId: ${value}`);
    }
    return new Types.ObjectId(value);
  }

  private toParticipants(senderId: Types.ObjectId, recipients: Types.ObjectId[]): Types.ObjectId[] {
    const set = new Set<string>();
    set.add(senderId.toHexString());
    recipients.forEach((id) => set.add(id.toHexString()));
    return Array.from(set).map((id) => new Types.ObjectId(id));
  }
}

