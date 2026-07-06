import { IsObject } from 'class-validator';

export class SaveRecurrenceDto {
  @IsObject()
  recurrence!: Record<string, unknown>;
}
