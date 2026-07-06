import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, ShippingProvider } from '@prisma/client';
import { randomUUID } from 'crypto';

import { PrismaService } from '../prisma/prisma.service';
import { CreateShippingQuoteDto } from './dto/create-shipping-quote.dto';
import { SelectShippingRateDto } from './dto/select-shipping-rate.dto';

@Injectable()
export class ShippingService {
  constructor(private readonly prisma: PrismaService) {}

  async createQuote(sessionId: string, input: CreateShippingQuoteDto) {
    const country = input.destination.country.toUpperCase();
    const postcode = input.destination.postcode;
    const currency = (input.currency ?? this.resolveCurrency(country)).toUpperCase();
    const provider = this.resolveProvider(country);

    const subtotalNumber = input.items.reduce(
      (acc, item) => acc + item.quantity * item.unitPrice,
      0,
    );

    const subtotal = new Prisma.Decimal(this.roundMoney(subtotalNumber));
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000);

    const rates = this.buildRates(provider, country, currency, subtotalNumber);

    const quote = await this.prisma.$transaction(async (tx) => {
      const createdQuote = await tx.shippingQuote.create({
        data: {
          sessionId,
          provider,
          destinationCountry: country,
          destinationPostcode: postcode,
          currency,
          subtotal,
          expiresAt,
        },
      });

      const createdRates = [] as Array<{
        id: string;
        serviceCode: string;
        serviceLabel: string;
        amount: Prisma.Decimal;
        etaMinDays: number;
        etaMaxDays: number;
      }>;

      for (const rate of rates) {
        const created = await tx.shippingQuoteRate.create({
          data: {
            id: randomUUID(),
            quoteId: createdQuote.id,
            serviceCode: rate.serviceCode,
            serviceLabel: rate.serviceLabel,
            amount: new Prisma.Decimal(this.roundMoney(rate.amount)),
            etaMinDays: rate.etaMinDays,
            etaMaxDays: rate.etaMaxDays,
            rawJson: {
              provider,
              strategy: 'baseline_v1',
            },
          },
        });

        createdRates.push({
          id: created.id,
          serviceCode: created.serviceCode,
          serviceLabel: created.serviceLabel,
          amount: created.amount,
          etaMinDays: created.etaMinDays ?? 0,
          etaMaxDays: created.etaMaxDays ?? 0,
        });
      }

      return {
        id: createdQuote.id,
        expiresAt: createdQuote.expiresAt,
        rates: createdRates,
      };
    });

    return {
      quoteId: quote.id,
      rates: quote.rates.map((rate) => ({
        rateId: rate.id,
        serviceCode: rate.serviceCode,
        serviceLabel: rate.serviceLabel,
        amount: Number(rate.amount),
        etaMinDays: rate.etaMinDays,
        etaMaxDays: rate.etaMaxDays,
      })),
      expiresAt: quote.expiresAt,
    };
  }

  async selectRate(sessionId: string, input: SelectShippingRateDto) {
    const quote = await this.prisma.shippingQuote.findFirst({
      where: {
        id: input.quoteId,
        sessionId,
      },
      include: {
        rates: {
          where: {
            id: input.rateId,
          },
          take: 1,
        },
      },
    });

    if (!quote) {
      throw new NotFoundException('quote_not_found');
    }

    if (quote.expiresAt.getTime() <= Date.now()) {
      throw new ConflictException('quote_expired');
    }

    const rate = quote.rates[0];
    if (!rate) {
      throw new NotFoundException('rate_not_found');
    }

    await this.prisma.shippingQuote.update({
      where: { id: quote.id },
      data: {
        selectedRateId: rate.id,
      },
    });

    return {
      selectedShipping: {
        quoteId: quote.id,
        rateId: rate.id,
        provider: quote.provider,
        serviceCode: rate.serviceCode,
        serviceLabel: rate.serviceLabel,
        amount: Number(rate.amount),
        etaMinDays: rate.etaMinDays,
        etaMaxDays: rate.etaMaxDays,
        currency: quote.currency,
      },
    };
  }

  private resolveProvider(country: string): ShippingProvider {
    if (country === 'BR') {
      return 'manual_local';
    }

    if (country === 'US') {
      return 'usps';
    }

    return 'custom';
  }

  private resolveCurrency(country: string): string {
    if (country === 'BR') {
      return 'BRL';
    }

    if (country === 'US') {
      return 'USD';
    }

    return 'USD';
  }

  private buildRates(
    provider: ShippingProvider,
    country: string,
    currency: string,
    subtotal: number,
  ) {
    const base = country === 'BR' ? 19.9 : 12.5;
    const premium = country === 'BR' ? 34.9 : 24.5;

    const variable = subtotal > 200 ? -3 : 0;

    if (provider === 'manual_local') {
      return [
        {
          serviceCode: 'manual_local_standard',
          serviceLabel: 'Entrega local padrao',
          amount: base + variable,
          etaMinDays: 1,
          etaMaxDays: 2,
        },
        {
          serviceCode: 'manual_local_express',
          serviceLabel: 'Entrega local expressa',
          amount: premium + variable,
          etaMinDays: 0,
          etaMaxDays: 1,
        },
      ];
    }

    if (provider === 'usps') {
      return [
        {
          serviceCode: 'usps_ground',
          serviceLabel: `USPS Ground (${currency})`,
          amount: base + variable,
          etaMinDays: 3,
          etaMaxDays: 7,
        },
        {
          serviceCode: 'usps_priority',
          serviceLabel: `USPS Priority (${currency})`,
          amount: premium + variable,
          etaMinDays: 2,
          etaMaxDays: 4,
        },
      ];
    }

    return [
      {
        serviceCode: 'custom_standard',
        serviceLabel: `Custom Standard (${currency})`,
        amount: base + variable,
        etaMinDays: 4,
        etaMaxDays: 10,
      },
    ];
  }

  private roundMoney(value: number) {
    return Math.round(value * 100) / 100;
  }
}
