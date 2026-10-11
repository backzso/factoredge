import { plainToInstance } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsNumber,
  IsString,
  Matches,
  Max,
  Min,
  MinLength,
  validateSync,
} from 'class-validator';

export enum NodeEnv {
  Development = 'development',
  Production = 'production',
  Test = 'test',
}

export const DURATION_PATTERN = /^[1-9]\d*[smhd]$/;

export class EnvironmentVariables {
  @Matches(/^postgres(ql)?:\/\/.+/, {
    message: 'DATABASE_URL must be a postgresql:// connection string',
  })
  DATABASE_URL: string;

  @IsString()
  @MinLength(32)
  JWT_SECRET: string;

  @Matches(DURATION_PATTERN, {
    message:
      'JWT_EXPIRES_IN must be a positive number followed by s, m, h or d (e.g. 15m, 8h)',
  })
  JWT_EXPIRES_IN: string;

  @IsInt()
  @Min(1)
  @Max(65535)
  PORT: number = 3000;

  @IsEnum(NodeEnv)
  NODE_ENV: NodeEnv = NodeEnv.Development;

  /** Motor temperature alarm: raised at or above this value (°C). */
  @IsNumber(
    { allowNaN: false, allowInfinity: false },
    { message: 'TEMP_ALARM_RAISE_C must be a number (°C)' },
  )
  TEMP_ALARM_RAISE_C: number = 90;

  /** ...and cleared only at or below this one; must be lower (hysteresis). */
  @IsNumber(
    { allowNaN: false, allowInfinity: false },
    { message: 'TEMP_ALARM_CLEAR_C must be a number (°C)' },
  )
  TEMP_ALARM_CLEAR_C: number = 85;
}

/**
 * Fails fast at startup when a variable is missing or malformed.
 * Error messages name the variable and the rule, never the value.
 */
export function validateEnv(
  config: Record<string, unknown>,
): EnvironmentVariables {
  const env = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });
  const messages = validateSync(env).flatMap((error) =>
    Object.values(error.constraints ?? {}),
  );
  if (
    messages.length === 0 &&
    env.TEMP_ALARM_CLEAR_C >= env.TEMP_ALARM_RAISE_C
  ) {
    messages.push(
      'TEMP_ALARM_CLEAR_C must be lower than TEMP_ALARM_RAISE_C (the alarm would flap)',
    );
  }
  if (messages.length > 0) {
    const details = messages.map((message) => `  - ${message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${details}`);
  }
  return env;
}
