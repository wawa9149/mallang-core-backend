import type { ChatIntent, Emotion } from '@prisma/client';

export interface MallangChatTurnInput {
  /** 직전 대화 컨텍스트. 시간순(과거→최근). */
  history: { role: 'user' | 'assistant'; content: string }[];
  /** 이번 턴의 사용자 발화. */
  userMessage: string;
  /** 사용자의 페르소나 — 응답 톤에 사용. */
  persona: 'rest' | 'workout' | 'self_development';
  /** 사용자 이름 — 시스템 프롬프트 컨텍스트로 들어간다. */
  userName: string;
  /** 인텐트별 분기. free / morning / lunch / evening 등 */
  intent: ChatIntent;
}

export interface EmotionAnalysis {
  emotion: Emotion;
  /** 강도 0~100. 50 = 보통. */
  score: number;
  keywords: string[];
}

export interface MallangChatTurnResult {
  reply: string;
  emotion: EmotionAnalysis;
  /** evening_check 인텐트에서 LLM이 판단한 "퇴근 완료 여부". 그 외 인텐트에서는 null. */
  leftOffice?: boolean | null;
  /** 디버깅용 raw text. 운영 단계에선 metadata에 보관하지 않을 수도 있다. */
  raw?: unknown;
}
