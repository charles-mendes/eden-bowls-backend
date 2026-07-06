import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { OnboardingStatus } from '@prisma/client';
import { createHash } from 'crypto';

import { OnboardingService } from './onboarding.service';

type PrismaMock = {
  onboardingSession: {
    create: jest.Mock;
    findUnique: jest.Mock;
    update: jest.Mock;
  };
  onboardingSessionPet: {
    findMany: jest.Mock;
    aggregate: jest.Mock;
    upsert: jest.Mock;
    findUnique: jest.Mock;
    update: jest.Mock;
    deleteMany: jest.Mock;
  };
  onboardingAnswer: {
    findMany: jest.Mock;
    upsert: jest.Mock;
  };
  pet: {
    findFirst: jest.Mock;
  };
  $transaction: jest.Mock;
};

type AuditMock = {
  record: jest.Mock;
};

const makePrismaMock = (): PrismaMock => ({
  onboardingSession: {
    create: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  onboardingSessionPet: {
    findMany: jest.fn(),
    aggregate: jest.fn(),
    upsert: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    deleteMany: jest.fn(),
  },
  onboardingAnswer: {
    findMany: jest.fn(),
    upsert: jest.fn(),
  },
  pet: {
    findFirst: jest.fn(),
  },
  $transaction: jest.fn(),
});

const makeAuditMock = (): AuditMock => ({
  record: jest.fn(),
});

const sessionToken = 'a'.repeat(64);

const makeSession = (overrides: Record<string, unknown> = {}) => ({
  id: 'session_1',
  status: OnboardingStatus.started,
  linkedUserId: null,
  locale: 'pt-BR',
  country: 'BR',
  state: 'SP',
  tokenHash: createHash('sha256').update(sessionToken).digest('hex'),
  expiresAt: new Date('2099-01-01T00:00:00.000Z'),
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-02T00:00:00.000Z'),
  ...overrides,
});

describe('OnboardingService', () => {
  let prisma: PrismaMock;
  let audit: AuditMock;
  let service: OnboardingService;

  beforeEach(() => {
    prisma = makePrismaMock();
    audit = makeAuditMock();
    service = new OnboardingService(prisma as never, audit as never);
    jest.spyOn(Math, 'random').mockReturnValue(0.5);
    jest.spyOn(Date, 'now').mockReturnValue(new Date('2026-01-01T00:00:00.000Z').getTime());
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('startSession should create a session and token', async () => {
    prisma.onboardingSession.create.mockResolvedValue({
      id: 'session_1',
      status: OnboardingStatus.started,
      locale: 'pt-BR',
      country: 'BR',
      state: 'SP',
      expiresAt: new Date('2026-01-02T00:00:00.000Z'),
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    });

    const output = await service.startSession({ country: 'br', locale: 'pt-BR', state: 'SP' });

    expect(output.sessionToken).toEqual(expect.any(String));
    expect(prisma.onboardingSession.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          country: 'BR',
          state: 'SP',
          status: OnboardingStatus.started,
        }),
      }),
    );
  });

  it('getSession should reject invalid session token', async () => {
    prisma.onboardingSession.findUnique.mockResolvedValue(makeSession());

    await expect(service.getSession('session_1', 'wrong-token')).rejects.toThrow(ForbiddenException);
  });

  it('getSession should return pets and answers for a valid session', async () => {
    prisma.onboardingSession.findUnique.mockResolvedValue(makeSession());
    prisma.$transaction.mockResolvedValue([
      [
        {
          id: 'session_pet_1',
          sortOrder: 1,
          pet: {
            id: 'pet_1',
            userId: 'user_1',
            name: 'Thor',
            species: 'dog',
            weightKg: 10,
            activityLevel: 'moderate',
            deletedAt: null,
          },
        },
      ],
      [{ id: 'answer_1', stepKey: 'questionnaire' }],
    ]);

    const output = await service.getSession('session_1', sessionToken);

    expect(output.id).toBe('session_1');
    expect(output.pets).toHaveLength(1);
    expect(output.answers).toHaveLength(1);
  });

  it('refreshToken should rotate the token for a valid session', async () => {
    prisma.onboardingSession.findUnique.mockResolvedValue(makeSession());
    prisma.onboardingSession.update.mockResolvedValue({
      id: 'session_1',
      status: OnboardingStatus.started,
      expiresAt: new Date('2026-01-02T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T01:00:00.000Z'),
    });

    const output = await service.refreshToken('session_1', sessionToken);

    expect(output.sessionToken).toEqual(expect.any(String));
    expect(prisma.onboardingSession.update).toHaveBeenCalled();
  });

  it('addSessionPet should reject missing pet', async () => {
    prisma.onboardingSession.findUnique.mockResolvedValue(makeSession());
    prisma.pet.findFirst.mockResolvedValue(null);

    await expect(
      service.addSessionPet('session_1', sessionToken, { petId: 'pet_1' }),
    ).rejects.toThrow(NotFoundException);
  });

  it('addSessionPet should upsert and audit relation', async () => {
    prisma.onboardingSession.findUnique.mockResolvedValue(makeSession());
    prisma.pet.findFirst.mockResolvedValue({ id: 'pet_1', userId: 'user_1' });
    prisma.onboardingSessionPet.aggregate.mockResolvedValue({ _max: { sortOrder: 1 } });
    prisma.onboardingSessionPet.upsert.mockResolvedValue({ id: 'session_pet_1' });
    prisma.onboardingSession.update.mockResolvedValue({ id: 'session_1', status: OnboardingStatus.in_progress });

    const output = await service.addSessionPet('session_1', sessionToken, { petId: 'pet_1' });

    expect(output.id).toBe('session_pet_1');
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'onboarding.session_pet.upsert' }));
  });

  it('updateSessionPet should reject missing relation', async () => {
    prisma.onboardingSession.findUnique.mockResolvedValue(makeSession());
    prisma.onboardingSessionPet.findUnique.mockResolvedValue(null);

    await expect(
      service.updateSessionPet('session_1', 'pet_1', sessionToken, { sortOrder: 2 }),
    ).rejects.toThrow(NotFoundException);
  });

  it('removeSessionPet should soft remove relation and audit', async () => {
    prisma.onboardingSession.findUnique.mockResolvedValue(makeSession());
    prisma.onboardingSessionPet.deleteMany.mockResolvedValue({ count: 1 });
    prisma.onboardingSession.update.mockResolvedValue({ id: 'session_1', status: OnboardingStatus.in_progress });

    const output = await service.removeSessionPet('session_1', 'pet_1', sessionToken);

    expect(output).toEqual({ success: true });
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'onboarding.session_pet.delete' }));
  });

  it('saveQuestionnaire should upsert an answer', async () => {
    prisma.onboardingSession.findUnique.mockResolvedValue(makeSession());
    prisma.onboardingAnswer.upsert.mockResolvedValue({ id: 'answer_1', stepKey: 'questionnaire' });

    const output = await service.saveQuestionnaire('session_1', sessionToken, { answers: { q1: 'yes' } });

    expect(output.id).toBe('answer_1');
    expect(prisma.onboardingAnswer.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          sessionId_stepKey: {
            sessionId: 'session_1',
            stepKey: 'questionnaire',
          },
        },
      }),
    );
  });

  it('linkSessionToAccount should link session and remove foreign pets', async () => {
    prisma.onboardingSession.findUnique.mockResolvedValue(makeSession());
    prisma.onboardingSession.update.mockResolvedValue({ id: 'session_1', linkedUserId: 'user_1', updatedAt: new Date('2026-01-01T02:00:00.000Z') });
    prisma.onboardingSessionPet.deleteMany.mockResolvedValue({ count: 0 });

    const output = await service.linkSessionToAccount('session_1', {
      userId: 'user_1',
      email: 'john@example.com',
      roles: ['customer'],
      permissions: [],
    });

    expect(output.linkedUserId).toBe('user_1');
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'onboarding.account_link' }));
  });

  it('getSession should reject missing sessions', async () => {
    prisma.onboardingSession.findUnique.mockResolvedValue(null);

    await expect(service.getSession('missing', sessionToken)).rejects.toThrow(NotFoundException);
  });
});
