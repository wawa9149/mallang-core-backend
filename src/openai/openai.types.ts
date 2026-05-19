import type { ChatIntent, Emotion } from '@prisma/client';

export type MallangChatTurnMode =
  /**
   * 스케줄러로 자동 발사된 첫 턴. 사용자의 답이 아직 없으므로 LLM은 "질문만" 던진다.
   * - leftOffice 같은 사용자 답변 기반 메타 데이터는 추론하지 않는다.
   * - userMessage 자리에는 시스템이 만든 트리거 문구가 들어가고, DB 에는 저장되지 않는다.
   */
  | 'first-turn'
  /** 사용자의 발화에 대한 일반 응답 턴. evening_check 라면 leftOffice 도 함께 추론한다. */
  | 'follow-up';

export interface MallangChatTurnInput {
  /** 직전 대화 컨텍스트. 시간순(과거→최근). */
  history: { role: 'user' | 'assistant'; content: string }[];
  /** 이번 턴의 사용자 발화. mode='first-turn' 일 때는 시스템 트리거 문구가 들어간다. */
  userMessage: string;
  /** 사용자의 페르소나 — 응답 톤에 사용. */
  persona: 'rest' | 'workout' | 'self_development';
  /** 사용자 이름 — 시스템 프롬프트 컨텍스트로 들어간다. */
  userName: string;
  /** 인텐트별 분기. free / morning / lunch / evening 등 */
  intent: ChatIntent;
  /**
   * 이번 호출이 (1) 말랑이가 먼저 질문을 던지는 라운드인지,
   * (2) 사용자 답변에 대한 일반 응답인지 명시한다. 기본값은 'follow-up'.
   */
  mode?: MallangChatTurnMode;
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
