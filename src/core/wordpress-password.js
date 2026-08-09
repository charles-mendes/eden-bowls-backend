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

function verifyPortablePhpass(password, storedHash) {
  const hash = String(storedHash || '');

  if (hash.length < 34) {
    return false;
  }

  const setting = hash.slice(0, 12);

  if (!setting.startsWith('$P$') && !setting.startsWith('$H$')) {
    return false;
  }

  const countLog2 = ITOA64.indexOf(setting[3]);

  if (countLog2 < 7 || countLog2 > 30) {
    return false;
  }

  const salt = setting.slice(4, 12);
  let digest = md5Buffer(Buffer.concat([Buffer.from(salt), Buffer.from(password)]));
  let count = 1 << countLog2;

  while (count > 0) {
    digest = md5Buffer(Buffer.concat([digest, Buffer.from(password)]));
    count -= 1;
  }

  const encoded = setting + encode64(digest, 16);
  return encoded.slice(0, 34) === hash;
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
  verifyWordpressPassword,
  verifyPortablePhpass
};
