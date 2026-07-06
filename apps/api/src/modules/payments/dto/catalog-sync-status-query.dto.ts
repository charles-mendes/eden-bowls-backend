import { IsOptional, IsString, MinLength } from 'class-validator';

export class CatalogSyncStatusQueryDto {
  @IsOptional()
  @IsString()
  @MinLength(8)
  syncJobId?: string;
}
