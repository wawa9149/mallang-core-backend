import { ApiPropertyOptional } from '@nestjs/swagger';
import { Hobby } from '@prisma/client';
import {
  IsEnum,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

const TIME_REGEX = /^([01]?\d|2[0-3]):[0-5]\d$/;

export class UpdateMeDto {
  @ApiPropertyOptional({ example: '말랑이' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  name?: string;

  @ApiPropertyOptional({ enum: Hobby, example: 'rest' })
  @IsOptional()
  @IsEnum(Hobby)
  hobby?: Hobby;

  @ApiPropertyOptional({ example: '09:30', description: 'HH:mm' })
  @IsOptional()
  @IsString()
  @Matches(TIME_REGEX, { message: 'workStartTime must be HH:mm' })
  workStartTime?: string;

  @ApiPropertyOptional({ example: '12:30', description: 'HH:mm' })
  @IsOptional()
  @IsString()
  @Matches(TIME_REGEX, { message: 'lunchTime must be HH:mm' })
  lunchTime?: string;

  @ApiPropertyOptional({ example: '18:00', description: 'HH:mm' })
  @IsOptional()
  @IsString()
  @Matches(TIME_REGEX, { message: 'workEndTime must be HH:mm' })
  workEndTime?: string;

  @ApiPropertyOptional({ example: '땅콩' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  allergies?: string;

  @ApiPropertyOptional({
    example: '말랑컴퍼니',
    description: '빈 문자열을 보내면 회사 연결을 해제한다(팀도 함께 해제됨).',
  })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  companyName?: string;

  @ApiPropertyOptional({
    example: '말랑개발팀',
    description: '빈 문자열을 보내면 팀 연결만 해제한다. 같은 회사 + 같은 팀명이면 자동으로 합류한다.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  teamName?: string;
}
