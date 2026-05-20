import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class SpeakDto {
  @ApiProperty({
    description:
      '말랑이가 발화할 텍스트. 너무 길면 Clova 응답 시간이 늘어나니 마이페이지 토글로 ON 인 사용자만 호출한다.',
    example: '오늘 점심 같이 먹을래?',
  })
  @IsString()
  @MinLength(1)
  // Clova Voice 는 한 호출당 최대 5000자(공식 문서). 우리는 채팅 한 줄 단위만 보내므로 충분히 줄여 둔다.
  @MaxLength(1000)
  text!: string;
}
