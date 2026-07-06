import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { AdminModule } from './modules/admin/admin.module';
import { AuthModule } from './modules/auth/auth.module';
import { AuditModule } from './modules/audit/audit.module';
import { EmailsModule } from './modules/emails/emails.module';
import { OnboardingModule } from './modules/onboarding/onboarding.module';
import { RecommendationModule } from './modules/recommendation/recommendation.module';
import { OrdersModule } from './modules/orders/orders.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { PetsModule } from './modules/pets/pets.module';
import { PrismaModule } from './modules/prisma/prisma.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { ProductsModule } from './modules/products/products.module';
import { PricingModule } from './modules/pricing/pricing.module';
import { CheckoutModule } from './modules/checkout/checkout.module';
import { ShippingModule } from './modules/shipping/shipping.module';
import { SubscriptionsModule } from './modules/subscriptions/subscriptions.module';
import { UsersModule } from './modules/users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AdminModule,
    AuthModule,
    AuditModule,
    EmailsModule,
    OnboardingModule,
    RecommendationModule,
    UsersModule,
    PetsModule,
    OrdersModule,
    PaymentsModule,
    CatalogModule,
    ProductsModule,
    PricingModule,
    CheckoutModule,
    ShippingModule,
    SubscriptionsModule,
  ],
})
export class AppModule {}
