const crypto = require('crypto');

function generateOtp() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}

function hashOtp(otp, secret) {
  return crypto.createHmac('sha256', String(secret || 'otp')).update(String(otp || '')).digest('hex');
}

function otpMatches(otp, storedHash, secret) {
  const expected = Buffer.from(hashOtp(otp, secret));
  const actual = Buffer.from(String(storedHash || ''));

  if (expected.length !== actual.length) {
    return false;
  }

  return crypto.timingSafeEqual(expected, actual);
}

module.exports = {
  generateOtp,
  hashOtp,
  otpMatches
};
