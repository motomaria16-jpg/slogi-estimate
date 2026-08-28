import {
  BrowserlessClient,
  resolveBrowserlessTimeoutProfile,
  resolveHourlyBrowserlessPolicy,
  type BrowserlessPageClient,
  type EnvironmentReader,
  type HourlyBrowserlessPolicy,
} from '../_shared/listings/browserless.ts';
import { listingFreshnessDecision } from '../_shared/listings/freshness.ts';
import { isCompleteListing } from '../_shared/listings/parsing.ts';
import { providerBySource } from '../_shared/listings/providers/index.ts';
import {
  SupabaseListingServerStore,
  type ListingServerStore,
  type QueueFinish,
  type QueueItem,
  type RunFinish,
} from '../_shared/listings/server-store.ts';
import type { BrowserlessAttemptSummary, BrowserlessPage, ListingSource, NormalizedListing } from '../_shared/listings/types.ts';

const CRON_HEADER = 'x-slogi-listing-cron-secret';
const SOURCES = new Set<ListingSource>(['cian']);

export const HYDRATION_LIMITS = Object.freeze({
  // The SQL claim RPC independently clamps to two rows. Keep the runtime
  // contract identical so configuration cannot imply a larger daily batch.
  defaultBatch: 2,
  hardBatch: 2,
  runSlotMinutes: 60,
  defaultConcurrency: 1,
  hardConcurrency: 1,
  browserlessCallsPerItem: 1,
  defaultRuntimeMs: 75_000,
  minRuntimeMs: 100,
  hardRuntimeMs: 90_000,
  defaultVisibilityMs: 10 * 60_000,
  minVisibilityMs: 5 * 60_000,
  maxVisibilityMs: 60 * 60_000,
  unknownDateMaxAttempts: 2,
  transientMaxAttempts: 4,
});

export interface HydrateDependencies {
  environment?: EnvironmentReader;
  client?: BrowserlessPageClient;
  store?: ListingServerStore;
  now?: () => Date;
  workerId?: () => string;
}

interface ItemOutcome {
  status: QueueFinish['status'];
  parsed: number;
  partial: number;
  blocked: number;
  failed: number;
  inserted: number;
  updated: number;
  skippedOld: number;
  skippedUnknownDate: number;
  errorCode: string | null;
  attemptSummaries?: BrowserlessAttemptSummary[];
}

class HydrationRuntimeError extends Error {
  constructor() {
    super('hydration_runtime_budget_exceeded');
    this.name = 'HydrationRuntimeError';
  }
}

function runtimeEnvironment(): EnvironmentReader {
  return { get: (name: string) => typeof Deno !== 'undefined' ? Deno.env.get(name) : undefined };
}

function setting(environment: EnvironmentReader, name: string, fallback: number, min: number, max: number): number {
  const value = Math.trunc(Number(environment.get(name)));
  return Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
}

function secretMatches(provided: string, expected: string): boolean {
  const encoder = new TextEncoder();
  const left = encoder.encode(String(provided || ''));
  const right = encoder.encode(String(expected || ''));
  const length = Math.max(left.length, right.length, 1);
  let difference = left.length ^ right.length;
  for (let index = 0; index < length; index += 1) difference |= (left[index] || 0) ^ (right[index] || 0);
  return right.length > 0 && difference === 0;
}

function isSource(value: unknown): value is ListingSource {
  return typeof value === 'string' && SOURCES.has(value as ListingSource);
}

function hydrationSlot(value: Date): string {
  const minute = Math.floor(value.getUTCMinutes() / HYDRATION_LIMITS.runSlotMinutes) * HYDRATION_LIMITS.runSlotMinutes;
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate(), value.getUTCHours(), minute)).toISOString();
}

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function safeCode(value: unknown): string {
  return String(value || '').toLowerCase().replace(/[^a-z0-9_:\-]/g, '_').slice(0, 100) || 'provider_error';
}

function lazyClient(environment: EnvironmentReader): BrowserlessPageClient {
  let client: BrowserlessPageClient | null = null;
  return {
    async fetchPage(url, options) {
      if (!client) client = BrowserlessClient.fromEnvironment(environment);
      return client.fetchPage(url, options);
    },
  };
}

function transient(code: string): boolean {
  return /network|timeout|http_(?:408|429|5xx)$/.test(code);
}

function retryDelayMs(attemptCount: number): number {
  return [15 * 60_000, 60 * 60_000, 6 * 60 * 60_000][Math.max(0, Math.min(2, attemptCount - 1))];
}

function safeDiagnostic(values: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(values).filter(([name, value]) => {
    if (['string', 'number', 'boolean'].includes(typeof value)) return true;
    return name === 'attemptSummaries' && Array.isArray(value);
  }));
}

function attempts(page: BrowserlessPage): BrowserlessAttemptSummary[] {
  return page.attemptSummaries || [];
}

async function mapLimit<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const output = new Array<R>(items.length);
  let cursor = 0;
  async function run(): Promise<void> {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      output[index] = await worker(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return output;
}

async function finish(
  store: ListingServerStore,
  item: QueueItem,
  workerId: string,
  status: QueueFinish['status'],
  finishedAt: string,
  nextAttemptAt: string | null,
  errorCode: string | null,
  diagnostic: Record<string, unknown>,
): Promise<void> {
  const completed = await store.finishQueue(item.id, workerId, {
    status, finishedAt, nextAttemptAt, errorCode, diagnostic: safeDiagnostic(diagnostic),
  });
  if (!completed) throw new Error('queue_item_ownership_lost');
}

async function processItem(
  source: ListingSource,
  item: QueueItem,
  workerId: string,
  now: Date,
  store: ListingServerStore,
  client: BrowserlessPageClient,
  policy: HourlyBrowserlessPolicy,
  runtimeSignal: AbortSignal,
): Promise<ItemOutcome> {
  const finishedAt = now.toISOString();
  const provider = providerBySource(source);
  const canonical = provider.validateAndCanonicalizeUrl(item.listingUrl);
  if (!canonical.ok || !canonical.canonicalUrl) {
    await finish(store, item, workerId, 'failed', finishedAt, null, 'queue_url_rejected', { attemptCount: item.attemptCount });
    return { status: 'failed', parsed: 0, partial: 0, blocked: 0, failed: 1, inserted: 0, updated: 0, skippedOld: 0, skippedUnknownDate: 0, errorCode: 'queue_url_rejected' };
  }

  let attemptSummaries: BrowserlessAttemptSummary[] = [];
  try {
    const page = await client.fetchPage(canonical.canonicalUrl, {
      includeLinks: false,
      allowUnblock: false,
      directUnblock: policy.directUnblock,
      strategies: [policy.strategy],
      retryCount: 0,
      ...resolveBrowserlessTimeoutProfile(source, 'card', policy.strategy),
      signal: runtimeSignal,
    });
    attemptSummaries = attempts(page);
    if (runtimeSignal.aborted) throw new HydrationRuntimeError();
    if (page.status === 'blocked') {
      const code = safeCode(page.blockReason || 'blocked');
      await finish(store, item, workerId, 'blocked', finishedAt, null, code, { attemptCount: item.attemptCount, strategy: page.strategy || '', attemptSummaries });
      return { status: 'blocked', parsed: 0, partial: 0, blocked: 1, failed: 0, inserted: 0, updated: 0, skippedOld: 0, skippedUnknownDate: 0, errorCode: code, attemptSummaries };
    }
    if (page.status === 'error') {
      const code = safeCode(page.errorCode);
      const retry = transient(code) && item.attemptCount < HYDRATION_LIMITS.transientMaxAttempts;
      const status: QueueFinish['status'] = retry ? 'retry' : 'failed';
      const next = retry ? new Date(now.getTime() + retryDelayMs(item.attemptCount)).toISOString() : null;
      await finish(store, item, workerId, status, finishedAt, next, code, { attemptCount: item.attemptCount, retryScheduled: retry, attemptSummaries });
      return { status, parsed: 0, partial: 0, blocked: 0, failed: retry ? 0 : 1, inserted: 0, updated: 0, skippedOld: 0, skippedUnknownDate: 0, errorCode: code, attemptSummaries };
    }
    if (page.statusCode === 404) {
      await store.markRemoved(source, canonical.canonicalUrl, finishedAt, runtimeSignal);
      await finish(store, item, workerId, 'completed', finishedAt, null, 'listing_removed', { attemptCount: item.attemptCount, removed: true, attemptSummaries });
      return { status: 'completed', parsed: 1, partial: 0, blocked: 0, failed: 0, inserted: 0, updated: 0, skippedOld: 0, skippedUnknownDate: 0, errorCode: null, attemptSummaries };
    }

    const listing = provider.parseListing(page, canonical.canonicalUrl, finishedAt);
    if (listing.marketStatus === 'removed') {
      await store.markRemoved(source, canonical.canonicalUrl, finishedAt, runtimeSignal);
      await finish(store, item, workerId, 'completed', finishedAt, null, 'listing_removed', { attemptCount: item.attemptCount, removed: true, attemptSummaries });
      return { status: 'completed', parsed: 1, partial: 0, blocked: 0, failed: 0, inserted: 0, updated: 0, skippedOld: 0, skippedUnknownDate: 0, errorCode: null, attemptSummaries };
    }
    const freshness = listingFreshnessDecision(listing, now);
    const complete = isCompleteListing(listing);
    const partial = complete ? 0 : 1;
    if (freshness === 'old') {
      await finish(store, item, workerId, 'discarded_old', finishedAt, null, 'listing_older_than_30_days', { attemptCount: item.attemptCount, completeness: listing.parseCompleteness, partial: !complete, attemptSummaries });
      return { status: 'discarded_old', parsed: 1, partial, blocked: 0, failed: 0, inserted: 0, updated: 0, skippedOld: 1, skippedUnknownDate: 0, errorCode: null, attemptSummaries };
    }
    if (freshness !== 'recent') {
      const retry = item.attemptCount < HYDRATION_LIMITS.unknownDateMaxAttempts;
      const status: QueueFinish['status'] = retry ? 'retry' : 'discarded_unknown_date';
      const next = retry ? new Date(now.getTime() + 24 * 60 * 60_000).toISOString() : null;
      await finish(store, item, workerId, status, finishedAt, next, 'missing_or_invalid_freshness_date', { attemptCount: item.attemptCount, completeness: listing.parseCompleteness, partial: !complete, retryScheduled: retry, attemptSummaries });
      return { status, parsed: 1, partial, blocked: 0, failed: 0, inserted: 0, updated: 0, skippedOld: 0, skippedUnknownDate: 1, errorCode: retry ? 'missing_or_invalid_freshness_date' : null, attemptSummaries };
    }

    if (runtimeSignal.aborted) throw new HydrationRuntimeError();
    const recentListing = complete ? listing : {
      ...listing,
      address: listing.address || null,
    } as NormalizedListing;
    const persisted = await store.persistRecent(source, [recentListing], finishedAt, runtimeSignal);
    await finish(store, item, workerId, 'completed', finishedAt, null, complete ? null : 'partial_listing_persisted', {
      attemptCount: item.attemptCount, completeness: listing.parseCompleteness, partial: !complete,
      warningCount: listing.parseWarnings.length, strategy: page.strategy || '', attemptSummaries,
    });
    return { status: 'completed', parsed: 1, partial, blocked: 0, failed: 0, inserted: persisted.inserted, updated: persisted.updated, skippedOld: 0, skippedUnknownDate: 0, errorCode: null, attemptSummaries };
  } catch (error) {
    if (error instanceof HydrationRuntimeError || runtimeSignal.aborted) throw new HydrationRuntimeError();
    const code = safeCode(error instanceof Error ? error.message : error);
    const retry = item.attemptCount < HYDRATION_LIMITS.transientMaxAttempts;
    const status: QueueFinish['status'] = retry ? 'retry' : 'failed';
    const next = retry ? new Date(now.getTime() + retryDelayMs(item.attemptCount)).toISOString() : null;
    await finish(store, item, workerId, status, finishedAt, next, code, { attemptCount: item.attemptCount, retryScheduled: retry, attemptSummaries });
    return { status, parsed: 0, partial: 0, blocked: 0, failed: retry ? 0 : 1, inserted: 0, updated: 0, skippedOld: 0, skippedUnknownDate: 0, errorCode: code, attemptSummaries };
  }
}

export function createHydrateListingsHandler(dependencies: HydrateDependencies = {}): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    const environment = dependencies.environment || runtimeEnvironment();
    if (!secretMatches(request.headers.get(CRON_HEADER) || '', String(environment.get('SLOGI_LISTING_CRON_SECRET') || ''))) {
      return response({ status: 'unauthorized', error: 'Unauthorized' }, 401);
    }
    if (request.method !== 'POST') return response({ status: 'method_not_allowed', error: 'Method not allowed' }, 405);
    const body = await request.json().catch(() => null);
    const record = body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : null;
    if (!record || Object.keys(record).length !== 1 || !isSource(record.source)) {
      return response({ status: 'invalid_request', error: 'source must be cian' }, 400);
    }
    const source = record.source;
    let policy: HourlyBrowserlessPolicy;
    try { policy = resolveHourlyBrowserlessPolicy(source, environment); }
    catch { return response({ status: 'invalid_request', error: 'browserless_strategy_policy_invalid' }, 400); }
    let store = dependencies.store;
    if (!store) {
      try { store = new SupabaseListingServerStore(environment); }
      catch { return response({ status: 'provider_error', error: 'listing_server_store_not_configured' }, 503); }
    }

    const now = dependencies.now?.() || new Date();
    const startedAt = now.toISOString();
    const runtimeMs = setting(environment, 'SLOGI_LISTING_HYDRATION_RUNTIME_MS', HYDRATION_LIMITS.defaultRuntimeMs, HYDRATION_LIMITS.minRuntimeMs, HYDRATION_LIMITS.hardRuntimeMs);
    const batch = setting(environment, 'SLOGI_LISTING_HYDRATION_BATCH', HYDRATION_LIMITS.defaultBatch, 1, HYDRATION_LIMITS.hardBatch);
    const concurrency = setting(environment, 'SLOGI_LISTING_HYDRATION_CONCURRENCY', HYDRATION_LIMITS.defaultConcurrency, 1, HYDRATION_LIMITS.hardConcurrency);
    const visibilityMs = setting(environment, 'SLOGI_LISTING_HYDRATION_VISIBILITY_MS', HYDRATION_LIMITS.defaultVisibilityMs, HYDRATION_LIMITS.minVisibilityMs, HYDRATION_LIMITS.maxVisibilityMs);
    const runSlot = hydrationSlot(now);
    const staleBefore = new Date(now.getTime() - visibilityMs).toISOString();
    const workerId = dependencies.workerId?.() || crypto.randomUUID();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new HydrationRuntimeError()), runtimeMs);
    let runId: number | null = null;
    let outcomes: ItemOutcome[] = [];
    try {
      const claim = await store.claimRun(source, 'hydration', runSlot, startedAt, staleBefore, controller.signal);
      if (!claim.claimed || claim.runId == null) {
        return response({ status: 'completed', runSlot, source, outcome: { status: 'duplicate', claimed: 0, browserlessAttempts: 0 } });
      }
      runId = claim.runId;
      const state = await store.getState(source, controller.signal);
      state.lastHydrationStartedAt = startedAt;
      if (state.cooldownUntil && new Date(state.cooldownUntil).getTime() > now.getTime()) {
        await store.saveState(state, startedAt, controller.signal);
        await store.finishRun(runId, {
          status: 'cooldown', finishedAt: startedAt, metrics: {}, strategy: null,
          errorCode: state.lastHydrationErrorCode || 'cooldown',
          diagnostic: { browserlessAttempts: 0, cooldownActive: true, staleRunRecovered: claim.recovered },
        }, controller.signal);
        return response({ status: 'completed', runSlot, source, outcome: { status: 'cooldown', claimed: 0, browserlessAttempts: 0 } });
      }
      const items = await store.claimQueue(source, workerId, batch, startedAt, staleBefore, controller.signal);
      const client = dependencies.client || lazyClient(environment);
      outcomes = await mapLimit(items, concurrency, (item) => processItem(source, item, workerId, now, store!, client, policy, controller.signal));
      const blocked = outcomes.reduce((sum, value) => sum + value.blocked, 0);
      const failed = outcomes.reduce((sum, value) => sum + value.failed, 0);
      const retrying = outcomes.filter((value) => value.status === 'retry').length;
      const status: RunFinish['status'] = !items.length ? 'empty' : failed || blocked ? (outcomes.some((value) => value.status === 'completed') ? 'partial' : blocked ? 'blocked' : 'failed') : retrying ? 'partial' : 'ok';
      if (status === 'ok' || status === 'empty') {
        state.hydrationFailures = 0;
        state.lastHydrationSucceededAt = startedAt;
        state.lastHydrationErrorCode = null;
      } else {
        state.hydrationFailures += 1;
        state.lastHydrationErrorCode = outcomes.find((value) => value.errorCode)?.errorCode || status;
      }
      await store.saveState(state, startedAt, controller.signal);
      const sum = (field: keyof ItemOutcome) => outcomes.reduce((total, value) => total + (typeof value[field] === 'number' ? value[field] as number : 0), 0);
      await store.finishRun(runId, {
        status, finishedAt: new Date().toISOString(),
        metrics: {
          claimed: items.length, attempted: items.length, parsed: sum('parsed'), partial: sum('partial'),
          blocked, failed, inserted: sum('inserted'), updated: sum('updated'),
          skipped_old: sum('skippedOld'), skipped_unknown_date: sum('skippedUnknownDate'),
        },
        strategy: items.length ? policy.strategy : null,
        errorCode: status === 'ok' || status === 'empty' ? null : state.lastHydrationErrorCode,
        diagnostic: {
          browserlessAttempts: items.length,
          queueRetry: retrying,
          durationMs: Math.max(0, Date.now() - now.getTime()),
          staleRunRecovered: claim.recovered,
          attemptSummaries: outcomes.flatMap((value) => value.attemptSummaries || []),
        },
      }, controller.signal);
      return response({
        status: 'completed', runSlot, source,
        outcome: {
          status, claimed: items.length, browserlessAttempts: items.length,
          completed: outcomes.filter((value) => value.status === 'completed').length,
          retry: retrying, blocked, failed,
          discardedOld: outcomes.filter((value) => value.status === 'discarded_old').length,
          discardedUnknownDate: outcomes.filter((value) => value.status === 'discarded_unknown_date').length,
          attempts: outcomes.flatMap((value) => value.attemptSummaries || []),
        },
      });
    } catch (error) {
      const timedOut = error instanceof HydrationRuntimeError || controller.signal.aborted;
      const errorCode = timedOut ? 'runtime_budget_exceeded' : safeCode(error instanceof Error ? error.message : error);
      if (runId != null) {
        try {
          await store.finishRun(runId, {
            status: timedOut ? 'timed_out' : 'failed', finishedAt: new Date().toISOString(),
            metrics: { attempted: outcomes.length, failed: 1 }, strategy: null, errorCode,
            diagnostic: { browserlessAttempts: outcomes.length, runtimeMs, timedOut },
          });
        } catch { /* Best-effort terminal bookkeeping. */ }
      }
      return response({ status: timedOut ? 'timed_out' : 'completed', runSlot, source, outcome: { status: timedOut ? 'timed_out' : 'failed', errorCode } });
    } finally {
      clearTimeout(timer);
    }
  };
}

if (typeof Deno !== 'undefined' && import.meta.main) {
  Deno.serve(createHydrateListingsHandler());
}
