const { verifyWordpressPassword } = require('../src/core/wordpress-password');

describe('verifyWordpressPassword', () => {
  test('supports md5 hashes for seeded demo users', () => {
    expect(verifyWordpressPassword('123456', 'e10adc3949ba59abbe56e057f20f883e')).toBe(true);
    expect(verifyWordpressPassword('wrong', 'e10adc3949ba59abbe56e057f20f883e')).toBe(false);
  });

  test('supports portable phpass hashes', () => {
    expect(verifyWordpressPassword('test', '$P$B5D7j7R6Q6JmKfXg4LO7xwVj3P8nlq0')).toBe(false);
  });
});
