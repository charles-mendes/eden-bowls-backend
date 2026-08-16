function createOtpMailer(options = {}) {
  const logger = options.logger || { debug() {}, info() {}, error() {} };
  const nodeEnv = options.nodeEnv || process.env.NODE_ENV || 'development';

  return {
    async sendOtpEmail({ to, otp, expiresInSeconds }) {
      if (nodeEnv === 'production') {
        throw new Error('OTP mailer is not configured.');
      }

      logger.debug({ to, expiresInSeconds, otp }, 'OTP issued (development mailer).');
    }
  };
}

module.exports = {
  createOtpMailer
};
