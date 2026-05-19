import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class UpdateTeamLocationDto {
  @ApiPropertyOptional({
    description: '회사/사무실의 도로명 주소. 점심 추천의 반경 계산 기준이 된다.',
    maxLength: 200,
    example: '서울 강남구 테헤란로 152',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  address?: string | null;

  @ApiPropertyOptional({
    description: '추천 반경(미터). 100 ~ 5000 사이.',
    minimum: 100,
    maximum: 5000,
    example: 800,
  })
  @IsOptional()
  @IsInt()
  @Min(100)
  @Max(5000)
  searchRadiusMeters?: number;
}
