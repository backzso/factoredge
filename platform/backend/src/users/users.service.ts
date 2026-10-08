import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { hashPassword } from '../auth/password';
import { Prisma, Role } from '../generated/prisma/client';
import { isUniqueViolation } from '../prisma/prisma-errors';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { type PublicUser, publicUserSelect } from './user.select';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(): Promise<PublicUser[]> {
    return this.prisma.user.findMany({
      select: publicUserSelect,
      orderBy: { createdAt: 'asc' },
    });
  }

  async create(dto: CreateUserDto): Promise<PublicUser> {
    const passwordHash = await hashPassword(dto.password);
    try {
      return await this.prisma.user.create({
        data: { username: dto.username, passwordHash, role: dto.role },
        select: publicUserSelect,
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('Username already exists');
      }
      throw error;
    }
  }

  async update(id: string, dto: UpdateUserDto): Promise<PublicUser> {
    if (dto.role === undefined && dto.password === undefined) {
      throw new BadRequestException('Provide at least one of: role, password');
    }
    // Hash outside the transaction to keep the locks short.
    const passwordHash =
      dto.password === undefined ? undefined : await hashPassword(dto.password);

    return this.withAdminsLocked(async (tx, adminIds) => {
      const target = await this.findTargetOrThrow(tx, id);
      const demotesAdmin =
        target.role === Role.ADMIN &&
        dto.role !== undefined &&
        dto.role !== Role.ADMIN;
      if (demotesAdmin) {
        assertAnotherAdminExists(adminIds, id);
      }
      return tx.user.update({
        where: { id },
        data: { role: dto.role, passwordHash },
        select: publicUserSelect,
      });
    });
  }

  async remove(id: string, actorId: string): Promise<void> {
    if (id === actorId) {
      throw new BadRequestException('You cannot delete your own account');
    }
    await this.withAdminsLocked(async (tx, adminIds) => {
      const target = await this.findTargetOrThrow(tx, id);
      if (target.role === Role.ADMIN) {
        assertAnotherAdminExists(adminIds, id);
      }
      await tx.user.delete({ where: { id } });
    });
  }

  /**
   * Locks every ADMIN row before a user is changed or deleted, so two admins
   * removing each other at the same time cannot both see "2 admins" and leave none.
   * The second transaction waits for the first, then sees the committed state and
   * gets a 409 from the last-admin check instead of a serialization failure.
   *
   * - FOR UPDATE cannot be combined with count(*), so the rows are locked and
   *   counted in the application.
   * - ORDER BY id makes every transaction take the locks in the same order,
   *   so they queue instead of deadlocking (40P01).
   * - Reads after the lock run under READ COMMITTED with a fresh snapshot,
   *   so the target is re-read in its committed state.
   */
  private withAdminsLocked<T>(
    fn: (tx: Prisma.TransactionClient, adminIds: string[]) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      const admins = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM users
        WHERE role = ${Role.ADMIN}::"Role"
        ORDER BY id
        FOR UPDATE`;
      return fn(
        tx,
        admins.map((admin) => admin.id),
      );
    });
  }

  private async findTargetOrThrow(
    tx: Prisma.TransactionClient,
    id: string,
  ): Promise<{ role: Role }> {
    const target = await tx.user.findUnique({
      where: { id },
      select: { role: true },
    });
    if (!target) {
      throw new NotFoundException('User not found');
    }
    return target;
  }
}

function assertAnotherAdminExists(adminIds: string[], targetId: string): void {
  if (!adminIds.some((adminId) => adminId !== targetId)) {
    throw new ConflictException('The last admin cannot be removed or demoted');
  }
}
