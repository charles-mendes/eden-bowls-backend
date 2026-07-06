import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

export type AuditEventInput = {
  actorUserId?: string;
  actorRole?: string;
  action: string;
  resource: string;
  resourceId: string;
  beforeJson?: Prisma.InputJsonValue | null;
  afterJson?: Prisma.InputJsonValue | null;
  correlationId?: string;
};

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  record(event: AuditEventInput) {
    return this.prisma.auditLog.create({
      data: {
        actorUserId: event.actorUserId,
        actorRole: event.actorRole,
        action: event.action,
        resource: event.resource,
        resourceId: event.resourceId,
        beforeJson: event.beforeJson ?? undefined,
        afterJson: event.afterJson ?? undefined,
        correlationId: event.correlationId,
      },
    });
  }
}
