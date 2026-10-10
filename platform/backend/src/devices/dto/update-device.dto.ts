import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEmpty,
  IsObject,
  IsOptional,
  IsString,
  Length,
} from 'class-validator';
import { trimString } from './create-device.dto';

/** At least one field is required; DevicesService rejects an empty body. */
export class UpdateDeviceDto {
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @Length(1, 64)
  name?: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  /** Replaces the whole config; validated against the device's protocol. */
  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;

  // Declared only to answer with a clear message instead of "should not exist".
  @IsEmpty({
    message: 'protocol cannot be changed; delete and recreate the device',
  })
  protocol?: never;
}
