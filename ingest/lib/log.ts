const t = () => new Date().toISOString().slice(11, 19);

export const log = {
  info: (...a: unknown[]) => console.log(`\x1b[36m${t()}\x1b[0m`, ...a),
  warn: (...a: unknown[]) => console.warn(`\x1b[33m${t()} !\x1b[0m`, ...a),
  error: (...a: unknown[]) => console.error(`\x1b[31m${t()} ✗\x1b[0m`, ...a),
  ok: (...a: unknown[]) => console.log(`\x1b[32m${t()} ✓\x1b[0m`, ...a),
};
