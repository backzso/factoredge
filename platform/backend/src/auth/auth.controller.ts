import { Body, Controller, Get, HttpCode, Post, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { CookieOptions, Response } from 'express';
import { durationToSeconds } from '../config/duration';
import { EnvironmentVariables, NodeEnv } from '../config/env.validation';
import type { AuthUser } from '../users/user.select';
import { AuthService } from './auth.service';
import { ACCESS_TOKEN_COOKIE } from './auth.types';
import { CurrentUser } from './current-user.decorator';
import { LoginDto } from './dto/login.dto';
import { Public } from './public.decorator';

@Controller('auth')
export class AuthController {
  private readonly cookieOptions: CookieOptions;
  private readonly cookieMaxAgeMs: number;

  constructor(
    private readonly auth: AuthService,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    // clearCookie needs the same attributes as cookie, otherwise the browser keeps it.
    this.cookieOptions = {
      httpOnly: true,
      sameSite: 'strict',
      path: '/',
      secure: config.get('NODE_ENV', { infer: true }) === NodeEnv.Production,
    };
    this.cookieMaxAgeMs =
      durationToSeconds(config.get('JWT_EXPIRES_IN', { infer: true })) * 1000;
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ user: AuthUser }> {
    const user = await this.auth.validateCredentials(
      dto.username,
      dto.password,
    );
    const token = await this.auth.signAccessToken(user);
    res.cookie(ACCESS_TOKEN_COOKIE, token, {
      ...this.cookieOptions,
      maxAge: this.cookieMaxAgeMs,
    });
    // The token is only in the httpOnly cookie, never in the body.
    return { user };
  }

  // Public so an expired session can still clear its cookie.
  @Public()
  @Post('logout')
  @HttpCode(204)
  logout(@Res({ passthrough: true }) res: Response): void {
    res.clearCookie(ACCESS_TOKEN_COOKIE, this.cookieOptions);
  }

  @Get('me')
  me(@CurrentUser() user: AuthUser): { user: AuthUser } {
    return { user };
  }
}
