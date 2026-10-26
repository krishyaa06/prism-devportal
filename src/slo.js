// SLO math: error budgets and multi-window burn-rate alerts (Google SRE workbook).
export function errorBudget(sloPct, windowMin = 30 * 24 * 60) { const allowed = 1 - sloPct / 100; return { allowed, minutes: allowed * windowMin }; }
/** burn rate = observed error ratio / allowed error ratio */
export const burnRate = (errRatio, sloPct) => errRatio / Math.max(1e-9, 1 - sloPct / 100);
/** Fast+slow window check. samples: [{t, errors, total}] newest last. */
export function burnAlert(samples, sloPct, { fast = 5, slow = 30, threshold = 14.4 } = {}) {
  const win = (n) => { const s = samples.slice(-n); const e = s.reduce((a, x) => a + x.errors, 0), t = s.reduce((a, x) => a + x.total, 0); return t ? e / t : 0; };
  const bf = burnRate(win(fast), sloPct), bs = burnRate(win(slow), sloPct);
  return { fast: bf, slow: bs, firing: bf >= threshold && bs >= threshold / 2 };
}
