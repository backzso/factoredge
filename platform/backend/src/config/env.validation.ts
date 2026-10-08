import { plainToInstance } from 'class-transformer';
import {
  IsEnum,
  IsInt,
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
  const errors = validateSync(env);
  if (errors.length > 0) {
    const details = errors
      .flatMap((error) => Object.values(error.constraints ?? {}))
      .map((message) => `  - ${message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${details}`);
  }
  return env;
}
