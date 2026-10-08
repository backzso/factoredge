import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

// Only shape checks here: the username/password rules are not revealed at login.
export class LoginDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  username: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  password: string;
}
