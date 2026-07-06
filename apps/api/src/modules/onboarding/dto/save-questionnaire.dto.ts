import { IsObject } from 'class-validator';

export class SaveQuestionnaireDto {
  @IsObject()
  answers!: Record<string, unknown>;
}
