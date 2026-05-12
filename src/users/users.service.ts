import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export type PublicUser = Omit<User, 'passwordHash'>;

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  }

  async findByIdOrThrow(id: string): Promise<PublicUser> {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('User not found');
    return this.toPublic(user);
  }

  async create(input: { email: string; passwordHash: string; name?: string }): Promise<PublicUser> {
    const email = input.email.toLowerCase();
    const existing = await this.findByEmail(email);
    if (existing) {
      throw new ConflictException('EMAIL_TAKEN');
    }

    const user = await this.prisma.user.create({
      data: {
        email,
        passwordHash: input.passwordHash,
        name: input.name ?? email.split('@')[0],
      },
    });
    return this.toPublic(user);
  }

  toPublic(user: User): PublicUser {
    const { passwordHash: _passwordHash, ...rest } = user;
    return rest;
  }
}
