import {
  Body,
  Controller,
  Delete,
  Get,
  Patch,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { JwtUser } from '../auth/strategies/jwt.strategy';
import { SetOpenAiKeyDto } from './dto/set-openai-key.dto';
import { UpdateMeDto } from './dto/update-me.dto';
import { UsersService, type PublicUser } from './users.service';

@ApiTags('users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('me')
  @ApiOkResponse({ description: '내 프로필' })
  getMe(@CurrentUser() user: JwtUser): Promise<PublicUser> {
    return this.users.findByIdOrThrow(user.id);
  }

  @Patch('me')
  @ApiOkResponse({ description: '프로필 업데이트 후의 내 프로필' })
  updateMe(
    @CurrentUser() user: JwtUser,
    @Body() body: UpdateMeDto,
  ): Promise<PublicUser> {
    return this.users.updateMe(user.id, body);
  }

  @Put('me/openai-key')
  @ApiOkResponse({ description: 'OpenAI API 키 등록/교체 후의 내 프로필' })
  setOpenAiKey(
    @CurrentUser() user: JwtUser,
    @Body() body: SetOpenAiKeyDto,
  ): Promise<PublicUser> {
    return this.users.setOpenAiKey(user.id, body.apiKey);
  }

  @Delete('me/openai-key')
  @ApiOkResponse({ description: 'OpenAI API 키 삭제 후의 내 프로필' })
  clearOpenAiKey(@CurrentUser() user: JwtUser): Promise<PublicUser> {
    return this.users.clearOpenAiKey(user.id);
  }
}
