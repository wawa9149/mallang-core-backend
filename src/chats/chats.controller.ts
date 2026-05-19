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

  @Get('recent')
  @ApiOkResponse({ description: '최근 채팅 (오래된 순, 기본 30개)' })
  recent(
    @CurrentUser() user: JwtUser,
    @Query('limit', new DefaultValuePipe(30), ParseIntPipe) limit: number,
  ): Promise<PublicChatMessage[]> {
    return this.chats.listRecent(user.id, limit);
  }
}
