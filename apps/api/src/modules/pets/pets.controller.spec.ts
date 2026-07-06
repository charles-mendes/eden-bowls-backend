import { PetsController } from './pets.controller';
import { PetsService } from './pets.service';

describe('PetsController', () => {
  let service: {
    listBreeds: jest.Mock;
    listMyPets: jest.Mock;
    createPet: jest.Mock;
    updatePet: jest.Mock;
    deletePet: jest.Mock;
  };
  let controller: PetsController;

  beforeEach(() => {
    service = {
      listBreeds: jest.fn(),
      listMyPets: jest.fn(),
      createPet: jest.fn(),
      updatePet: jest.fn(),
      deletePet: jest.fn(),
    };
    controller = new PetsController(service as unknown as PetsService);
  });

  it('listBreeds should delegate to service', async () => {
    service.listBreeds.mockResolvedValue([{ id: 'breed_1' }]);

    const output = await controller.listBreeds({ locale: 'en-US' });

    expect(service.listBreeds).toHaveBeenCalledWith({ locale: 'en-US' });
    expect(output).toEqual([{ id: 'breed_1' }]);
  });

  it('listMyPets should delegate to service', async () => {
    service.listMyPets.mockResolvedValue([{ id: 'pet_1' }]);

    const output = await controller.listMyPets({ userId: 'user_1', email: 'john@example.com', roles: ['customer'], permissions: [] });

    expect(service.listMyPets).toHaveBeenCalledWith('user_1');
    expect(output).toEqual([{ id: 'pet_1' }]);
  });

  it('createPet should delegate to service', async () => {
    service.createPet.mockResolvedValue({ id: 'pet_1' });

    const output = await controller.createPet(
      { userId: 'user_1', email: 'john@example.com', roles: ['customer'], permissions: [] },
      {
        name: 'Thor',
        species: 'dog',
        weightKg: 12,
        neutered: true,
        activityLevel: 'moderate',
      },
    );

    expect(service.createPet).toHaveBeenCalledWith('user_1', {
      name: 'Thor',
      species: 'dog',
      weightKg: 12,
      neutered: true,
      activityLevel: 'moderate',
    });
    expect(output).toEqual({ id: 'pet_1' });
  });

  it('updatePet should delegate to service', async () => {
    service.updatePet.mockResolvedValue({ id: 'pet_1' });

    const output = await controller.updatePet(
      { userId: 'user_1', email: 'john@example.com', roles: ['customer'], permissions: [] },
      'pet_1',
      { name: 'Bolt' },
    );

    expect(service.updatePet).toHaveBeenCalledWith('user_1', 'pet_1', { name: 'Bolt' });
    expect(output).toEqual({ id: 'pet_1' });
  });

  it('deletePet should delegate to service', async () => {
    service.deletePet.mockResolvedValue({ success: true });

    const output = await controller.deletePet(
      { userId: 'user_1', email: 'john@example.com', roles: ['customer'], permissions: [] },
      'pet_1',
    );

    expect(service.deletePet).toHaveBeenCalledWith('user_1', 'pet_1');
    expect(output).toEqual({ success: true });
  });
});
