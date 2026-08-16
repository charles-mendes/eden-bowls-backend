const OTP_TTL_FLOOR_SECONDS = 900;
const OTP_TTL_DEFAULT_SECONDS = 600;

function effectiveOtpTtlSeconds(value) {
  const parsed = Number(value);
  const ttl = Number.isFinite(parsed) && parsed > 0 ? parsed : OTP_TTL_DEFAULT_SECONDS;
  return Math.max(OTP_TTL_FLOOR_SECONDS, ttl);
}

function buildOtpEmailContent({ otp, expiresInSeconds }) {
  const minutes = Math.max(1, Math.floor(Number(expiresInSeconds || OTP_TTL_FLOOR_SECONDS) / 60));

  return {
    subject: 'Your verification code',
    text: `Your Eden Bowls verification code is ${otp}. This code expires in ${minutes} minutes.`
  };
}

module.exports = {
  OTP_TTL_FLOOR_SECONDS,
  OTP_TTL_DEFAULT_SECONDS,
  effectiveOtpTtlSeconds,
  buildOtpEmailContent
};
