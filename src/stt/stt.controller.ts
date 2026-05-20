import {
  BadRequestException,
  Controller,
  Logger,
  PayloadTooLargeException,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SttService } from './stt.service';

/**
 * 사용자가 마이크 버튼으로 녹음한 음성 데이터를 받아 Magovoice 로 전달하고
 * 텍스트로 변환해 돌려주는 엔드포인트.
 *
 * 응답:
 * - 200: { text: string }     // text 가 빈 문자열이면 인식된 음성이 없음
 * - 400: 파일이 없거나 너무 작음
 * - 413: 파일이 너무 큼 (서버 단의 안전장치)
 * - 502/503: Magovoice 업스트림 실패
 */
@ApiTags('stt')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('stt')
export class SttController {
  // 마이크로 1~2분 정도 녹음 가능하도록 넉넉히 잡되, 잘못 보낸 큰 파일은 차단한다.
  // 16MB 면 webm/opus 기준 약 5~10분 분량.
  private static readonly MAX_BYTES = 16 * 1024 * 1024;

  private readonly logger = new Logger(SttController.name);

  constructor(private readonly stt: SttService) {}

  @Post('transcribe')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: SttController.MAX_BYTES },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
      },
    },
  })
  @ApiOkResponse({
    schema: {
      type: 'object',
      properties: { text: { type: 'string' } },
      required: ['text'],
    },
  })
  async transcribe(
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<{ text: string }> {
    if (!file) {
      throw new BadRequestException('STT_FILE_REQUIRED: multipart "file" 필드가 비어 있다.');
    }
    if (file.size === 0) {
      throw new BadRequestException('STT_FILE_EMPTY: 업로드된 음성 파일이 0 byte 다.');
    }
    if (file.size > SttController.MAX_BYTES) {
      // multer 단에서도 거르지만, 안전하게 한 번 더 검사.
      throw new PayloadTooLargeException(
        `STT_FILE_TOO_LARGE: 최대 ${SttController.MAX_BYTES} byte 까지 지원한다.`,
      );
    }

    this.logger.log(
      `[stt] /transcribe recv name=${file.originalname} mime=${file.mimetype} bytes=${file.size}`,
    );
    const text = await this.stt.transcribe(
      file.buffer,
      file.mimetype,
      file.originalname || 'recording.wav',
    );
    this.logger.log(`[stt] /transcribe ok textLen=${text.length} preview="${text.slice(0, 60)}"`);
    return { text };
  }
}
