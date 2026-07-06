import { IsInt, Min } from 'class-validator';

export class UpdateSessionPetDto {
  @IsInt()
  @Min(1)
  sortOrder!: number;
}
