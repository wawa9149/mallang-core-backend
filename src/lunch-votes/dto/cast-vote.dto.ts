import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class CastVoteDto {
  @ApiProperty({ description: 'LunchVoteOption.id' })
  @IsString()
  optionId!: string;
}
