import { RecommendationController } from './recommendation.controller';
import { RecommendationService } from './recommendation.service';

describe('RecommendationController', () => {
  let service: {
    getRecommendation: jest.Mock;
    getPlanSnapshot: jest.Mock;
    previewPlan: jest.Mock;
  };
  let controller: RecommendationController;

  beforeEach(() => {
    service = {
      getRecommendation: jest.fn(),
      getPlanSnapshot: jest.fn(),
      previewPlan: jest.fn(),
    };
    controller = new RecommendationController(service as unknown as RecommendationService);
  });

  it('getRecommendation should delegate to service', async () => {
    service.getRecommendation.mockResolvedValue({ sessionId: 'session_1' });

    const output = await controller.getRecommendation('session_1', 'session-token', { userId: 'user_1', email: 'john@example.com', roles: ['customer'], permissions: [] });

    expect(service.getRecommendation).toHaveBeenCalledWith('session_1', 'session-token', { userId: 'user_1', email: 'john@example.com', roles: ['customer'], permissions: [] });
    expect(output).toEqual({ sessionId: 'session_1' });
  });

  it('getPlanSnapshot should delegate to service', async () => {
    service.getPlanSnapshot.mockResolvedValue({ snapshotId: 'snapshot_1' });

    const output = await controller.getPlanSnapshot('session_1', 'session-token', undefined);

    expect(service.getPlanSnapshot).toHaveBeenCalledWith('session_1', 'session-token', undefined);
    expect(output).toEqual({ snapshotId: 'snapshot_1' });
  });

  it('previewPlan should delegate to service', async () => {
    service.previewPlan.mockResolvedValue({ recommendation: { sessionId: 'session_1' }, preview: { snapshotId: 'snapshot_1' } });

    const output = await controller.previewPlan(
      'session_1',
      'session-token',
      { marketCountry: 'BR', currency: 'BRL' },
      undefined,
    );

    expect(service.previewPlan).toHaveBeenCalledWith('session_1', 'session-token', { marketCountry: 'BR', currency: 'BRL' }, undefined);
    expect(output).toEqual({ recommendation: { sessionId: 'session_1' }, preview: { snapshotId: 'snapshot_1' } });
  });
});
