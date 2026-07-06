import { IsEnum, IsObject, IsOptional, IsUUID } from 'class-validator';

export enum SubscriptionPatchAction {
  pause = 'pause',
  resume = 'resume',
  cancel = 'cancel',
  swap = 'swap',
}

export class UpdateSubscriptionDto {
  @IsEnum(SubscriptionPatchAction)
  action!: SubscriptionPatchAction;

  @IsOptional()
  @IsUUID()
  termId?: string;

  @IsOptional()
  @IsObject()
  payload?: Record<string, unknown>;
}
