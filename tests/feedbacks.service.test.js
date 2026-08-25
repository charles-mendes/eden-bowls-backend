const { FeedbacksService } = require('../src/services/feedbacks.service');
const { HttpError } = require('../src/core/http-error');

const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function item(overrides = {}) {
  return {
    id: 11,
    name: 'João Silva',
    category: 'tutor',
    country: 'BR',
    photo: '',
    place: 'São Paulo',
    comment: 'Muito bom.',
    active: true,
    createdAt: '2026-08-20T12:00:00.000Z',
    updatedAt: '2026-08-20T12:00:00.000Z',
    ...overrides
  };
}

describe('FeedbacksService', () => {
  test('creates a feedback and stores the photo', async () => {
    const created = item();
    const withPhoto = item({ photo: 'http://localhost:3000/feedback-photos/photo-11.png' });
    const repository = {
      create: jest.fn().mockResolvedValue(created),
      update: jest.fn().mockResolvedValue(withPhoto),
      delete: jest.fn()
    };
    const photoStorage = {
      write: jest.fn().mockResolvedValue(withPhoto.photo),
      delete: jest.fn()
    };
    const compressPhoto = jest.fn().mockResolvedValue({
      buffer: Buffer.from('webp'),
      mimeType: 'image/webp',
      ext: 'webp'
    });
    const service = new FeedbacksService(repository, { photoStorage, compressPhoto });

    const result = await service.create({
      name: 'João Silva',
      category: 'tutor',
      country: 'BR',
      comment: 'Muito bom.',
      active: true,
      photo: { mimeType: 'image/png', imageBase64: PNG_BASE64 }
    });

    expect(result.photo).toContain('/feedback-photos/');
    expect(compressPhoto).toHaveBeenCalledTimes(1);
    expect(photoStorage.write).toHaveBeenCalledWith(expect.objectContaining({
      feedbackId: 11,
      ext: 'webp'
    }));
    expect(repository.delete).not.toHaveBeenCalled();
  });

  test('rolls back the row when photo upload fails on create', async () => {
    const repository = {
      create: jest.fn().mockResolvedValue(item()),
      delete: jest.fn().mockResolvedValue(true)
    };
    const service = new FeedbacksService(repository, {
      photoStorage: {
        write: jest.fn().mockRejectedValue(new Error('disk full'))
      },
      compressPhoto: jest.fn().mockResolvedValue({
        buffer: Buffer.from('webp'),
        mimeType: 'image/webp',
        ext: 'webp'
      })
    });

    await expect(service.create({
      name: 'João Silva',
      category: 'tutor',
      country: 'BR',
      comment: 'Muito bom.',
      active: true,
      photo: { mimeType: 'image/png', imageBase64: PNG_BASE64 }
    })).rejects.toBeInstanceOf(HttpError);

    expect(repository.delete).toHaveBeenCalledWith(11);
  });

  test('lists only public fields for the storefront', async () => {
    const repository = {
      listPublic: jest.fn().mockResolvedValue([item({ photo: '/p.png', active: true })])
    };
    const service = new FeedbacksService(repository);

    const payload = await service.listPublic({ country: 'BR' });

    expect(payload).toEqual({
      success: true,
      data: {
        country: 'BR',
        items: [{
          id: 11,
          name: 'João Silva',
          category: 'tutor',
          country: 'BR',
          photo: '/p.png',
          place: 'São Paulo',
          comment: 'Muito bom.'
        }]
      }
    });
  });

  test('toggles publication status', async () => {
    const repository = {
      findById: jest.fn().mockResolvedValue(item({ active: true })),
      update: jest.fn().mockResolvedValue(item({ active: false }))
    };
    const service = new FeedbacksService(repository);

    const result = await service.setActive(11, false);

    expect(repository.update).toHaveBeenCalledWith(11, { active: false });
    expect(result.active).toBe(false);
  });
});
