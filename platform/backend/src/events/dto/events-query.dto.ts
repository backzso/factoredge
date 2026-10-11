import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class EventsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit: number = 50;

  /** nextCursor of the previous page. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  before?: string;

  @IsOptional()
  @IsUUID()
  deviceId?: string;
}
