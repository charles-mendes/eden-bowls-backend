import { IsObject } from 'class-validator';

export class SavePlanSelectionDto {
  @IsObject()
  selection!: Record<string, unknown>;
}
