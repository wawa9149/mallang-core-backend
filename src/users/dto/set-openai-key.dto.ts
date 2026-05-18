import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class SetOpenAiKeyDto {
  @ApiProperty({
    description: '사용자의 OpenAI API 키 평문. 보통 "sk-"로 시작한다.',
    example: 'sk-...',
  })
  @IsString()
  @MinLength(20)
  apiKey!: string;
}
