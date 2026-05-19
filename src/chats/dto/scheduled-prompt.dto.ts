import { ApiProperty } from '@nestjs/swagger';
import { ChatIntent } from '@prisma/client';
import { IsEnum } from 'class-validator';

/**
 * 스케줄러로 자동 발사된 first-turn 요청. 사용자 발화 없이 intent 만 받아
 * 백엔드가 "질문만 던지는" LLM 응답을 생성해 돌려준다.
 */
export class ScheduledPromptDto {
  @ApiProperty({
    enum: ChatIntent,
    description: '스케줄러가 발사한 인텐트. 보통 morning_check / lunch_alert / lunch_review / evening_check.',
  })
  @IsEnum(ChatIntent)
  intent!: ChatIntent;
}
