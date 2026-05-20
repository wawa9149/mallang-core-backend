import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class SpeakDto {
  @ApiProperty({
    description:
      '말랑이가 발화할 텍스트. 너무 길면 Clova 응답 시간이 늘어나니 마이페이지 토글로 ON 인 사용자만 호출한다.',
    example: '오늘 점심 같이 먹을래?',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  text!: string;

  @ApiPropertyOptional({
    description:
      'LLM 이 추론한 말랑이의 현재 감정. Clova Voice emotion 파라미터에 매핑된다.',
    enum: ['happy', 'sad', 'angry', 'neutral', 'tired'],
    example: 'happy',
  })
  @IsOptional()
  @IsString()
  @IsIn(['happy', 'sad', 'angry', 'neutral', 'tired'])
  emotion?: string;

  @ApiPropertyOptional({
    description:
      '감정 강도 (0~100). EmotionLog.score 그대로 전달. 현재는 사용하지 않지만 향후 세밀 제어 확장용.',
    example: 70,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  emotionScore?: number;
}
