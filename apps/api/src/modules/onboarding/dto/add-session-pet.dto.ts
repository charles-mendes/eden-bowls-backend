import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class AddSessionPetDto {
  @IsString()
  @MaxLength(36)
  petId!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  sortOrder?: number;
}
