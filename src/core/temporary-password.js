const crypto = require('crypto');

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*';
const DEFAULT_LENGTH = 20;

function generateTemporaryPassword(length = DEFAULT_LENGTH) {
  const size = Math.max(16, Number(length) || DEFAULT_LENGTH);
  const bytes = crypto.randomBytes(size);
  let password = '';

  for (let index = 0; index < size; index += 1) {
    password += ALPHABET[bytes[index] % ALPHABET.length];
  }

  return password;
}

module.exports = {
  generateTemporaryPassword
};
