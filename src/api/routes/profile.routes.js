const { HttpError } = require('../../core/http-error');

function requireUserId(request) {
  if (!request.currentUser || !request.currentUser.id) {
    throw new HttpError(401, 'Authentication is required.', { code: 'unauthorized' });
  }

  return request.currentUser.id;
}

function requireProfileService(dependencies) {
  if (!dependencies.profileService) {
    throw new HttpError(503, 'Profile service is not available.');
  }

  return dependencies.profileService;
}

function registerProfileRoutes(app, dependencies = {}) {
  app.get('/api/v1/profile', async (request, response, next) => {
    try {
      const profileService = requireProfileService(dependencies);
      const data = await profileService.getProfile({ userId: requireUserId(request) });
      response.status(200).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  });

  async function updatePersonal(request, response, next) {
    try {
      const profileService = requireProfileService(dependencies);
      const data = await profileService.updatePersonal({
        userId: requireUserId(request),
        payload: request.body || {}
      });
      response.status(200).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  app.put('/api/v1/profile/personal', updatePersonal);
  app.patch('/api/v1/profile/personal', updatePersonal);

  async function updateDelivery(request, response, next) {
    try {
      const profileService = requireProfileService(dependencies);
      const data = await profileService.updateDelivery({
        userId: requireUserId(request),
        payload: request.body || {}
      });
      response.status(200).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  app.put('/api/v1/profile/delivery', updateDelivery);
  app.patch('/api/v1/profile/delivery', updateDelivery);

  async function changeEmail(request, response, next) {
    try {
      const profileService = requireProfileService(dependencies);
      const data = await profileService.changeEmail({
        userId: requireUserId(request),
        payload: request.body || {}
      });
      response.status(200).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  app.put('/api/v1/profile/email', changeEmail);
  app.patch('/api/v1/profile/email', changeEmail);

  async function changePassword(request, response, next) {
    try {
      const profileService = requireProfileService(dependencies);
      const data = await profileService.changePassword({
        userId: requireUserId(request),
        payload: request.body || {}
      });
      response.status(200).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  app.put('/api/v1/profile/password', changePassword);
  app.patch('/api/v1/profile/password', changePassword);

  app.post('/api/v1/profile/avatar', async (request, response, next) => {
    try {
      const profileService = requireProfileService(dependencies);
      const data = await profileService.uploadAvatar({
        userId: requireUserId(request),
        payload: request.body || {}
      });
      response.status(200).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  });

  app.delete('/api/v1/profile', async (request, response, next) => {
    try {
      const profileService = requireProfileService(dependencies);
      const data = await profileService.deleteAccount({ userId: requireUserId(request) });
      response.status(200).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  });
}

module.exports = {
  registerProfileRoutes
};
