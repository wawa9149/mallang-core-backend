import {
  Injectable,
  InternalServerErrorException,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Naver Clova Voice (Naver Cloud Platform) 의 얇은 HTTP 어댑터.
 *
 * - 엔드포인트: `https://naveropenapi.apigw.ntruss.com/tts-premium/v1/tts`
 * - 인증: API Gateway 키 ID/Secret 헤더 두 개.
 * - 요청: application/x-www-form-urlencoded.
 * - 응답: mp3 binary (Content-Type: audio/mpeg).
 *
 * 키가 비어 있으면 `isEnabled()` 가 false 를 돌려주고, `synthesize()` 는
 * 명시적으로 ServiceUnavailable 을 던진다. 컨트롤러가 503 으로 매핑한다.
 */
@Injectable()
export class TtsService {
  private static readonly ENDPOINT =
    'https://naveropenapi.apigw.ntruss.com/tts-premium/v1/tts';

  private readonly logger = new Logger(TtsService.name);
  private readonly apiKeyId: string | null;
  private readonly apiKey: string | null;
  private readonly speaker: string;
  private readonly speed: string;
  private readonly pitch: string;
  private readonly volume: string;
  private readonly alpha: string;

  constructor(config: ConfigService) {
    const id = config.get<string>('CLOVA_VOICE_API_KEY_ID')?.trim() ?? '';
    const key = config.get<string>('CLOVA_VOICE_API_KEY')?.trim() ?? '';
    this.apiKeyId = id.length > 0 ? id : null;
    this.apiKey = key.length > 0 ? key : null;

    // 기본 화자/톤은 .env 로 덮어쓸 수 있게 두되, 비어 있으면 자연스러운 한국어 여성 화자로 폴백한다.
    this.speaker = (config.get<string>('CLOVA_VOICE_SPEAKER')?.trim() || 'nara');
    this.speed = this.clampNumeric(config.get<string>('CLOVA_VOICE_SPEED'), '0');
    this.pitch = this.clampNumeric(config.get<string>('CLOVA_VOICE_PITCH'), '0');
    this.volume = this.clampNumeric(
      config.get<string>('CLOVA_VOICE_VOLUME'),
      '0',
    );
    // alpha: 음색/포만트(formant) 조절. 양수면 굵직·낮게, 음수면 얇게·높게 들린다.
    this.alpha = this.clampNumeric(
      config.get<string>('CLOVA_VOICE_ALPHA'),
      '0',
    );

    if (!this.isEnabled()) {
      this.logger.warn(
        '[tts] CLOVA_VOICE_API_KEY_ID 또는 CLOVA_VOICE_API_KEY 가 비어 있다. /tts/speak 호출은 503 으로 응답한다.',
      );
    } else {
      this.logger.log(
        `[tts] Clova Voice 활성화. speaker=${this.speaker} speed=${this.speed} pitch=${this.pitch} volume=${this.volume} alpha=${this.alpha}`,
      );
    }
  }

  isEnabled(): boolean {
    return this.apiKeyId !== null && this.apiKey !== null;
  }

  /**
   * 텍스트를 Clova Voice 에 보내 mp3 binary 를 받아 온다.
   * 호출자는 응답 Buffer 를 그대로 StreamableFile 로 흘려 보낸다.
   */
  async synthesize(
    text: string,
    style?: { emotion?: string; score?: number },
  ): Promise<Buffer> {
    if (!this.isEnabled()) {
      throw new ServiceUnavailableException(
        'TTS_NOT_CONFIGURED: 서버에 Clova Voice 키가 설정되어 있지 않다.',
      );
    }

    const emotionParams = this.mapEmotionToClova(style?.emotion);

    const params = new URLSearchParams();
    params.set('speaker', this.speaker);
    params.set('text', text);
    params.set('speed', emotionParams.speed ?? this.speed);
    params.set('pitch', this.pitch);
    params.set('volume', this.volume);
    params.set('alpha', this.alpha);
    params.set('format', 'mp3');
    if (emotionParams.emotion !== undefined) {
      params.set('emotion', String(emotionParams.emotion));
    }
    if (emotionParams.emotionStrength !== undefined) {
      params.set('emotion-strength', String(emotionParams.emotionStrength));
    }

    let response: Response;
    try {
      response = await fetch(TtsService.ENDPOINT, {
        method: 'POST',
        headers: {
          // 비-널을 위 isEnabled 가 보장. 타입 좁히기 위해 ! 사용.
          'X-NCP-APIGW-API-KEY-ID': this.apiKeyId!,
          'X-NCP-APIGW-API-KEY': this.apiKey!,
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'audio/mpeg',
        },
        body: params.toString(),
      });
    } catch (error) {
      // 네트워크 오류는 사용자가 다시 시도하면 회복될 수 있으니 503 으로 노출한다.
      this.logger.error('[tts] Clova fetch failed', error as Error);
      throw new ServiceUnavailableException(
        'TTS_UPSTREAM_UNREACHABLE: Clova Voice 요청이 네트워크 단에서 실패했다.',
      );
    }

    if (!response.ok) {
      const body = await this.safeReadText(response);
      this.logger.warn(
        `[tts] Clova non-2xx: status=${response.status} body=${body.slice(0, 200)}`,
      );
      // 4xx 도 운영자가 키를 잘못 넣은 경우 등 사용자가 해결할 수 없는 경우가 많아 503 으로 묶는다.
      throw new ServiceUnavailableException(
        `TTS_UPSTREAM_ERROR: Clova Voice 응답이 비정상이다(status=${response.status}).`,
      );
    }

    const arrayBuffer = await response.arrayBuffer();
    if (arrayBuffer.byteLength === 0) {
      throw new InternalServerErrorException(
        'TTS_EMPTY_RESPONSE: Clova Voice 가 빈 audio 를 돌려줬다.',
      );
    }
    return Buffer.from(arrayBuffer);
  }

  private clampNumeric(raw: string | undefined, fallback: string): string {
    if (raw === undefined) return fallback;
    const trimmed = raw.trim();
    if (trimmed.length === 0) return fallback;
    const n = Number(trimmed);
    if (!Number.isFinite(n)) return fallback;
    const clamped = Math.max(-5, Math.min(5, Math.round(n)));
    return String(clamped);
  }

  /**
   * 말랑이 감정을 Clova Voice API 파라미터로 매핑한다.
   *
   * Clova emotion: 0=neutral, 1=sad, 2=happy, 3=angry
   * emotion-strength: 항상 2(강함) 고정.
   * pitch/alpha: 절대 건드리지 않는다.
   * speed: tired일 때만 -2 (느리게). 나머지는 .env 기본값 사용.
   */
  private mapEmotionToClova(
    emotion?: string,
  ): {
    emotion?: number;
    emotionStrength?: number;
    speed?: string;
  } {
    if (!emotion || emotion === 'neutral') return {};

    switch (emotion) {
      case 'happy':
        return { emotion: 2, emotionStrength: 2 };
      case 'sad':
        return { emotion: 1, emotionStrength: 2 };
      case 'angry':
        return { emotion: 3, emotionStrength: 2 };
      case 'tired':
        return { speed: '-2' };
      default:
        return {};
    }
  }

  private async safeReadText(response: Response): Promise<string> {
    try {
      return await response.text();
    } catch {
      return '';
    }
  }
}
