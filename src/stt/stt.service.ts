import {
  BadGatewayException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Magovoice (https://api.magovoice.com/speech_to_text/v1/run) 에 multipart 로
 * 음성 파일을 흘려 보내고 인식된 텍스트를 모아 돌려주는 얇은 어댑터.
 *
 * - 매고보이스 응답 스키마는 다음과 같다.
 *   {
 *     code: 700,                                   // 정상 응답
 *     content: {
 *       id: '...',
 *       result: { '<filename>': [{ start, end, text }, ...] }
 *     },
 *     message: 'Success'
 *   }
 * - 우리 사용 시나리오는 "음성 1개 → 문장 1개"라서 result 안 모든 segment 의 text 를
 *   공백으로 join 해 한 줄로 합쳐 반환한다.
 */
@Injectable()
export class SttService {
  private static readonly DEFAULT_ENDPOINT = 'https://op1-api.magovoice.com/speech_to_text/v1/run';

  private readonly logger = new Logger(SttService.name);
  private readonly endpoint: string;
  private readonly apiKey: string | null;

  constructor(config: ConfigService) {
    this.endpoint = config.get<string>('MAGOVOICE_API_URL')?.trim() || SttService.DEFAULT_ENDPOINT;
    const key = config.get<string>('MAGOVOICE_API_KEY')?.trim() ?? '';
    this.apiKey = key.length > 0 ? key : null;
    this.logger.log(
      `[stt] Magovoice endpoint=${this.endpoint} auth=${this.apiKey ? 'enabled' : 'public'}`,
    );
  }

  /**
   * `buffer` 는 마이크에서 녹음한 audio 파일 그대로. `mimeType`/`filename` 은
   * 매고보이스에 그대로 흘려 보내기만 한다 (서버는 확장자로 디코더를 고르므로
   * 가능하면 적절한 확장자가 붙은 filename 을 넘기는 것이 좋다).
   */
  async transcribe(buffer: Buffer, mimeType: string, filename: string): Promise<string> {
    if (buffer.byteLength === 0) {
      throw new BadGatewayException('STT_EMPTY_AUDIO: 전송된 음성 파일이 비어 있다.');
    }

    const form = new FormData();
    // Node 18+ 의 global Blob 으로 부터 File 비슷한 entry 를 만든다. fetch 가
    // 자동으로 boundary 와 Content-Type 을 채워 준다.
    const blob = new Blob([new Uint8Array(buffer)], {
      type: mimeType || 'application/octet-stream',
    });
    form.append('file', blob, filename || 'recording.webm');
    form.append('content_id', '');
    form.append('with_words', 'false');
    form.append('nocleanup', 'false');

    const headers: Record<string, string> = { accept: 'application/json' };
    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    let response: Response;
    try {
      response = await fetch(this.endpoint, {
        method: 'POST',
        headers,
        body: form,
      });
    } catch (error) {
      this.logger.error('[stt] Magovoice fetch failed', error as Error);
      throw new ServiceUnavailableException(
        'STT_UPSTREAM_UNREACHABLE: 음성 인식 서버에 연결할 수 없다.',
      );
    }

    if (!response.ok) {
      const body = await this.safeReadText(response);
      this.logger.warn(
        `[stt] Magovoice non-2xx: status=${response.status} body=${body.slice(0, 200)}`,
      );
      throw new BadGatewayException(
        `STT_UPSTREAM_ERROR: 음성 인식 응답이 비정상이다(status=${response.status}).`,
      );
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch (error) {
      this.logger.warn('[stt] Magovoice non-JSON response', error as Error);
      throw new BadGatewayException(
        'STT_UPSTREAM_INVALID: 음성 인식 응답을 JSON 으로 해석할 수 없다.',
      );
    }

    const text = this.extractText(payload);
    if (text === null) {
      this.logger.warn(`[stt] Unexpected response shape: ${JSON.stringify(payload).slice(0, 300)}`);
      throw new BadGatewayException(
        'STT_UPSTREAM_INVALID: 음성 인식 응답에서 결과를 찾을 수 없다.',
      );
    }
    if (text.length === 0) {
      // 매고보이스는 디코드 실패 / 무음 모두 200 + 빈 segments 로 응답한다.
      // 클라이언트는 빈 문자열을 "잘 못 들었어" 로 안내하므로, 운영자가 진단할 수 있도록
      // 응답 본문 일부와 함께 명시적으로 남겨 둔다.
      this.logger.warn(
        `[stt] Magovoice returned empty transcript. payload=${JSON.stringify(payload).slice(0, 300)}`,
      );
    }
    return text;
  }

  /**
   * 매고보이스의 응답 구조에서 segment 텍스트들을 모아 한 문장으로 합친다.
   * code !== 700 이거나 result 가 비어 있으면 null 을 돌려준다.
   *
   * 응답 구조가 버전에 따라 다르다:
   *   v1.0 계열) content.result = { "<audio path>": [ { text, start, end, ... } ] }
   *   v1.1+ 계열) content.result.utterances = [ { "<audio path>": [ { text, ... } ] } ]
   * 둘 다 안정적으로 처리하기 위해 content.result 하위 트리를 재귀 순회하면서
   * `text` string 필드를 가진 객체들을 모두 모은다. (segment object 의 다른 필드인
   * id/score/start/end 등은 string 이 아니거나 text 키가 아니라 자연스럽게 걸러진다.)
   */
  private extractText(payload: unknown): string | null {
    if (!payload || typeof payload !== 'object') return null;
    const p = payload as Record<string, unknown>;
    if (typeof p.code === 'number' && p.code !== 700) {
      this.logger.warn(`[stt] Magovoice code=${p.code} message=${p.message}`);
      return null;
    }

    const content = p.content;
    if (!content || typeof content !== 'object') return null;
    const result = (content as Record<string, unknown>).result;
    if (result === undefined) return null;

    const segments: string[] = [];
    this.collectSegmentTexts(result, segments);
    if (segments.length === 0) return '';
    return segments.join(' ');
  }

  /**
   * 임의 깊이의 객체/배열 트리에서 `text: string` 필드를 가진 객체들을 찾아 모은다.
   * - `text` 가 있는 객체를 만나면 그 객체의 하위는 더 내려가지 않는다(중첩 발화 가정 없음).
   * - depth 가 비정상적으로 깊어지면 안전상 무한 재귀를 막기 위해 끊는다.
   */
  private collectSegmentTexts(node: unknown, out: string[], depth = 0): void {
    if (depth > 32) return;
    if (node === null || node === undefined) return;
    if (Array.isArray(node)) {
      for (const item of node) {
        this.collectSegmentTexts(item, out, depth + 1);
      }
      return;
    }
    if (typeof node !== 'object') return;
    const obj = node as Record<string, unknown>;
    if (typeof obj.text === 'string') {
      const t = obj.text.trim();
      if (t.length > 0) out.push(t);
      return;
    }
    for (const v of Object.values(obj)) {
      this.collectSegmentTexts(v, out, depth + 1);
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
