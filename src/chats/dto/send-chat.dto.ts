import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ChatIntent } from '@prisma/client';
import { IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class SendChatDto {
  @ApiProperty({ example: '오늘 좀 지치네', maxLength: 200 })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  content!: string;

  @ApiPropertyOptional({
    enum: ChatIntent,
    default: ChatIntent.free,
    description: '인텐트. 자동 메시지에서는 morning_check 등을 명시한다.',
  })
  @IsOptional()
  @IsEnum(ChatIntent)
  intent?: ChatIntent;
}
