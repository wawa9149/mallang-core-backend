import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class SignupDto {
  @ApiProperty({ example: 'nayoung@example.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'malLang!2025', minLength: 8, maxLength: 64 })
  @IsString()
  @MinLength(8)
  @MaxLength(64)
  password!: string;

  @ApiProperty({ example: '나영', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(16)
  name?: string;
}
