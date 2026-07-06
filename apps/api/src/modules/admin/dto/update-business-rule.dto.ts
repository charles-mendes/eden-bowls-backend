import { IsBoolean, IsISO8601, IsObject, IsOptional, ValidateIf } from 'class-validator';

export class UpdateBusinessRuleDto {
  @IsOptional()
  @IsObject()
  valueJson?: Record<string, unknown>;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @ValidateIf((_, value) => value !== undefined && value !== null)
  @IsISO8601()
  effectiveTo?: string | null;
}