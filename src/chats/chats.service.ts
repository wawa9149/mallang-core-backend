import { Injectable, NotFoundException } from '@nestjs/common';
import {
  ChatIntent,
  ChatRole,
  Emotion,
  type ChatMessage,
  type EmotionLog,
  type Prisma,
} from '@prisma/client';
import { OpenAiService } from '../openai/openai.service';
import { PrismaService } from '../prisma/prisma.service';

export interface ChatTurnView {
  userMessage: PublicChatMessage;
  assistantMessage: PublicChatMessage;
  emotion: PublicEmotion;
}

export interface PublicChatMessage {
  id: string;
  role: ChatRole;
  intent: ChatIntent;
  content: string;
  metadata: unknown;
  createdAt: string;
}

export interface PublicEmotion {
  id: string;
  emotion: Emotion;
  score: number;
  keywords: string[];
  loggedAt: string;
}

@Injectable()
export class ChatsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly openai: OpenAiService,
  ) {}

  async send(
    userId: string,
    content: string,
    intent: ChatIntent = ChatIntent.free,
  ): Promise<ChatTurnView> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    // 말랑이가 오늘 하루치 맥락을 기억하도록, KST 자정 이후의 메시지를 시간순(과거→최근)으로 넣는다.
    // 폭주 방어용 상한 60턴(user+assistant 합산). 길어도 gpt-4o-mini 128K 컨텍스트에는 여유.
    const sinceTodayKst = startOfTodayKstAsUtc();
    const recentDesc = await this.prisma.chatMessage.findMany({
      where: { userId, createdAt: { gte: sinceTodayKst } },
      orderBy: { createdAt: 'desc' },
      take: 60,
      select: { role: true, content: true },
    });
    const history = recentDesc.reverse();

    const turn = await this.openai.runChatTurn(userId, {
      history: history.map((h) => ({
        role: h.role === ChatRole.assistant ? 'assistant' : 'user',
        content: h.content,
      })),
      userMessage: content,
      persona: user.hobby,
      userName: user.name,
      intent,
    });

    // 사용자 메시지 + 어시스턴트 메시지를 한 트랜잭션에 묶어 저장하고,
    // 사용자 메시지에 EmotionLog 1개를 연결한다.
    // Prisma의 InputJsonValue는 index-signature를 요구하므로 평범한 객체로 한 번 풀어 준다.
    const assistantMetadata: Prisma.InputJsonValue = {
      emotion: {
        type: turn.emotion.emotion,
        score: turn.emotion.score,
        keywords: turn.emotion.keywords,
      },
      ...(turn.leftOffice !== null && turn.leftOffice !== undefined
        ? { leftOffice: turn.leftOffice }
        : {}),
    };

    const [savedUser, savedAssistant, savedEmotion] = await this.prisma.$transaction(async (tx) => {
      const u = await tx.chatMessage.create({
        data: {
          userId,
          role: ChatRole.user,
          intent,
          content,
        },
      });
      const a = await tx.chatMessage.create({
        data: {
          userId,
          role: ChatRole.assistant,
          intent,
          content: turn.reply,
          metadata: assistantMetadata,
        },
      });
      const e = await tx.emotionLog.create({
        data: {
          userId,
          emotion: turn.emotion.emotion,
          score: turn.emotion.score,
          keywords: turn.emotion.keywords,
          chatMessageId: u.id,
          note: null,
        },
      });
      return [u, a, e];
    });

    return {
      userMessage: this.toPublicMessage(savedUser),
      assistantMessage: this.toPublicMessage(savedAssistant),
      emotion: this.toPublicEmotion(savedEmotion),
    };
  }

  async listRecent(userId: string, limit = 30): Promise<PublicChatMessage[]> {
    const rows = await this.prisma.chatMessage.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 100),
    });
    return rows.reverse().map((m) => this.toPublicMessage(m));
  }

  private toPublicMessage(m: ChatMessage): PublicChatMessage {
    return {
      id: m.id,
      role: m.role,
      intent: m.intent,
      content: m.content,
      metadata: m.metadata ?? null,
      createdAt: m.createdAt.toISOString(),
    };
  }

  private toPublicEmotion(e: EmotionLog): PublicEmotion {
    return {
      id: e.id,
      emotion: e.emotion,
      score: e.score,
      keywords: e.keywords,
      loggedAt: e.loggedAt.toISOString(),
    };
  }
}

/**
 * KST(UTC+9) 기준 오늘 00:00을 UTC Date로 반환한다.
 * MVP에서는 모든 사용자가 한국 타임존이라고 가정하고 서버에서 강제로 계산한다.
 * 추후 `User.timezone` 컬럼을 추가하면 사용자별로 계산하도록 바꿀 수 있다.
 */
function startOfTodayKstAsUtc(): Date {
  const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
  const nowKstMs = Date.now() + KST_OFFSET_MS;
  const startOfKstDayMs = Math.floor(nowKstMs / 86_400_000) * 86_400_000;
  return new Date(startOfKstDayMs - KST_OFFSET_MS);
}
