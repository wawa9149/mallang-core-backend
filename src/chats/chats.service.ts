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

    const [savedUser, savedAssistant, savedEmotion] = await this.prisma.$transaction(
      async (tx) => {
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
      },
    );

    return {
      userMessage: this.toPublicMessage(savedUser),
      assistantMessage: this.toPublicMessage(savedAssistant),
      emotion: this.toPublicEmotion(savedEmotion),
    };
  }

  /**
   * 스케줄러가 시간 도래로 발사한 first-turn 호출.
   * 사용자의 답이 아직 없으므로 LLM 에게는 "질문만" 던지게 하고, 결과인 assistant 메시지만 DB 에 저장한다.
   * - userMessage 는 LLM 호출 시점에만 system trigger 문구로 흘리고 DB 에는 저장하지 않는다.
   * - leftOffice 같은 사용자 답변 기반 메타 데이터는 채우지 않는다(다음 사용자 답변에서 추론).
   */
  async scheduledPrompt(
    userId: string,
    intent: ChatIntent,
  ): Promise<{ assistantMessage: PublicChatMessage }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    const sinceTodayKst = startOfTodayKstAsUtc();
    const recentDesc = await this.prisma.chatMessage.findMany({
      where: { userId, createdAt: { gte: sinceTodayKst } },
      orderBy: { createdAt: 'desc' },
      take: 60,
      select: { role: true, content: true },
    });
    const history = recentDesc.reverse();

    // LLM 한테 "지금 이 intent 가 막 발사됐어, 사용자에게 첫 질문을 던져 줘" 라고 신호만 보내는 메시지.
    // DB 에 저장되는 user 메시지가 아니라, OpenAI messages 배열에만 들어가는 일회성 트리거다.
    const triggerByIntent: Record<ChatIntent, string> = {
      free: '[자동 트리거] 사용자와 가볍게 안부를 트는 첫 마디만 던져 줘.',
      morning_check: '[자동 트리거] 출근 시간이 됐다. 사용자에게 출근했는지 첫 질문을 한 줄로 던져 줘.',
      lunch_alert: '[자동 트리거] 점심 시간이 됐다. 사용자에게 점심 어떻게 할지 첫 질문을 한 줄로 던져 줘.',
      lunch_review: '[자동 트리거] 점심 끝났을 시간이다. 사용자에게 점심 어땠는지 첫 질문을 한 줄로 던져 줘.',
      evening_check:
        '[자동 트리거] 퇴근 시간이 됐다. 사용자에게 퇴근했는지 첫 질문을 한 줄로 던져 줘. 답변이 없으니 leftOffice 같은 평가는 하지 마.',
    };

    const turn = await this.openai.runChatTurn(userId, {
      history: history.map((h) => ({
        role: h.role === ChatRole.assistant ? 'assistant' : 'user',
        content: h.content,
      })),
      userMessage: triggerByIntent[intent],
      persona: user.hobby,
      userName: user.name,
      intent,
      mode: 'first-turn',
    });

    // assistant 메시지만 저장. user 메시지/감정 로그는 만들지 않는다.
    const assistantMetadata: Prisma.InputJsonValue = {
      emotion: {
        type: turn.emotion.emotion,
        score: turn.emotion.score,
        keywords: turn.emotion.keywords,
      },
      // 나중에 분석/디버깅 시 "이 메시지는 스케줄러 자동 질문이다" 라는 표식을 남긴다.
      scheduledPrompt: true,
    };

    const saved = await this.prisma.chatMessage.create({
      data: {
        userId,
        role: ChatRole.assistant,
        intent,
        content: turn.reply,
        metadata: assistantMetadata,
      },
    });

    return { assistantMessage: this.toPublicMessage(saved) };
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
