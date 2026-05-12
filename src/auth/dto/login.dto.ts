import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

export class LoginDto {
  @ApiProperty({ example: 'nayoung@example.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'malLang!2025' })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  password!: string;
}
