import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { hashPassword } from '../auth/password';
import { EventsService } from '../events/events.service';
import { EventSeverity, Prisma, Role } from '../generated/prisma/client';
import { isUniqueViolation } from '../prisma/prisma-errors';
import { PrismaService } from '../prisma/prisma.service';
import {
  RealtimeService,
  type SessionChange,
} from '../realtime/realtime.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import {
  type AuthUser,
  type PublicUser,
  publicUserSelect,
} from './user.select';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
    private readonly events: EventsService,
  ) {}

  findAll(): Promise<PublicUser[]> {
    return this.prisma.user.findMany({
      select: publicUserSelect,
      orderBy: { createdAt: 'asc' },
    });
  }

  async create(dto: CreateUserDto, actor: AuthUser): Promise<PublicUser> {
    const passwordHash = await hashPassword(dto.password);
    let user: PublicUser;
    try {
      user = await this.prisma.user.create({
        data: { username: dto.username, passwordHash, role: dto.role },
        select: publicUserSelect,
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('Username already exists');
      }
      throw error;
    }
    this.events.record({
      type: 'user.created',
      severity: EventSeverity.INFO,
      actor,
      data: { targetUsername: user.username, role: user.role },
    });
    return user;
  }

  async update(
    id: string,
    dto: UpdateUserDto,
    actor: AuthUser,
  ): Promise<PublicUser> {
    if (dto.role === undefined && dto.password === undefined) {
      throw new BadRequestException('Provide at least one of: role, password');
    }
    // Hash outside the transaction to keep the locks short.
    const passwordHash =
      dto.password === undefined ? undefined : await hashPassword(dto.password);

    const { user, changes, previousRole } = await this.withAdminsLocked(
      async (tx, adminIds) => {
        const target = await this.findTargetOrThrow(tx, id);
        const demotesAdmin =
          target.role === Role.ADMIN &&
          dto.role !== undefined &&
          dto.role !== Role.ADMIN;
        if (demotesAdmin) {
          assertAnotherAdminExists(adminIds, id);
        }
        const updated = await tx.user.update({
          where: { id },
          data: { role: dto.role, passwordHash },
          select: publicUserSelect,
        });
        const changes: SessionChange[] = [];
        if (dto.role !== undefined && dto.role !== target.role) {
          changes.push('role');
        }
        if (passwordHash !== undefined) changes.push('password');
        return { user: updated, changes, previousRole: target.role };
      },
    );
    // After the commit, so a client reloading itself sees the new state.
    // Announced before the events below are written: a stream learns the new
    // role before it is offered an event filtered by it.
    if (changes.length > 0) {
      this.realtime.sessionChanged(id, changes, user.role);
    }
    if (changes.includes('role')) {
      this.events.record({
        type: 'user.role_changed',
        severity: EventSeverity.INFO,
        actor,
        data: { targetUsername: user.username, previousRole, role: user.role },
      });
    }
    if (changes.includes('password')) {
      this.events.record({
        type: 'user.password_reset',
        severity: EventSeverity.INFO,
        actor,
        data: { targetUsername: user.username },
      });
    }
    return user;
  }

  async remove(id: string, actor: AuthUser): Promise<void> {
    if (id === actor.id) {
      throw new BadRequestException('You cannot delete your own account');
    }
    const target = await this.withAdminsLocked(async (tx, adminIds) => {
      const target = await this.findTargetOrThrow(tx, id);
      if (target.role === Role.ADMIN) {
        assertAnotherAdminExists(adminIds, id);
      }
      await tx.user.delete({ where: { id } });
      return target;
    });
    this.realtime.endSessions(id, 'deleted');
    this.events.record({
      type: 'user.deleted',
      severity: EventSeverity.INFO,
      actor,
      data: { targetUsername: target.username, role: target.role },
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
  ): Promise<{ username: string; role: Role }> {
    const target = await tx.user.findUnique({
      where: { id },
      select: { username: true, role: true },
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
