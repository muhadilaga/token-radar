// Token Radar's model, version radar-2: one sealed snapshot in, one ranked board out.
//
// The board ranks every pre-token protocol the snapshot carries (the 40-slug watchlist is the
// floor, never the ceiling). A protocol is pre-token when its record carries no token at all:
// no market cap, no CoinGecko id, no symbol. Live-token protocols are set aside and shown at
// the market's own value, never mixed into the ranking.
//
// Implied value is one function of the snapshot's own figures, the same for every row:
//
//   size       = tvl_usd ^ size_power x size_scale        (sub-linear: launch value grows
//                                                          slower than locked value)
//   growth     = clamp(change_7d, growth_floor, growth_cap) in per cent
//   growthMult = 1 + (growth / 100) x growth_weight
//   maturity   = maturity_floor + maturity_peak x exp(-((age - peak_days) / spread_days)^2)
//                                                          (a hump: launch value peaks around
//                                                          two years of track record; very young
//                                                          is unproven, very old has likely
//                                                          decided not to launch)
//   chainMult  = 1 + chain_bonus x min(chains - 1, chain_bonus_cap)
//   derivMult  = derivative_discount for wrapped, staked, bridged or exchange products,
//                1 otherwise (a derivative's "launch" is its underlying's, not its own)
//   implied    = max(1, round(size x growthMult x maturity x chainMult x derivMult))
//
// Derivative products are scored the same way but ranked separately: the board holds only
// clean, standalone launches. A wrapped, staked or bridged product is not a protocol still
// waiting on a launch of its own, so ranking it beside one would rank the wrong thing.
//
// No protocol name is ever special-cased. The dashboard states the constants and lets the reader
// move them in a sandbox; the submitted board always uses the defaults below.

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

/** The model's constants, as the dashboard states them and the sandbox may move them. */
export interface ModelConstants {
  size_power: number;
  size_scale: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_peak: number;
  maturity_peak_days: number;
  maturity_spread_days: number;
  chain_bonus: number;
  chain_bonus_cap: number;
  derivative_discount: number;
  unknown_age_days: number;
}

export const MODEL: ModelConstants = {
  size_power: 0.5,
  size_scale: 5000,
  growth_weight: 0.6,
  growth_floor: -50,
  growth_cap: 100,
  maturity_floor: 0.55,
  maturity_peak: 0.6,
  maturity_peak_days: 730,
  maturity_spread_days: 800,
  chain_bonus: 0.04,
  chain_bonus_cap: 10,
  derivative_discount: 0.85,
  unknown_age_days: 365,
};

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-2';

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
    size_value: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
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
  size_value: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  chain_multiplier: number;
  derivative_multiplier: number;
  farm_steps: string[];
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

/** Everything the dashboard needs: the board, the live set, the derivatives, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
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

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

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

/** The factors and the implied value one protocol gets under `model`. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants,
): {
  implied: number;
  sizeValue: number;
  growthPct: number;
  growthMult: number;
  maturityMult: number;
  chainMult: number;
  derivativeMult: number;
  age: number | null;
} {
  const age = ageDays(asOf, protocol.listed_at);
  const sizeValue = Math.max(1, Math.round(Math.pow(protocol.tvl_usd, model.size_power) * model.size_scale));
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const z = (ageForModel - model.maturity_peak_days) / model.maturity_spread_days;
  const maturityMult = model.maturity_floor + model.maturity_peak * Math.exp(-(z * z));
  const extraChains = Math.min(Math.max(protocol.chains.length - 1, 0), model.chain_bonus_cap);
  const chainMult = 1 + model.chain_bonus * extraChains;
  const derivativeMult = isDerivativeType(protocol) ? model.derivative_discount : 1;
  const implied = Math.max(1, Math.round(sizeValue * growthMult * maturityMult * chainMult * derivativeMult));
  return { implied, sizeValue, growthPct, growthMult, maturityMult, chainMult, derivativeMult, age };
}

/** The protocols the board ranks, strongest first, with ranks 1..n. Clean launches only:
 * a derivative product is scored the same way but ranked separately (see derivativeRows). */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
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
    const v = impliedValue(p, snapshot.as_of, model);
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
      size_value: s.v.sizeValue,
      growth_pct: s.v.growthPct,
      growth_multiplier: round4(s.v.growthMult),
      maturity_multiplier: round4(s.v.maturityMult),
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
export function derivativeRows(snapshot: Snapshot, model: ModelConstants = MODEL): RadarRow[] {
  const scored = snapshot.protocols
    .filter((p) => isRankable(p) && isDerivativeType(p))
    .map((p) => {
      const v = impliedValue(p, snapshot.as_of, model);
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
    size_value: s.v.sizeValue,
    growth_multiplier: round4(s.v.growthMult),
    maturity_multiplier: round4(s.v.maturityMult),
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

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time. The plan is derived
 * from the protocol's own record (category, chains, TVL, age), never from a hand-written list
 * of names. It is a plan for qualifying activity, not a promise of any allocation.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  return [
    {
      text: 'Open a fresh wallet for this farm only, fund it with the capital below, and keep its seed phrase offline.',
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: mainActionFor(p, capital, chain),
      cost: `$${capital} of capital and about $${capital >= 150 ? 8 : 4} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: weeklyActionFor(p),
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: `Keep the position open for at least ${hold} days, so the activity lands in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: "Before you touch a withdrawal, open the protocol's own points or rewards page and claim only through the link it publishes.",
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: 'Write the wallet, the dates and every transaction hash in a farm log, then plan the unwind before the token launches.',
      cost: 'nothing but the log',
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

/** A board row's compact form for data.js, farm plan included. */
export function radarRow(row: BoardRow): RadarRow {
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
    size_value: row.model.size_value,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    chain_multiplier: row.model.chain_multiplier,
    derivative_multiplier: row.model.derivative_multiplier,
    farm_steps: row.farm_steps,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const derivatives = derivativeRows(snapshot, model);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    // The snapshot's source names its API endpoint with a scheme; the shipped data keeps the
    // provenance readable but scheme-free, so no output file carries a URL.
    source: snapshot.source.replace(/https?:\/\//g, ''),
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    derivative_size: derivatives.length,
    rows: board.map(radarRow),
    live,
    derivatives,
  };
  return { board, radar };
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
