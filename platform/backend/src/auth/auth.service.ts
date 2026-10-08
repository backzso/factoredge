import { randomUUID } from 'node:crypto';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { type AuthUser, authUserSelect } from '../users/user.select';
import type { JwtPayload } from './auth.types';
import { hashPassword, verifyPassword } from './password';

@Injectable()
export class AuthService {
  // Compared against when the username does not exist, so an unknown user and a
  // wrong password take the same time and return the same error.
  private readonly dummyHash = hashPassword(randomUUID());

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async validateCredentials(
    username: string,
    password: string,
  ): Promise<AuthUser> {
    const user = await this.prisma.user.findUnique({
      where: { username },
      select: { ...authUserSelect, passwordHash: true },
    });
    const passwordMatches = await verifyPassword(
      password,
      user?.passwordHash ?? (await this.dummyHash),
    );
    if (!user || !passwordMatches) {
      throw new UnauthorizedException('Invalid username or password');
    }
    return { id: user.id, username: user.username, role: user.role };
  }

  signAccessToken(user: AuthUser): Promise<string> {
    const payload: JwtPayload = { sub: user.id, role: user.role };
    return this.jwt.signAsync(payload);
  }
}
