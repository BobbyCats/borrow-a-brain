export const UPDATE_INTERVAL = 7 * 86400000;
export const FEEDBACK_INTERVAL = 86400000;
export const retryDelay = failures => [3600000, 6 * 3600000, 86400000][Math.min(2, Math.max(0, failures - 1))];

export function compareVersions(a, b) {
  const valid = /^\d+\.\d+\.\d+$/u;
  if (!valid.test(a) || !valid.test(b)) throw new Error('版本必须是三个非负整数。');
  const x = a.split('.').map(Number), y = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i] ? 1 : -1;
  return 0;
}
