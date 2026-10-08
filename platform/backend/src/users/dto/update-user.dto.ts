import { IsByteLength, IsEnum, IsOptional, IsString } from 'class-validator';
import { Role } from '../../generated/prisma/client';
import {
  PASSWORD_MAX_BYTES,
  PASSWORD_MIN_BYTES,
  PASSWORD_RULE,
} from '../user.constraints';

/** At least one field is required; UsersService rejects an empty body. */
export class UpdateUserDto {
  @IsOptional()
  @IsEnum(Role)
  role?: Role;

  @IsOptional()
  @IsString()
  @IsByteLength(PASSWORD_MIN_BYTES, PASSWORD_MAX_BYTES, {
    message: PASSWORD_RULE,
  })
  password?: string;
}
