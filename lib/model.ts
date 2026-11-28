// Token Radar's model, version radar-3: one sealed snapshot in, one ranked board out.
//
// The board ranks every pre-token protocol the snapshot carries (the 40-slug watchlist is the
// floor, never the ceiling). A protocol is pre-token when its record carries no token at all:
// no market cap, no CoinGecko id, no symbol. Live-token protocols are set aside and shown at
// the market's own value, never mixed into the ranking.
//
// Implied value is FIT to the snapshot itself at runtime, in two parts:
//
//   launch value = 10 ^ (b0 + b1 x log10(TVL) + b3 x log10(age) + b4 x extra chains)
//     An OLS fit of log10(market cap) on the snapshot's traded-token protocols (the label is
//     the market cap the market itself assigned). Seven-day growth was fitted and DROPPED:
//     its effect is indistinguishable from zero (t = -1.3, p ~ 0.18) and flips sign across
//     sample splits, so the fit sets it to zero rather than let sampling noise punish
//     growing protocols. Growth is still shown per row and still drives the farm plan's
//     tripwire. The fit's numbers (n, R-squared, walk-forward and leave-one-out error) are
//     printed in the dashboard, as fitted, not as proof of precision: TVL is the only
//     signal with real bite (R-squared 0.18), and the page says so.
//
//   token odds   = 1 / (1 + exp(-(c0 + c1 x log10(age))))
//     A logistic fit of "records a token" on log10(age) over every protocol with a known
//     listing date. It is a COHORT rate, not a promise: the share of protocols of that age
//     that record a token (44% at one year, 55% at two, 66% at four). Older cohorts list
//     more often, so an old protocol with no token sits in a cohort where listing is
//     common. Age pulls both ways: older listed tokens are worth less at the same TVL
//     (b3 is negative), but older cohorts list tokens more often. The net effect is
//     shown per row.
//
//   implied      = max(1, round(launch value x token odds x derivative discount))
//
// Derivative products are scored the same way but ranked separately: the board holds only
// clean, standalone launches. A wrapped, staked or bridged product is not a protocol still
// waiting on a launch of its own, so ranking it beside one would rank the wrong thing.
//
// No protocol name is ever special-cased. The dashboard states the fitted coefficients and
// the validation numbers and lets the reader move them in a sandbox; the submitted board
// always uses the fitted values below.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** Constants the fit does not choose: the derivative discount, and the age in days used
 * when a protocol's listing date is unknown. */
export const FIT_DEFAULTS = {
  derivative_discount: 0.85,
  unknown_age_days: 365,
};

/** The fitted model, computed from the snapshot at runtime by fitModel(): the OLS launch
 * fit, the logistic token-odds fit, and the held-out validation numbers, all as fitted. */
export interface FittedModel {
  /** log10(launch value) = launch_intercept + launch_tvl x log10(TVL) + launch_age x log10(age) + launch_chains x extra chains. */
  launch_intercept: number;
  launch_tvl: number;
  launch_age: number;
  launch_chains: number;
  /** logit P(records a token) = odds_intercept + odds_age x log10(age). */
  odds_intercept: number;
  odds_age: number;
  derivative_discount: number;
  unknown_age_days: number;
  /** Traded-token protocols the launch fit used (market cap is the label). */
  fit_n: number;
  /** R-squared of the launch fit, on the log10 scale. */
  fit_r2: number;
  /** Leave-one-out error as a factor: 10 to the mean absolute log10 error over refits. */
  fit_loo_factor: number;
  /** Walk-forward error as a factor: fit on the oldest 70% by listing date, tested on the newest 30%. */
  fit_wf_factor: number;
  fit_wf_train: number;
  fit_wf_test: number;
  /** Protocols with a known listing date the odds fit used, and how many of them record a token. */
  odds_n: number;
  odds_with_token: number;
  /** Token odds at one, two and four years, from the fitted logistic curve. */
  odds_1y: number;
  odds_2y: number;
  odds_4y: number;
}

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-3';

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  launch_type: 'clean' | 'derivative';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    launch_value: number;
    odds: number;
    growth_multiplier: number;
    chain_multiplier: number;
    derivative_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row, farm plan included. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  launch_type: 'clean' | 'derivative';
  age_days: number | null;
  implied_value_usd: number;
  launch_value: number;
  odds: number;
  growth_multiplier: number;
  chain_multiplier: number;
  derivative_multiplier: number;
  farm_steps: string[];
  /** Per-row interpretation, board rows only (see buildRowContexts): category standing,
   * growth and age percentiles, the factor carrying the rank, and one sentence saying so.
   * Derivative rows carry no context. */
  catRank?: number;
  catSize?: number;
  growthPct?: number | null;
  agePct?: number | null;
  dominant?: 'size' | 'age' | 'chain';
  why?: string;
}

/** A live-token protocol: it already trades, so the board shows the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** How the snapshot's 758 protocols are accounted for: every protocol lands in exactly one
 * bucket, and the buckets add up to the snapshot. */
export interface Coverage {
  scanned: number;
  ranked: number;
  derivatives: number;
  live: number;
  /** Traded protocols beyond the live top 24. */
  traded_beyond_live: number;
  /** Traded protocols in the CEX category (never shown live). */
  traded_cex: number;
  /** Pre-token protocols in the CEX category. */
  cex_pre_token: number;
  /** Pre-token protocols whose name ends in a version marker. */
  versioned_pre_token: number;
  /** Anything the reasons above do not cover; zero on this snapshot, kept so the buckets
   * always add up. */
  other: number;
}

/** Everything the dashboard needs: the board, the live set, the derivatives, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  fit: FittedModel;
  model_version: string;
  watchlist_size: number;
  watchlist: string[];
  coverage: Coverage;
  board_size: number;
  early_size: number;
  live_size: number;
  derivative_size: number;
  rows: RadarRow[];
  live: LiveRow[];
  derivatives: RadarRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Categories that mark a wrapped, staked, bridged or exchange product of another protocol. */
const DERIVATIVE_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);

/** Exchange names a derivative product's name may start with. */
const EXCHANGE_PREFIXES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/**
 * Whether a protocol is a derivative of something else rather than a standalone launch:
 * a bridged, wrapped or staked product, or one named after an exchange. The house used the
 * same rule to draw the watchlist; the board keeps these rows but flags them and discounts
 * them, instead of pretending they are the same kind of launch.
 */
export function isDerivativeType(p: SnapshotProtocol): boolean {
  if (p.category !== null && DERIVATIVE_CATEGORIES.has(p.category)) return true;
  const name = p.name;
  if (/\b(wrapped|staked|staking)\b/i.test(name)) return true;
  for (const prefix of EXCHANGE_PREFIXES) {
    if (name === prefix || name.startsWith(`${prefix} `)) return true;
  }
  return false;
}

/** Whether a protocol is one the board may rank: pre-token, not an exchange, not a versioned pool. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** Solve A x = b by Gaussian elimination with partial pivoting. A is small (at most 4x4
 * here) and the solve is deterministic: same input, same output, no randomness anywhere.
 * A hair of ridge (1e-9 on the diagonal) keeps a near-singular system solvable. */
function solveLinear(a: number[][], b: number[]): number[] {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i]!]);
  for (let i = 0; i < n; i++) m[i]![i]! += 1e-9;
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(m[r]![col]!) > Math.abs(m[pivot]![col]!)) pivot = r;
    const tmp = m[col]!;
    m[col] = m[pivot]!;
    m[pivot] = tmp;
    const pv = m[col]![col]!;
    if (pv === 0) throw new SnapshotError('the model fit is singular');
    for (let r = col + 1; r < n; r++) {
      const f = m[r]![col]! / pv;
      for (let c = col; c <= n; c++) m[r]![c]! -= f * m[col]![c]!;
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = m[i]![n]!;
    for (let j = i + 1; j < n; j++) s -= m[i]![j]! * x[j]!;
    x[i] = s / m[i]![i]!;
  }
  return x;
}

/** Ordinary least squares for y on the rows of X: returns the coefficients. */
function ols(x: number[][], y: number[]): number[] {
  const k = x[0]!.length;
  const ata: number[][] = Array.from({ length: k }, () => new Array<number>(k).fill(0));
  const atb = new Array<number>(k).fill(0);
  for (let i = 0; i < x.length; i++) {
    for (let a = 0; a < k; a++) {
      atb[a]! += x[i]![a]! * y[i]!;
      for (let b = 0; b < k; b++) ata[a]![b]! += x[i]![a]! * x[i]![b]!;
    }
  }
  return solveLinear(ata, atb);
}

/** Extra chains, capped the way the old model capped them: at most 10 beyond the first. */
function extraChains(protocol: SnapshotProtocol): number {
  return Math.min(Math.max(protocol.chains.length - 1, 0), 10);
}

/** Age in days, capped at ten years so one ancient listing cannot stretch the log scale. */
function ageForFit(age: number | null, unknownAgeDays: number): number {
  const a = age ?? unknownAgeDays;
  return Math.min(Math.max(a, 1), 3650);
}

/** The launch fit's design row for one protocol: [1, log10(TVL), log10(age), extra chains]. */
function launchFeatures(protocol: SnapshotProtocol, asOf: string, unknownAgeDays: number): number[] {
  return [1, Math.log10(protocol.tvl_usd), Math.log10(ageForFit(ageDays(asOf, protocol.listed_at), unknownAgeDays)), extraChains(protocol)];
}

/** The token odds for an age in days, from a fitted logistic curve. */
function tokenOdds(age: number, oddsIntercept: number, oddsAge: number): number {
  const z = oddsIntercept + oddsAge * Math.log10(Math.max(1, age));
  return 1 / (1 + Math.exp(-z));
}

/**
 * Fit the radar-3 model to the snapshot itself, at runtime:
 *
 * Launch value: OLS of log10(market cap) on [1, log10(TVL), log10(age), extra chains]
 * over the traded-token protocols that carry a usable label (a positive market cap, a
 * listing date and a reported seven-day growth figure). Seven-day growth was fitted and
 * dropped: its coefficient is indistinguishable from zero (t = -1.3) and flips sign
 * across sample splits, so the fit sets it to zero instead of letting sampling noise
 * punish growing protocols.
 *
 * Token odds: a logistic fit of "records a token" on log10(age) over every protocol with
 * a known listing date, by Newton iterations from zero (deterministic).
 *
 * Validation is held out and honest: R-squared on the log10 scale, a walk-forward split
 * (fit on the oldest 70% by listing date, tested on the newest 30%) and leave-one-out
 * refits, each reported as an error factor (10 to the mean absolute log10 error).
 */
export function fitModel(snapshot: Snapshot): FittedModel {
  const unknownAgeDays = FIT_DEFAULTS.unknown_age_days;
  const labels = snapshot.protocols.filter(
    (p) =>
      !isPreToken(p) &&
      p.mcap_usd !== null &&
      p.mcap_usd > 0 &&
      p.tvl_usd > 0 &&
      p.listed_at !== null &&
      p.change_7d !== null,
  );
  if (labels.length < 10) throw new SnapshotError(`only ${labels.length} traded-token protocols can anchor the launch fit`);
  const design = labels.map((p) => launchFeatures(p, snapshot.as_of, unknownAgeDays));
  const target = labels.map((p) => Math.log10(p.mcap_usd as number));
  const beta = ols(design, target);
  const mean = target.reduce((s, v) => s + v, 0) / target.length;
  let ssRes = 0;
  let ssTot = 0;
  for (let i = 0; i < target.length; i++) {
    const pred = design[i]!.reduce((s, v, j) => s + v * beta[j]!, 0);
    ssRes += (target[i]! - pred) ** 2;
    ssTot += (target[i]! - mean) ** 2;
  }
  const r2 = ssTot === 0 ? 0 : 1 - ssRes / ssTot;
  // Walk-forward: oldest 70% by listing date trains, newest 30% tests. Ties break by slug.
  const order = labels
    .map((p, i) => i)
    .sort((a, b) => {
      const la = labels[a]!.listed_at as string;
      const lb = labels[b]!.listed_at as string;
      return la < lb ? -1 : la > lb ? 1 : labels[a]!.slug < labels[b]!.slug ? -1 : 1;
    });
  const split = Math.floor(0.7 * labels.length);
  const trainIdx = order.slice(0, split);
  const testIdx = order.slice(split);
  const betaWf = ols(trainIdx.map((i) => design[i]!), trainIdx.map((i) => target[i]!));
  let wfErr = 0;
  for (const i of testIdx) {
    const pred = design[i]!.reduce((s, v, j) => s + v * betaWf[j]!, 0);
    wfErr += Math.abs(target[i]! - pred);
  }
  const wfFactor = Math.pow(10, wfErr / testIdx.length);
  // Leave-one-out: one refit per label, the error on the held-out row.
  let looErr = 0;
  for (let held = 0; held < labels.length; held++) {
    const xs: number[][] = [];
    const ys: number[] = [];
    for (let i = 0; i < labels.length; i++) {
      if (i === held) continue;
      xs.push(design[i]!);
      ys.push(target[i]!);
    }
    const b = ols(xs, ys);
    const pred = design[held]!.reduce((s, v, j) => s + v * b[j]!, 0);
    looErr += Math.abs(target[held]! - pred);
  }
  const looFactor = Math.pow(10, looErr / labels.length);
  // Token odds: logistic fit of "records a token" on log10(age).
  const oddsRows = snapshot.protocols.filter((p) => p.listed_at !== null);
  const oddsX = oddsRows.map((p) => [1, Math.log10(Math.max(1, ageDays(snapshot.as_of, p.listed_at) ?? unknownAgeDays))]);
  const oddsY = oddsRows.map((p) => (isPreToken(p) ? 0 : 1));
  let w = [0, 0];
  for (let iter = 0; iter < 100; iter++) {
    const grad = [0, 0];
    const hess = [
      [0, 0],
      [0, 0],
    ];
    for (let i = 0; i < oddsRows.length; i++) {
      const z = oddsX[i]![0]! * w[0]! + oddsX[i]![1]! * w[1]!;
      const pr = 1 / (1 + Math.exp(-z));
      const d = oddsY[i]! - pr;
      const v = pr * (1 - pr);
      for (let a = 0; a < 2; a++) {
        grad[a]! += oddsX[i]![a]! * d;
        for (let b = 0; b < 2; b++) hess[a]![b]! += oddsX[i]![a]! * oddsX[i]![b]! * v;
      }
    }
    const step = solveLinear(hess, grad);
    w = [w[0]! + step[0]!, w[1]! + step[1]!];
    if (Math.max(Math.abs(step[0]!), Math.abs(step[1]!)) < 1e-12) break;
  }
  return {
    launch_intercept: beta[0]!,
    launch_tvl: beta[1]!,
    launch_age: beta[2]!,
    launch_chains: beta[3]!,
    odds_intercept: w[0]!,
    odds_age: w[1]!,
    derivative_discount: FIT_DEFAULTS.derivative_discount,
    unknown_age_days: unknownAgeDays,
    fit_n: labels.length,
    fit_r2: round4(r2),
    fit_loo_factor: round4(looFactor),
    fit_wf_factor: round4(wfFactor),
    fit_wf_train: trainIdx.length,
    fit_wf_test: testIdx.length,
    odds_n: oddsRows.length,
    odds_with_token: oddsY.reduce((s, v) => s + v, 0),
    odds_1y: round4(tokenOdds(365, w[0]!, w[1]!)),
    odds_2y: round4(tokenOdds(730, w[0]!, w[1]!)),
    odds_4y: round4(tokenOdds(1460, w[0]!, w[1]!)),
  };
}

/** The factors and the implied value one protocol gets under a fitted model. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  fit: FittedModel,
): {
  implied: number;
  launchValue: number;
  odds: number;
  growthMult: number;
  chainMult: number;
  derivativeMult: number;
  age: number | null;
} {
  const age = ageDays(asOf, protocol.listed_at);
  const ageFit = ageForFit(age, fit.unknown_age_days);
  const launchValue = Math.pow(10, fit.launch_intercept + fit.launch_tvl * Math.log10(protocol.tvl_usd) + fit.launch_age * Math.log10(ageFit) + fit.launch_chains * extraChains(protocol));
  const odds = tokenOdds(ageFit, fit.odds_intercept, fit.odds_age);
  // Growth was fitted and dropped (see fitModel): its multiplier is exactly 1.
  const growthMult = 1;
  const chainMult = Math.pow(10, fit.launch_chains * extraChains(protocol));
  const derivativeMult = isDerivativeType(protocol) ? fit.derivative_discount : 1;
  const implied = Math.max(1, Math.round(launchValue * odds * derivativeMult));
  return { implied, launchValue, odds, growthMult, chainMult, derivativeMult, age };
}

/** The protocols the board ranks, strongest first, with ranks 1..n. Clean launches only:
 * a derivative product is scored the same way but ranked separately (see derivativeRows). */
export function buildBoard(snapshot: Snapshot, fit: FittedModel): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug it names, when the snapshot carries it.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: every other rankable pre-token protocol, at any TVL, that is a clean
  // launch. The floor is where the house started, not where this radar stops.
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isRankable(p) && !isDerivativeType(p)) chosen.set(p.slug, p);
  }

  const scored = [...chosen.values()].map((p) => {
    const v = impliedValue(p, snapshot.as_of, fit);
    return { p, v };
  });
  scored.sort((a, b) => b.v.implied - a.v.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    launch_type: isDerivativeType(s.p) ? 'derivative' : 'clean',
    age_days: s.v.age,
    implied_value_usd: s.v.implied,
    model: {
      launch_value: Math.round(s.v.launchValue),
      odds: round4(s.v.odds),
      growth_multiplier: round4(s.v.growthMult),
      chain_multiplier: round4(s.v.chainMult),
      derivative_multiplier: round4(s.v.derivativeMult),
      age_days: s.v.age,
    },
    farm_steps: farmSteps(s.p, s.v.age).map(stepText),
  }));
}

/** The derivative products, scored the same way and ranked among themselves, strongest first.
 * They are not on the board: the board holds clean launches only. Their implied values carry
 * the derivative discount, and their farm plans are the same derivation as the board's. */
export function derivativeRows(snapshot: Snapshot, fit: FittedModel): RadarRow[] {
  const scored = snapshot.protocols
    .filter((p) => isRankable(p) && isDerivativeType(p))
    .map((p) => {
      const v = impliedValue(p, snapshot.as_of, fit);
      return { p, v };
    });
  scored.sort((a, b) => b.v.implied - a.v.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    launch_type: 'derivative',
    age_days: s.v.age,
    implied_value_usd: s.v.implied,
    launch_value: Math.round(s.v.launchValue),
    odds: round4(s.v.odds),
    growth_multiplier: round4(s.v.growthMult),
    chain_multiplier: round4(s.v.chainMult),
    derivative_multiplier: round4(s.v.derivativeMult),
    farm_steps: farmSteps(s.p, s.v.age).map(stepText),
  }));
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category family, in lowercase, for the farm plan's wording. */
function familyOf(p: SnapshotProtocol): string {
  const c = (p.category ?? '').toLowerCase();
  if (c.includes('liquid staking') || c.includes('restak') || c.includes('staking')) return 'staking';
  if (c.includes('bridge')) return 'bridge';
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral') || c.includes('borrow')) return 'lending';
  if (c.includes('dex') || c.includes('swap')) return 'dex';
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('option') || c.includes('future')) return 'perps';
  if (c.includes('prediction')) return 'prediction';
  if (c.includes('curator') || c.includes('allocator') || c.includes('vault')) return 'vault';
  if (c.includes('stable')) return 'stable';
  if (c.includes('rwa') || c.includes('real world') || c.includes('tokenized')) return 'rwa';
  if (c.includes('insurance')) return 'insurance';
  if (c.includes('yield') || c.includes('farm') || c.includes('aggregator')) return 'yield';
  return 'other';
}

/** The first move: what to do with the capital, in the protocol's own terms. */
function mainActionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const name = p.name;
  switch (familyOf(p)) {
    case 'staking':
      return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt token.`;
    case 'bridge':
      return `Bridge $${capital} of USDC into ${chain} through ${name}, then use the bridged funds inside its app.`;
    case 'lending':
      return `Supply $${capital} of USDC to ${name} on ${chain} and leave the supply earning.`;
    case 'dex':
      return `Add $${capital} of liquidity to ${name}'s deepest pool on ${chain} and keep the LP position.`;
    case 'perps':
      return `Deposit $${capital} of USDC as margin on ${name} and open one small hedged position.`;
    case 'prediction':
      return `Fund ${name} with $${capital} and take one small position in an open market.`;
    case 'vault':
      return `Deposit $${capital} into a ${name} vault on ${chain} and hold the vault shares.`;
    case 'stable':
      return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`;
    case 'rwa':
      return `Mint $${capital} of ${name}'s yield-bearing asset on ${chain} and hold it.`;
    case 'insurance':
      return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy live.`;
    case 'yield':
      return `Deposit $${capital} into ${name}'s highest-yield strategy on ${chain} and let it compound.`;
    default:
      return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
  }
}

/** The weekly move: one small qualifying action, different from the first one. */
function weeklyActionFor(p: SnapshotProtocol): string {
  switch (familyOf(p)) {
    case 'staking':
      return 'Open the staking rewards page, top up a small amount, and restake what accrues.';
    case 'bridge':
      return 'Bridge a small amount again and use it in the destination app, not the bridge alone.';
    case 'lending':
      return 'Borrow a small amount against your supply, then repay it in the same week.';
    case 'dex':
      return 'Swap a small amount through the pool you provide to, then leave the LP position alone.';
    case 'perps':
      return 'Open and close one small hedged position, and keep the margin posted.';
    case 'prediction':
      return 'Settle one position and take one new small position in a market that is still open.';
    case 'vault':
      return 'Top up the vault with a small deposit, or vote on a vault proposal when one is live.';
    case 'stable':
      return 'Mint or redeem a small amount of the stable asset, and check the peg holds.';
    case 'rwa':
      return 'Check the yield that accrued on your receipt and confirm the underlying is still held.';
    case 'insurance':
      return 'Review the cover terms and confirm the policy is still active for the week.';
    case 'yield':
      return 'Harvest a small amount of yield, or compound it back into the same strategy.';
    default:
      return 'Make one small qualifying action: a deposit, a swap, a borrow or a vote.';
  }
}

/** A number with at most two decimals, trailing zeros trimmed: 10.26, 25.5, 20. */
function fmtNum(n: number): string {
  return String(Math.round(n * 100) / 100);
}

/** Gas cost strings for one farm's first, setup and weekly transactions, by first chain. */
export interface GasTier {
  first: string;
  setup: string;
  weekly: string;
}

const GAS_ETH: GasTier = {
  first: 'about $5 to $20 of gas for the first transaction',
  setup: 'about $5 to $20 of gas',
  weekly: 'about $10 to $40 of gas a week',
};
const GAS_L2: GasTier = {
  first: 'under $1 of gas for the first transaction',
  setup: 'under $1 of gas',
  weekly: 'under $2 of gas a week',
};
const GAS_CHEAP_L1: GasTier = {
  first: 'under $0.50 of gas for the first transaction',
  setup: 'under $0.50 of gas',
  weekly: 'under $1 of gas a week',
};
const GAS_TRON: GasTier = {
  first: 'about $1 to $3 of gas for the first transaction',
  setup: 'about $1 to $3 of gas',
  weekly: 'about $2 to $5 of gas a week',
};
const GAS_FALLBACK: GasTier = {
  first: 'under $3 of gas for the first transaction',
  setup: 'under $3 of gas',
  weekly: 'about $2 of gas a week',
};

const GAS_L2_CHAINS = new Set([
  'arbitrum', 'optimism', 'base', 'ink', 'unichain', 'katana', 'mantle', 'blast', 'linea', 'scroll',
  'zksync', 'zksync era', 'mode', 'fraxtal',
]);
const GAS_CHEAP_L1_CHAINS = new Set([
  'solana', 'sui', 'aptos', 'near', 'avalanche', 'bsc', 'polygon', 'gnosis', 'fantom', 'celo',
]);

/** The gas tier of a protocol's first chain, by lowercase name. The snapshot spells BNB
 * Chain as "Binance" and zkSync as "zkSync Era", so those spellings map to their tiers too;
 * any chain with no tier falls back to the old flat figures rather than a guessed fee. */
export function gasFor(chain: string): GasTier {
  const c = chain.toLowerCase();
  if (c === 'ethereum') return GAS_ETH;
  if (c === 'tron') return GAS_TRON;
  if (c === 'bnb chain' || c === 'binance smart chain' || c === 'binance') return GAS_CHEAP_L1;
  if (GAS_L2_CHAINS.has(c)) return GAS_L2;
  if (GAS_CHEAP_L1_CHAINS.has(c)) return GAS_CHEAP_L1;
  return GAS_FALLBACK;
}

/** What can go wrong with this kind of farm, one line per family. */
export function riskFor(family: string): string {
  switch (family) {
    case 'staking':
      return "Staking risk: the receipt token can trade below the staked asset, and unbonding can take days.";
    case 'bridge':
      return 'Bridge risk: a bridge holds the funds it moves — a bridge failure can strand them.';
    case 'lending':
      return 'Lending risk: a sharp fall in collateral can liquidate the position — borrow far less than you supply.';
    case 'dex':
      return 'Dex risk: impermanent loss — if one side of the pair moves far, the LP can end worth less than holding.';
    case 'perps':
      return 'Perps risk: leverage cuts both ways, and funding can bleed a hedged position — keep the position small.';
    case 'prediction':
      return 'Prediction risk: a market can resolve against you in full — never stake more than you can afford to lose.';
    case 'vault':
      return "Vault risk: the curator's strategy can lose value, and the vault's holdings are the curator's choice — read them first.";
    case 'stable':
      return "Stable risk: a peg can break — watch the stable asset's price and the backing it claims.";
    case 'rwa':
      return 'RWA risk: the yield depends on an off-chain issuer and custodian — the token is only as sound as they are.';
    case 'insurance':
      return 'Insurance risk: a claim can be denied — read what the cover actually pays before you buy it.';
    case 'yield':
      return "Yield risk: the strategy's yield can fall, or the underlying can be exploited — check where the yield comes from.";
    default:
      return "Risk: a smart-contract bug can take the deposit — this protocol's code is the only backstop.";
  }
}

/** When to stop adding to this farm, from the row's own seven-day growth. */
export function tripwireFor(growth: number | null): string {
  if (growth !== null && growth < -5) {
    return `TVL is down ${fmtNum(Math.abs(growth))}% in the last week, so farm small and re-check in 7 days before adding more.`;
  }
  if (growth !== null && growth > 20) {
    return `TVL is up ${fmtNum(growth)}% in the last week, but one week is not a trend — re-check before adding more.`;
  }
  return 'If TVL falls 20% in a week, the premise weakens — re-check before topping up.';
}

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a time. The plan is derived
 * from the protocol's own record (category, chains, TVL, age), never from a hand-written list
 * of names. It is a plan for qualifying activity, not a promise of any allocation.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gas = gasFor(chain);
  return [
    {
      text: `Open a fresh wallet for this farm only, fund it on ${chain} with $${capital} for this farm, and keep its seed phrase offline.`,
      cost: gas.first,
      time: '5 minutes',
    },
    {
      text: mainActionFor(p, capital, chain),
      cost: `$${capital} of capital and ${gas.setup}`,
      time: '15 minutes to set up',
    },
    {
      text: weeklyActionFor(p),
      cost: gas.weekly,
      time: '10 minutes a week',
    },
    {
      text: `Keep the position open for at least ${hold} days, so the activity lands in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you touch a withdrawal, open ${p.name}'s own points or rewards page and claim only through the link it publishes.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Write the wallet, the dates and every transaction hash for ${p.name} in a farm log, then plan the unwind before the token launches.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
    {
      text: `Know the risk and when to stop: ${riskFor(familyOf(p))} ${tripwireFor(p.change_7d)}`,
      cost: 'nothing to check',
      time: '5 minutes',
    },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** Per-row interpretation of the board, computed from the snapshot alone: category standing,
 * growth and age percentiles, the factor carrying the rank, and one sentence saying so. */
export interface RowContext {
  catRank: number;
  catSize: number;
  growthPct: number | null;
  agePct: number | null;
  dominant: 'size' | 'age' | 'chain';
  why: string;
}

/** Short dollars, mirroring the dashboard's fmtUsd: $2.75B, $405.3M, $97.4M. */
function fmtUsdShort(n: number): string {
  if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
  if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
  if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
  return '$' + Math.round(n);
}

/** Short age, mirroring the dashboard's fmtAge: 1.5y, 214d, unknown. */
function fmtAgeShort(days: number | null): string {
  if (days === null) return 'unknown';
  if (days >= 365) return (days / 365).toFixed(1) + 'y';
  return Math.max(0, Math.round(days)) + 'd';
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

/** The share of `set` strictly smaller than `value`, as a whole percent. */
function percentile(value: number, set: number[]): number {
  return Math.round((set.filter((v) => v < value).length / set.length) * 100);
}

/** The one sentence that interprets a row's rank. Every clause comes from computed fields;
 * a driver whose clause cannot be stated truthfully (null age, a single chain) falls back
 * to the size sentence with the clauses that exist. Growth never carries a rank: the fit
 * sets its effect to zero (see fitModel), so it is not a candidate driver. */
function whySentence(
  row: BoardRow,
  ctx: { catRank: number; catSize: number; growthPct: number | null; agePct: number | null; dominant: RowContext['dominant'] },
): string {
  const tvl = fmtUsdShort(row.tvl_usd);
  const category = row.category ?? 'Other';
  if (ctx.dominant === 'age' && row.age_days !== null) {
    const oddsPct = Math.round(row.model.odds * 100);
    return `Age carries this rank: ${fmtAgeShort(row.age_days)} with no token puts this protocol in a cohort where ${oddsPct}% record a token, on ${tvl} of TVL.`;
  }
  if (ctx.dominant === 'chain' && row.chains.length > 1) {
    return `Breadth carries this rank: ${row.chains.length} chains lift the value by x${row.model.chain_multiplier.toFixed(2)}, on ${tvl} of TVL.`;
  }
  return `Size carries this rank: ${tvl} is #${ctx.catRank} of ${ctx.catSize} ${category} on the board.`;
}

/** A context for every board row. `dominant` is the factor whose value stands furthest above
 * the board median, over the size factor, the combined age factor (fitted launch-age effect
 * times token odds) and the chain factor; ties keep the earlier factor (size, then age,
 * then chain). Growth is not a candidate: the fit sets it to zero. */
export function buildRowContexts(board: BoardRow[], fit: FittedModel): Map<string, RowContext> {
  const sizeFactor = (r: BoardRow): number => Math.pow(10, fit.launch_tvl * Math.log10(r.tvl_usd));
  const ageFactor = (r: BoardRow): number => {
    const ageFit = ageForFit(r.age_days, fit.unknown_age_days);
    return Math.pow(10, fit.launch_age * Math.log10(ageFit)) * r.model.odds;
  };
  const chainFactor = (r: BoardRow): number => r.model.chain_multiplier;
  const medSize = median(board.map(sizeFactor));
  const medAge = median(board.map(ageFactor));
  const medChain = median(board.map(chainFactor));
  const medianTvl = median(board.map((r) => r.tvl_usd));
  const growthSet = board.filter((r) => r.change_7d !== null).map((r) => r.change_7d as number);
  const ageSet = board.filter((r) => r.age_days !== null).map((r) => r.age_days as number);
  const byCategory = new Map<string, BoardRow[]>();
  for (const r of board) {
    const cat = r.category ?? 'Other';
    const list = byCategory.get(cat) ?? [];
    list.push(r);
    byCategory.set(cat, list);
  }
  const contexts = new Map<string, RowContext>();
  for (const r of board) {
    const cat = r.category ?? 'Other';
    const siblings = [...(byCategory.get(cat) ?? [])].sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
    const catRank = siblings.findIndex((s) => s.slug === r.slug) + 1;
    const growthPct = r.change_7d === null ? null : percentile(r.change_7d, growthSet);
    const agePct = r.age_days === null ? null : percentile(r.age_days, ageSet);
    const ratios = {
      size: sizeFactor(r) / medSize,
      age: ageFactor(r) / medAge,
      chain: chainFactor(r) / medChain,
    };
    let dominant: RowContext['dominant'] = 'size';
    let best = ratios.size;
    if (ratios.age > best) {
      dominant = 'age';
      best = ratios.age;
    }
    if (ratios.chain > best) {
      dominant = 'chain';
      best = ratios.chain;
    }
    const partial = { catRank, catSize: siblings.length, growthPct, agePct, dominant };
    contexts.set(r.slug, { ...partial, why: whySentence(r, partial) });
  }
  return contexts;
}

/** A board row's compact form for data.js, farm plan included. The context, when given,
 * is the row's interpretation from buildRowContexts(); derivative rows carry none. */
export function radarRow(row: BoardRow, context?: RowContext): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    launch_type: row.launch_type,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    launch_value: row.model.launch_value,
    odds: row.model.odds,
    growth_multiplier: row.model.growth_multiplier,
    chain_multiplier: row.model.chain_multiplier,
    derivative_multiplier: row.model.derivative_multiplier,
    farm_steps: row.farm_steps,
    catRank: context?.catRank,
    catSize: context?.catSize,
    growthPct: context ? context.growthPct : undefined,
    agePct: context ? context.agePct : undefined,
    dominant: context?.dominant,
    why: context?.why,
  };
}

/** How the snapshot's protocols are accounted for: the board, the derivatives, the live
 * top 24, and everything set aside, with a reason each. The buckets always add up to
 * the snapshot; anything the reasons do not cover lands in `other`. */
export function buildCoverage(snapshot: Snapshot, board: BoardRow[], derivatives: RadarRow[], live: LiveRow[]): Coverage {
  const boardSlugs = new Set(board.map((r) => r.slug));
  const derivSlugs = new Set(derivatives.map((r) => r.slug));
  const liveSlugs = new Set(live.map((r) => r.slug));
  let tradedBeyondLive = 0;
  let tradedCex = 0;
  let cexPreToken = 0;
  let versionedPreToken = 0;
  let other = 0;
  for (const p of snapshot.protocols) {
    if (boardSlugs.has(p.slug) || derivSlugs.has(p.slug) || liveSlugs.has(p.slug)) continue;
    if (!isPreToken(p) && p.category === 'CEX') tradedCex++;
    else if (!isPreToken(p)) tradedBeyondLive++;
    else if (p.category === 'CEX') cexPreToken++;
    else if (VERSIONED.test(p.name)) versionedPreToken++;
    else other++;
  }
  return {
    scanned: snapshot.protocols.length,
    ranked: board.length,
    derivatives: derivatives.length,
    live: live.length,
    traded_beyond_live: tradedBeyondLive,
    traded_cex: tradedCex,
    cex_pre_token: cexPreToken,
    versioned_pre_token: versionedPreToken,
    other,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData; fit: FittedModel } {
  const fit = fitModel(snapshot);
  const board = buildBoard(snapshot, fit);
  const contexts = buildRowContexts(board, fit);
  const live = liveRows(snapshot);
  const derivatives = derivativeRows(snapshot, fit);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const coverage = buildCoverage(snapshot, board, derivatives, live);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    // The snapshot's source names its API endpoint with a scheme; the shipped data keeps the
    // provenance readable but scheme-free, so no output file carries a URL.
    source: snapshot.source.replace(/https?:\/\//g, ''),
    floor_usd: snapshot.floor_usd,
    fit,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    watchlist: [...snapshot.watchlist],
    coverage,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    derivative_size: derivatives.length,
    rows: board.map((r) => radarRow(r, contexts.get(r.slug))),
    live,
    derivatives,
  };
  return { board, radar, fit };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
