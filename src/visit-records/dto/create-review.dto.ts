import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateReviewDto {
  @ApiProperty({
    description: '오늘 점심 투표 ID (winner 식당에 대한 리뷰)',
  })
  @IsString()
  lunchVoteId!: string;

  @ApiProperty({
    description: '별점 (1~5)',
    minimum: 1,
    maximum: 5,
    example: 4,
  })
  @IsInt()
  @Min(1)
  @Max(5)
  rating!: number;

  @ApiPropertyOptional({
    description: '한 줄 메모 (선택)',
    example: '국물이 진해서 좋았어',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  note?: string;

  @ApiPropertyOptional({
    description: '또 가고 싶은지 (선택)',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  wantsAgain?: boolean;
}
