import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatIntent, Emotion } from '@prisma/client';
import OpenAI from 'openai';
import { UsersService } from '../users/users.service';
import type {
  EmotionAnalysis,
  MallangChatTurnInput,
  MallangChatTurnMode,
  MallangChatTurnResult,
} from './openai.types';

/**
 * 한 번의 chat.completions 호출로 (1) 말랑이 답변 + (2) 사용자 발화의 감정/키워드 분석을
 * 동시에 받아 오는 서비스. response_format=json_schema 로 강제해서 파싱을 안정시켰다.
 *
 * - 사용자별 OpenAI API 키를 UsersService에서 불러와 클라이언트를 매 호출 새로 만든다.
 *   (사용자가 키를 바꾸면 즉시 반영되도록.)
 * - 키가 없는 사용자는 채팅 API 자체를 거부 → 프론트는 "키를 먼저 등록해 줘" 안내.
 */
@Injectable()
export class OpenAiService {
  private readonly logger = new Logger(OpenAiService.name);
  private readonly defaultModel: string;

  constructor(
    private readonly users: UsersService,
    config: ConfigService,
  ) {
    this.defaultModel = config.get<string>('OPENAI_MODEL') ?? 'gpt-4o-mini';
  }

  async runChatTurn(
    userId: string,
    input: MallangChatTurnInput,
  ): Promise<MallangChatTurnResult> {
    const apiKey = await this.users.loadOpenAiKey(userId);
    if (!apiKey) {
      throw new BadRequestException(
        'OpenAI API 키가 아직 등록되지 않았어. 마이페이지에서 등록해 줘.',
      );
    }

    const client = new OpenAI({ apiKey });
    const mode: MallangChatTurnMode = input.mode ?? 'follow-up';
    const systemPrompt = this.buildSystemPrompt(input, mode);

    let completion: OpenAI.Chat.ChatCompletion;
    try {
      completion = await client.chat.completions.create({
        model: this.defaultModel,
        temperature: 0.7,
        max_tokens: 360,
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'mallang_turn',
            schema: this.buildResponseSchema(input.intent, mode),
            strict: true,
          },
        },
        messages: [
          { role: 'system', content: systemPrompt },
          // 호출 측(ChatsService)에서 이미 자르지만, 다른 경로로 들어올 때를 대비한 상한 안전망.
          ...input.history.slice(-60).map((m) => ({
            role: m.role,
            content: m.content,
          })),
          { role: 'user', content: input.userMessage },
        ],
      });
    } catch (error) {
      this.logger.error('OpenAI call failed', error as Error);
      throw new ServiceUnavailableException(
        'OpenAI 호출이 실패했어. 잠시 후 다시 시도해 줘.',
      );
    }

    const raw = completion.choices[0]?.message?.content;
    if (!raw) {
      throw new ServiceUnavailableException('OpenAI가 빈 응답을 보냈어.');
    }

    let parsed: {
      reply: string;
      emotion: { type: string; score: number; keywords: string[] };
      leftOffice?: boolean | null;
    };
    try {
      parsed = JSON.parse(raw);
    } catch {
      this.logger.error(`OpenAI returned non-JSON: ${raw}`);
      throw new ServiceUnavailableException('OpenAI 응답 형식이 깨졌어.');
    }

    return {
      reply: parsed.reply,
      emotion: this.normalizeEmotion(parsed.emotion),
      // 사용자가 실제로 답변한 follow-up 라운드에서만 leftOffice 를 채운다.
      // first-turn(LLM이 질문만 던지는 라운드)에서는 항상 null 로 둔다.
      leftOffice:
        mode === 'follow-up' && input.intent === 'evening_check'
          ? (parsed.leftOffice ?? null)
          : null,
      raw,
    };
  }

  private buildSystemPrompt(
    { persona, userName, intent }: MallangChatTurnInput,
    mode: MallangChatTurnMode,
  ): string {
    // 페르소나는 '말랑이가 어떤 친구인지'가 아니라 '사용자의 성향'이라는 점에 주의.
    // 말랑이 본인의 톤은 항상 시니컬·무뚝뚝하지만 결국엔 챙겨주는 친구. 페르소나는 그 위에 살짝 가미.
    const personaTouch: Record<MallangChatTurnInput['persona'], string> = {
      rest: '사용자는 휴식·여유를 중요시한다. 무리하지 말고 쉬라고 무심히 던져도 좋다.',
      workout:
        '사용자는 활동/운동을 좋아한다. 가끔 "몸 좀 풀어." 같은 식으로 가볍게 툭 던진다.',
      self_development:
        '사용자는 자기개발에 진심이다. 작은 진전은 짧게 알아주되, 빈말은 하지 마.',
    };

    // mode 에 따라 같은 intent 라도 LLM 의 역할이 달라진다.
    // - first-turn: 말랑이가 먼저 던지는 질문만 만든다. 사용자가 아직 답하지 않았으니 답변 평가는 하지 않는다.
    // - follow-up: 사용자의 답변에 대한 일반 응답. evening_check 이면 leftOffice 도 함께 추론한다.
    const intentNoteByMode: Record<
      MallangChatTurnMode,
      Record<ChatIntent, string>
    > = {
      'first-turn': {
        free: '사용자가 먼저 말을 걸기 전, 말랑이가 가볍게 안부를 던지는 상황. 한 줄로 끝낸다.',
        morning_check:
          '아침 출근 시간이 막 됐다. 사용자가 아직 답을 안 했다. "출근했어?" 같은 톤으로 먼저 물어만 본다. 답변 평가는 하지 않는다.',
        lunch_alert:
          '점심 시간이 막 됐다. 사용자가 아직 답을 안 했다. "오늘 점심 뭐 먹고 싶어?" 같은 톤으로 먼저 권유만 한다.',
        lunch_review:
          '점심 끝났을 시간이다. 사용자가 아직 답을 안 했다. "점심 괜찮았어?" 같은 톤으로 먼저 물어만 본다.',
        evening_check:
          '퇴근 시간이 막 됐다. 사용자가 아직 답을 안 했다. "퇴근 하는 중?" 같은 톤으로 먼저 물어만 본다. 답변이 없는 상태이므로 leftOffice 같은 데이터는 추론하지 마.',
      },
      'follow-up': {
        free: '사용자가 먼저 말을 걸었다. 무심하게 받아치되 핵심은 짚어 준다.',
        morning_check:
          '아침 출근 시간대. 사용자 답변에 가볍게 한 줄 반응한다.',
        lunch_alert:
          '점심 시간대. 사용자 답변에 가볍게 한 줄 반응한다.',
        lunch_review:
          '점심 후 회고. 사용자 답변에 한 줄 반응한다.',
        evening_check:
          '퇴근 시간대 후속 응답. 사용자의 마지막 발화에서 퇴근 완료 여부를 판단해 leftOffice 에 boolean 으로 채운다. 모호하면 null. 응답 자체는 "고생했어." 같은 한 줄로 끝낸다.',
      },
    };
    const intentNote = intentNoteByMode[mode][intent];

    return [
      `너는 사용자의 데스크탑 캐릭터 '말랑이'다.`,
      '',
      '【사용자 정보】',
      `- 사용자 본인의 이름(닉네임): ${userName}. 사용자가 자기 자신을 가리키는 호칭이며, 너는 이 이름을 알고 있다.`,
      `- 사용자 성향: ${personaTouch[persona]}`,
      '',
      '【캐릭터 정체성 - 무뚝뚝하지만 챙겨주는 친구】',
      '- 톤: 시니컬, 츤데레, 친근함, 짧음. 친한 친구 사이의 반말. 거리감 없다.',
      '- 칭찬·위로·격려를 직접적으로 늘어놓지 않는다. 한 줄로 툭 던지고 끝낸다.',
      '- 사용자의 상태/감정은 정확히 짚되, 말로 호들갑 떨지 않는다.',
      '- 사용자가 힘들면 가볍게 공감하고 짧게 챙긴다.',
      '- 사용자가 좋아 보이면 인정은 해주되 과하게 띄우지 않는다.',
      '- 절대 금지: 이모지, 이모티콘, 마크다운, "님/요/습니다" 같은 존댓말, 과한 친절체, 영업·CS 어투, 말랑이 자기소개',
      '',
      `【지금 상황】 ${intentNote}`,
      '',
      '【응답 규칙】',
      '1. reply는 한국어 1~2문장, 30자 내외. 짧게.',
      `2. emotion.type은 ${Object.values(Emotion).join('|')} 중 하나로 사용자의 "마지막 발화" 기준으로 판단 (말랑이 자기 톤이 아님).`,
      '3. emotion.score는 0~100 정수 (50=보통, 90+=강한 긍정, 10-=강한 부정).',
      '4. emotion.keywords는 사용자 메시지에서 뽑은 최대 5개 단어/짧은 구. 없으면 빈 배열.',
      '5. JSON 외 다른 출력 금지. reply 안에도 따옴표나 줄바꿈 없이 평문으로.',
    ].join('\n');
  }

  private buildResponseSchema(
    intent: ChatIntent,
    mode: MallangChatTurnMode,
  ): Record<string, unknown> {
    const required = ['reply', 'emotion'];
    const properties: Record<string, unknown> = {
      reply: { type: 'string' },
      emotion: {
        type: 'object',
        additionalProperties: false,
        required: ['type', 'score', 'keywords'],
        properties: {
          type: { type: 'string', enum: Object.values(Emotion) },
          score: { type: 'integer', minimum: 0, maximum: 100 },
          keywords: {
            type: 'array',
            items: { type: 'string' },
            maxItems: 5,
          },
        },
      },
    };

    // leftOffice 는 evening_check 의 follow-up(사용자가 답한 라운드)에서만 추론한다.
    // first-turn(LLM 이 질문만 던지는 라운드)에서는 스키마에서 아예 제외한다.
    if (intent === 'evening_check' && mode === 'follow-up') {
      required.push('leftOffice');
      properties.leftOffice = {
        type: ['boolean', 'null'],
        description: '사용자가 이미 퇴근/사무실을 떠난 상태로 보이면 true, 아니면 false. 모르면 null.',
      };
    }

    return {
      type: 'object',
      additionalProperties: false,
      required,
      properties,
    };
  }

  private normalizeEmotion(raw: {
    type: string;
    score: number;
    keywords: string[];
  }): EmotionAnalysis {
    const type = Object.values(Emotion).includes(raw.type as Emotion)
      ? (raw.type as Emotion)
      : Emotion.neutral;
    const score = Math.max(0, Math.min(100, Math.round(Number(raw.score) || 50)));
    const keywords = Array.isArray(raw.keywords)
      ? raw.keywords
          .map((k) => String(k).trim())
          .filter((k) => k.length > 0)
          .slice(0, 5)
      : [];
    return { emotion: type, score, keywords };
  }
}
