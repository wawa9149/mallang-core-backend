import {
  Body,
  Controller,
  ForbiddenException,
  Logger,
  Post,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { JwtUser } from '../auth/strategies/jwt.strategy';
import { PrismaService } from '../prisma/prisma.service';
import { SpeakDto } from './dto/speak.dto';
import { TtsService } from './tts.service';

@ApiTags('tts')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('tts')
export class TtsController {
  private readonly logger = new Logger(TtsController.name);

  constructor(
    private readonly tts: TtsService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * 말랑이 발화 텍스트를 Clova Voice 로 합성해 mp3 binary 로 흘려 보낸다.
   *
   * 응답 시나리오
   * - 200: audio/mpeg 본문 (정상)
   * - 403: 사용자가 마이페이지에서 TTS 토글을 꺼 둠 (TTS_DISABLED)
   * - 503: 서버에 Clova 키가 설정 안 됐거나 업스트림이 실패함
   *
   * 클라이언트는 403/503 모두 silent fail 로 처리해 자막(말풍선) 흐름만 유지하면 된다.
   */
  @Post('speak')
  @ApiOkResponse({
    description: 'mp3 audio binary. Content-Type: audio/mpeg',
    schema: { type: 'string', format: 'binary' },
  })
  async speak(
    @CurrentUser() user: JwtUser,
    @Body() dto: SpeakDto,
  ): Promise<StreamableFile> {
    // 사용자가 직접 끄지 않은 경우에만 합성한다. 켜져 있는지 매 호출마다 DB 로 확인해
    // 다른 창에서 토글을 막 끈 경우에도 즉시 반영되도록 한다.
    const me = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: { ttsEnabled: true },
    });
    if (!me?.ttsEnabled) {
      this.logger.warn(
        `[tts] /speak refused — user=${user.id} ttsEnabled=${me?.ttsEnabled ?? 'no-row'} (마이페이지 토글이 꺼져 있다)`,
      );
      throw new ForbiddenException(
        'TTS_DISABLED: 사용자가 TTS 발화를 끄고 있다.',
      );
    }

    this.logger.log(
      `[tts] /speak user=${user.id} textLen=${dto.text.length}`,
    );
    const audio = await this.tts.synthesize(dto.text);
    this.logger.log(
      `[tts] /speak ok user=${user.id} bytes=${audio.byteLength}`,
    );
    return new StreamableFile(audio, {
      type: 'audio/mpeg',
      disposition: 'inline; filename="mallang.mp3"',
    });
  }
}
