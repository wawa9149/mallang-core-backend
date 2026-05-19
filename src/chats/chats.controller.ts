import {
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  ParseIntPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { ChatIntent } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { JwtUser } from '../auth/strategies/jwt.strategy';
import { ChatsService, type ChatTurnView, type PublicChatMessage } from './chats.service';
import { ScheduledPromptDto } from './dto/scheduled-prompt.dto';
import { SendChatDto } from './dto/send-chat.dto';

@ApiTags('chats')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('chats')
export class ChatsController {
  constructor(private readonly chats: ChatsService) {}

  @Post()
  @ApiOkResponse({
    description: '한 턴의 채팅 결과 — userMessage, assistantMessage, emotion 3개를 모두 반환한다.',
  })
  send(@CurrentUser() user: JwtUser, @Body() body: SendChatDto): Promise<ChatTurnView> {
    return this.chats.send(user.id, body.content, body.intent ?? ChatIntent.free);
  }

  @Post('scheduled-prompt')
  @ApiOkResponse({
    description:
      '스케줄러로 발사된 first-turn 응답. 사용자 발화 없이 말랑이가 먼저 던지는 질문을 만들어 돌려준다. leftOffice 같은 사용자 답변 기반 데이터는 채우지 않는다.',
  })
  scheduledPrompt(
    @CurrentUser() user: JwtUser,
    @Body() body: ScheduledPromptDto,
  ): Promise<{ assistantMessage: PublicChatMessage }> {
    return this.chats.scheduledPrompt(user.id, body.intent);
  }

  @Get('recent')
  @ApiOkResponse({ description: '최근 채팅 (오래된 순, 기본 30개)' })
  recent(
    @CurrentUser() user: JwtUser,
    @Query('limit', new DefaultValuePipe(30), ParseIntPipe) limit: number,
  ): Promise<PublicChatMessage[]> {
    return this.chats.listRecent(user.id, limit);
  }
}
