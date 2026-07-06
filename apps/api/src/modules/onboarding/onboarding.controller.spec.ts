import { OnboardingController } from './onboarding.controller';
import { OnboardingService } from './onboarding.service';

describe('OnboardingController', () => {
  let service: {
    startSession: jest.Mock;
    getSession: jest.Mock;
    refreshToken: jest.Mock;
    addSessionPet: jest.Mock;
    updateSessionPet: jest.Mock;
    removeSessionPet: jest.Mock;
    saveQuestionnaire: jest.Mock;
    saveRecurrence: jest.Mock;
    savePlanSelection: jest.Mock;
    saveZipcode: jest.Mock;
    linkSessionToAccount: jest.Mock;
  };
  let controller: OnboardingController;

  beforeEach(() => {
    service = {
      startSession: jest.fn(),
      getSession: jest.fn(),
      refreshToken: jest.fn(),
      addSessionPet: jest.fn(),
      updateSessionPet: jest.fn(),
      removeSessionPet: jest.fn(),
      saveQuestionnaire: jest.fn(),
      saveRecurrence: jest.fn(),
      savePlanSelection: jest.fn(),
      saveZipcode: jest.fn(),
      linkSessionToAccount: jest.fn(),
    };
    controller = new OnboardingController(service as unknown as OnboardingService);
  });

  it('startSession should delegate to service', async () => {
    service.startSession.mockResolvedValue({ id: 'session_1' });

    const output = await controller.startSession({ country: 'BR' });

    expect(service.startSession).toHaveBeenCalledWith({ country: 'BR' });
    expect(output).toEqual({ id: 'session_1' });
  });

  it('getSession should delegate to service', async () => {
    service.getSession.mockResolvedValue({ id: 'session_1' });

    const output = await controller.getSession('session_1', 'session-token', undefined);

    expect(service.getSession).toHaveBeenCalledWith('session_1', 'session-token', undefined);
    expect(output).toEqual({ id: 'session_1' });
  });

  it('refreshSessionToken should delegate to service', async () => {
    service.refreshToken.mockResolvedValue({ id: 'session_1' });

    const output = await controller.refreshSessionToken('session_1', 'session-token', undefined);

    expect(service.refreshToken).toHaveBeenCalledWith('session_1', 'session-token', undefined);
    expect(output).toEqual({ id: 'session_1' });
  });

  it('addSessionPet should delegate to service', async () => {
    service.addSessionPet.mockResolvedValue({ id: 'session_pet_1' });

    const output = await controller.addSessionPet('session_1', 'session-token', { petId: 'pet_1' }, undefined);

    expect(service.addSessionPet).toHaveBeenCalledWith('session_1', 'session-token', { petId: 'pet_1' }, undefined);
    expect(output).toEqual({ id: 'session_pet_1' });
  });

  it('updateSessionPet should delegate to service', async () => {
    service.updateSessionPet.mockResolvedValue({ id: 'session_pet_1' });

    const output = await controller.updateSessionPet('session_1', 'pet_1', 'session-token', { sortOrder: 2 }, undefined);

    expect(service.updateSessionPet).toHaveBeenCalledWith('session_1', 'pet_1', 'session-token', { sortOrder: 2 }, undefined);
    expect(output).toEqual({ id: 'session_pet_1' });
  });

  it('removeSessionPet should delegate to service', async () => {
    service.removeSessionPet.mockResolvedValue({ success: true });

    const output = await controller.removeSessionPet('session_1', 'pet_1', 'session-token', undefined);

    expect(service.removeSessionPet).toHaveBeenCalledWith('session_1', 'pet_1', 'session-token', undefined);
    expect(output).toEqual({ success: true });
  });

  it('saveQuestionnaire should delegate to service', async () => {
    service.saveQuestionnaire.mockResolvedValue({ id: 'answer_1' });

    const output = await controller.saveQuestionnaire('session_1', 'session-token', { answers: { q1: 'yes' } }, undefined);

    expect(service.saveQuestionnaire).toHaveBeenCalledWith('session_1', 'session-token', { answers: { q1: 'yes' } }, undefined);
    expect(output).toEqual({ id: 'answer_1' });
  });

  it('saveRecurrence should delegate to service', async () => {
    service.saveRecurrence.mockResolvedValue({ id: 'answer_1' });

    const output = await controller.saveRecurrence('session_1', 'session-token', { recurrence: { frequency: 'weekly' } }, undefined);

    expect(service.saveRecurrence).toHaveBeenCalledWith('session_1', 'session-token', { recurrence: { frequency: 'weekly' } }, undefined);
    expect(output).toEqual({ id: 'answer_1' });
  });

  it('savePlanSelection should delegate to service', async () => {
    service.savePlanSelection.mockResolvedValue({ id: 'answer_1' });

    const output = await controller.savePlanSelection('session_1', 'session-token', { selection: { plan: 'monthly' } }, undefined);

    expect(service.savePlanSelection).toHaveBeenCalledWith('session_1', 'session-token', { selection: { plan: 'monthly' } }, undefined);
    expect(output).toEqual({ id: 'answer_1' });
  });

  it('saveZipcode should delegate to service', async () => {
    service.saveZipcode.mockResolvedValue({ id: 'answer_1' });

    const output = await controller.saveZipcode('session_1', 'session-token', { postcode: '01000-000', country: 'BR' }, undefined);

    expect(service.saveZipcode).toHaveBeenCalledWith('session_1', 'session-token', { postcode: '01000-000', country: 'BR' }, undefined);
    expect(output).toEqual({ id: 'answer_1' });
  });

  it('linkSessionToAccount should delegate to service', async () => {
    service.linkSessionToAccount.mockResolvedValue({ id: 'session_1' });

    const output = await controller.linkSessionToAccount('session_1', {
      userId: 'user_1',
      email: 'john@example.com',
      roles: ['customer'],
      permissions: [],
    });

    expect(service.linkSessionToAccount).toHaveBeenCalledWith('session_1', {
      userId: 'user_1',
      email: 'john@example.com',
      roles: ['customer'],
      permissions: [],
    });
    expect(output).toEqual({ id: 'session_1' });
  });
});
