import { Body, Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from './decorators/current-user.decorator';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { SignupDto } from './dto/signup.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import type { JwtUser } from './strategies/jwt.strategy';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly users: UsersService,
  ) {}

  @Post('signup')
  @ApiOkResponse({ description: '회원가입 + 토큰 발급' })
  signup(@Body() dto: SignupDto) {
    return this.auth.signup(dto.email, dto.password, dto.name);
  }

  @Post('login')
  @HttpCode(200)
  @ApiOkResponse({ description: '로그인 + 토큰 발급' })
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto.email, dto.password);
  }

  @Post('refresh')
  @HttpCode(200)
  @ApiOkResponse({ description: 'refresh token으로 access token 재발급(rotation)' })
  refresh(@Body() dto: RefreshDto) {
    return this.auth.refresh(dto.refreshToken);
  }

  @Post('logout')
  @HttpCode(204)
  @ApiOkResponse({ description: 'refresh token 폐기' })
  async logout(@Body() dto: RefreshDto) {
    await this.auth.logout(dto.refreshToken);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOkResponse({ description: '현재 access token의 사용자 프로필' })
  me(@CurrentUser() jwtUser: JwtUser) {
    return this.users.findByIdOrThrow(jwtUser.id);
  }
}
