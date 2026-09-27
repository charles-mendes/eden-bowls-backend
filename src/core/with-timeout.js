function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error('timeout');
      error.code = 'timeout';
      reject(error);
    }, ms);
  });

  return Promise.race([
    Promise.resolve(promise).finally(() => clearTimeout(timer)),
    timeout
  ]).finally(() => clearTimeout(timer));
}

module.exports = {
  withTimeout
};
