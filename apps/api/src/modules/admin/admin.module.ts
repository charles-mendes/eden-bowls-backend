import { Module } from '@nestjs/common';

import { PaymentsModule } from '../payments/payments.module';
import { AdminBillingController } from './admin-billing.controller';
import { AdminBillingService } from './admin-billing.service';
import { AdminConfigController } from './admin-config.controller';
import { AdminConfigService } from './admin-config.service';
import { AdminOnboardingController } from './admin-onboarding.controller';
import { AdminOnboardingService } from './admin-onboarding.service';

@Module({
  imports: [PaymentsModule],
  controllers: [
    AdminBillingController,
    AdminConfigController,
    AdminOnboardingController,
  ],
  providers: [AdminBillingService, AdminConfigService, AdminOnboardingService],
})
export class AdminModule {}