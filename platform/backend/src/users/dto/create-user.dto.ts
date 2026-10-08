import { IsByteLength, IsEnum, IsString, Matches } from 'class-validator';
import { Role } from '../../generated/prisma/client';
import {
  PASSWORD_MAX_BYTES,
  PASSWORD_MIN_BYTES,
  PASSWORD_RULE,
  USERNAME_PATTERN,
  USERNAME_RULE,
} from '../user.constraints';

export class CreateUserDto {
  @IsString()
  @Matches(USERNAME_PATTERN, { message: USERNAME_RULE })
  username: string;

  @IsString()
  @IsByteLength(PASSWORD_MIN_BYTES, PASSWORD_MAX_BYTES, {
    message: PASSWORD_RULE,
  })
  password: string;

  @IsEnum(Role)
  role: Role;
}
