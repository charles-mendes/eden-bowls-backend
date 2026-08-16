const crypto = require('crypto');

const ITOA64 = './0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

function md5Buffer(value) {
  return crypto.createHash('md5').update(value).digest();
}

function md5Hex(value) {
  return crypto.createHash('md5').update(value).digest('hex');
}

function encode64(inputBuffer, count) {
  let output = '';
  let index = 0;

  do {
    let value = inputBuffer[index++];
    output += ITOA64[value & 0x3f];

    if (index < count) {
      value |= inputBuffer[index] << 8;
    }

    output += ITOA64[(value >> 6) & 0x3f];

    if (index++ >= count) {
      break;
    }

    if (index < count) {
      value |= inputBuffer[index] << 16;
    }

    output += ITOA64[(value >> 12) & 0x3f];

    if (index++ >= count) {
      break;
    }

    output += ITOA64[(value >> 18) & 0x3f];
  } while (index < count);

  return output;
}

function hashPortablePhpass(password, setting) {
  const countLog2 = ITOA64.indexOf(setting[3]);

  if (countLog2 < 7 || countLog2 > 30) {
    return '';
  }

  const salt = setting.slice(4, 12);
  let digest = md5Buffer(Buffer.concat([Buffer.from(salt), Buffer.from(password)]));
  let count = 1 << countLog2;

  while (count > 0) {
    digest = md5Buffer(Buffer.concat([digest, Buffer.from(password)]));
    count -= 1;
  }

  return (setting.slice(0, 12) + encode64(digest, 16)).slice(0, 34);
}

function generatePhpassSetting(countLog2 = 8) {
  const id = Math.min(30, Math.max(7, Number(countLog2) || 8));
  return `$P$${ITOA64[id]}${encode64(crypto.randomBytes(6), 6)}`;
}

function hashWordpressPassword(password, options = {}) {
  const normalizedPassword = String(password || '');

  if (!normalizedPassword || normalizedPassword.length > 4096) {
    return '*';
  }

  const setting = String(options.setting || generatePhpassSetting(options.countLog2)).slice(0, 12);

  if (!setting.startsWith('$P$') && !setting.startsWith('$H$')) {
    return '*';
  }

  return hashPortablePhpass(normalizedPassword, setting);
}

function verifyPortablePhpass(password, storedHash) {
  const hash = String(storedHash || '');

  if (hash.length < 34) {
    return false;
  }

  const setting = hash.slice(0, 12);

  if (!setting.startsWith('$P$') && !setting.startsWith('$H$')) {
    return false;
  }

  return hashPortablePhpass(password, setting) === hash;
}

function verifyWordpressPassword(password, storedHash) {
  const normalizedHash = String(storedHash || '').trim();

  if (!normalizedHash) {
    return false;
  }

  if (normalizedHash.startsWith('$P$') || normalizedHash.startsWith('$H$')) {
    return verifyPortablePhpass(password, normalizedHash);
  }

  if (/^[a-f0-9]{32}$/i.test(normalizedHash)) {
    return md5Hex(password) === normalizedHash.toLowerCase();
  }

  return false;
}

module.exports = {
  hashWordpressPassword,
  verifyWordpressPassword,
  verifyPortablePhpass
};
