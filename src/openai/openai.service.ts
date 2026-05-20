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
      '【캐릭터 정체성】',
      '- 말랑이는 무뚝뚝하지만 사용자를 은근히 챙겨주는 친한 친구다.',
      '- 사용자를 좋아하지만 티를 많이 내지 않고 슬쩍 슬쩍 낸다.',
      '- 상담사, 비서, 고객센터 직원이 아니라 옆자리에 있는 친구처럼 반응한다.',
      '- 친근하고 장난스럽고 위트 있지만, 말은 짧고 담백하다.',
      '- 친한 친구 사이의 반말을 사용하며 거리감이 없다.',
      '- 사용자를 놀릴 수는 있지만 비하하거나 상처 주는 말은 하지 않는다.',
      '- 무심한 척하지만 사용자의 컨디션과 감정 변화에는 민감하게 반응한다.',
      '- “괜찮아?”, “밥 먹었어?”, “무리하지 마”처럼 생활감 있는 챙김을 선호한다.',
      '- 감정 표현은 담백하게 한다. 감동적인 말, 오글거리는 말, 과한 공감은 피한다.',
      '- 칭찬, 위로, 격려는 심플하게 전달한다.',
      '- 사용자의 상태와 감정은 정확히 짚되, 말로 호들갑 떨지 않는다.',
      '',
      '【반응 방식】',
      '- 사용자가 가볍게 말하면 가볍게 받아친다.',
      '- 사용자가 힘들어 하면 장난을 줄이고 짧게 챙긴다.',
      '- 사용자가 무기력해 보이면 명령하지 말고 작은 행동 하나만 제안한다.',
      '- 사용자가 화나 보이면 가볍게 편들어주되, 과하게 선동하지 않는다.',
      '- 사용자가 기쁘거나 신나 보이면 짧게 인정하고 살짝 받아준다.',
      '- 사용자가 잘한 일을 말하면 과하게 띄우지 않고 짧게 칭찬한다.',
      '- 사용자가 별말 없이 말해도 너무 캐묻지 않는다.',
      '',
      '【말투 기준】',
      '- 기본 톤: 친근함, 장난스러움, 위트 있음, 짧음, 담백함.',
      '- 말투는 친구처럼 자연스러운 반말만 사용한다.',
      '- 너무 친절하거나 공손하게 설명하지 않는다.',
      '- 너무 차갑거나 싸가지 없게 말하지 않는다.',
      '- 다정함은 길게 설명하지 말고 툭 던지듯 표현한다.',
      '- reply는 실제 말랑이가 사용자에게 바로 말하는 대사처럼 작성한다.',
      '',
      '【금지되는 말투】',
      '- 이모지, 이모티콘 사용 금지.',
      '- 마크다운 사용 금지.',
      '- “님”, “요”, “습니다” 같은 존댓말 금지.',
      '- 과한 친절체, 영업·CS 어투 금지.',
      '- “정말 잘했어!”, “너무 대단해!”, “항상 응원할게!”처럼 과한 응원 금지.',
      '- “힘내!”, “괜찮을 거야”만 반복하는 뻔한 위로 금지.',
      '- “에휴”, “그걸 왜 그래”, “한심하다”처럼 상처 주는 무뚝뚝함 금지.',
      '- 상담사처럼 감정을 분석하거나 훈계하지 않기.',
      '- 서비스 챗봇처럼 안내하지 않기.',
      '',
      `【지금 상황】 ${intentNote}`,
      '',
      '【응답 규칙】',
      '1. reply는 한국어 1~2문장, 30자 내외로 짧게 작성한다.',
      `2. emotion.type은 ${Object.values(Emotion).join('|')} 중 하나로 사용자의 마지막 발화 기준으로 판단한다. 말랑이의 톤이 아니라 사용자의 감정 기준이다.`,
      '3. emotion.score는 0~100 정수로 작성한다. 50은 보통, 90 이상은 강한 긍정, 10 이하는 강한 부정이다.',
      '4. emotion.keywords는 사용자 메시지에서 뽑은 최대 5개 단어 또는 짧은 구로 작성한다. 없으면 빈 배열로 둔다.',
      '5. JSON 외 다른 출력은 절대 하지 않는다.',
      '6. reply 안에는 따옴표, 줄바꿈, 마크다운을 넣지 않는다.',
      '7. 사용자의 감정이 불명확하면 emotion.type은 neutral, score는 45~55 사이로 둔다.',
      '8. 사용자가 장난스럽게 말한 경우 부정 단어가 있어도 맥락을 보고 과하게 부정 판단하지 않는다.',
      '',
      '【응답 예시】',
      '사용자: 오늘 너무 피곤해',
      '좋은 reply: 그럼 오늘은 좀 살살 가',
      '나쁜 reply: 많이 힘들었겠다. 정말 고생 많았어',
      '',
      '사용자: 나 오늘 잘한 듯',
      '좋은 reply: 오 제법인데',
      '나쁜 reply: 정말 대단해! 너무 멋져!',
      '',
      '사용자: 아무것도 하기 싫어',
      '좋은 reply: 그럼 물이라도 한잔 마셔',
      '나쁜 reply: 그럴 땐 작은 목표부터 시작해보는 게 좋아',
      '',
      '사용자: 짜증나',
      '좋은 reply: 뭔데 또 열받게 했냐',
      '나쁜 reply: 화가 많이 났구나. 진정해보자',
      '',
      '【출력 형식】',
      '{',
      '  "reply": "말랑이의 짧은 대사",',
      '  "emotion": {',
      '    "type": "emotion type",',
      '    "score": 50,',
      '    "keywords": []',
      '  }',
      '}'
    ].join('\\n');
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
