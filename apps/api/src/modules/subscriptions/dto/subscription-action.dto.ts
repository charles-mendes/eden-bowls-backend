import { IsEnum } from 'class-validator';

export enum SubscriptionActionType {
  pause = 'pause',
  resume = 'resume',
  cancel = 'cancel',
  swap = 'swap',
}

export enum EffectiveMode {
  immediate = 'immediate',
  next_renewal = 'next_renewal',
}

export enum ProrationMode {
  none = 'none',
  prorated = 'prorated',
}

export class SubscriptionActionDto {
  @IsEnum(SubscriptionActionType)
  actionType!: SubscriptionActionType;

  @IsEnum(EffectiveMode)
  effectiveMode!: EffectiveMode;

  @IsEnum(ProrationMode)
  prorationMode!: ProrationMode;
}
