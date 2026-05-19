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
    type: [String],
    description:
      'options 인덱스와 1:1로 매칭되는 식당 ID 배열. 추천 시스템이 만든 옵션에만 채워지며, 자유 입력 옵션 자리는 빈 문자열을 둔다. 전체 옵션이 자유 입력이면 생략 가능.',
    example: ['ckqv2x...', '', 'ckqw5y...'],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  restaurantIds?: string[];

  @ApiPropertyOptional({
    example: '2026-05-18T03:00:00.000Z',
    description: '마감 시각 (ISO-8601). 비우면 수동 마감만 가능.',
  })
  @IsOptional()
  @IsDateString()
  closesAt?: string;
}
