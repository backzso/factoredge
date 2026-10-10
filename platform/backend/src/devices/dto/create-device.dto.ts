import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  Length,
} from 'class-validator';
import { Protocol } from '../../generated/prisma/client';

export const trimString = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class CreateDeviceDto {
  @Transform(trimString)
  @IsString()
  @Length(1, 64)
  name: string;

  @IsEnum(Protocol)
  protocol: Protocol;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  /** Shape depends on the protocol; validated with zod in DevicesService. */
  @IsObject()
  config: Record<string, unknown>;
}
