import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class CreateLunchVoteDto {
  @ApiPropertyOptional({ example: '오늘 점심 뭐 먹지?' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  title?: string;

  @ApiProperty({
    type: [String],
    example: ['김밥', '돈가스', '샐러드'],
    description: '투표 옵션 라벨들. 최소 2개, 최대 10개.',
  })
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(10)
  @IsString({ each: true })
  options!: string[];

  @ApiPropertyOptional({
    example: '2026-05-18T03:00:00.000Z',
    description: '마감 시각 (ISO-8601). 비우면 수동 마감만 가능.',
  })
  @IsOptional()
  @IsDateString()
  closesAt?: string;
}
