import {
  BrowserlessClient,
  resolveBrowserlessTimeoutProfile,
  resolveHourlyBrowserlessPolicy,
  type BrowserlessPageClient,
  type EnvironmentReader,
  type HourlyBrowserlessPolicy,
} from '../_shared/listings/browserless.ts';
import { pageDiscoveryDiagnostics } from '../_shared/listings/parsing.ts';
import { providerBySource } from '../_shared/listings/providers/index.ts';
import { LISTING_SELECTION } from '../_shared/listings/selection.ts';
import { validateSupabaseServiceUrl } from '../_shared/listings/supabase-url.ts';
import {
  SupabaseListingServerStore,
  type ListingServerStore,
  type QueueEnqueueResult,
  type RunFinish,
} from '../_shared/listings/server-store.ts';
import type { BrowserlessAttemptSummary, BrowserlessPage, ListingSource } from '../_shared/listings/types.ts';

const CRON_HEADER = 'x-slogi-listing-cron-secret';
const SOURCES = new Set<ListingSource>(['cian']);

export const validateRefreshStoreUrl = validateSupabaseServiceUrl;

export const DISCOVERY_LIMITS = Object.freeze({
  browserlessCalls: 2,
  concurrency: 1,
  backfillPagesPerRun: 1,
  runSlotHours: 6,
  defaultRuntimeMs: 75_000,
  minRuntimeMs: 100,
  hardRuntimeMs: 90_000,
  defaultStaleRunMs: 15 * 60_000,
  minStaleRunMs: 5 * 60_000,
  maxStaleRunMs: 60 * 60_000,
});

export interface RefreshDependencies {
  environment?: EnvironmentReader;
  client?: BrowserlessPageClient;
  store?: ListingServerStore;
  now?: () => Date;
}

interface DiscoveredPage {
  page: number;
  status: 'ok' | 'empty' | 'blocked' | 'failed';
  urls: string[];
  attempts: number;
  strategy: string | null;
  errorCode: string | null;
  statusCode: number | null;
  durationMs: number;
  attemptSummaries: BrowserlessAttemptSummary[];
}

class RuntimeBudgetError extends Error {
  constructor() {
    super('discovery_runtime_budget_exceeded');
    this.name = 'RuntimeBudgetError';
  }
}

function runtimeEnvironment(): EnvironmentReader {
  return { get: (name: string) => typeof Deno !== 'undefined' ? Deno.env.get(name) : undefined };
}

function setting(environment: EnvironmentReader, name: string, fallback: number, min: number, max: number): number {
  const value = Math.trunc(Number(environment.get(name)));
  return Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
}

export function secureSecretMatches(provided: string, expected: string): boolean {
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

function discoverySlot(value: Date): string {
  const hour = Math.floor(value.getUTCHours() / DISCOVERY_LIMITS.runSlotHours) * DISCOVERY_LIMITS.runSlotHours;
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate(), hour)).toISOString();
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

function abortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new RuntimeBudgetError());
  return new Promise((resolve, reject) => {
    const abort = () => reject(new RuntimeBudgetError());
    signal.addEventListener('abort', abort, { once: true });
    operation.then(
      (value) => { signal.removeEventListener('abort', abort); resolve(value); },
      (error) => { signal.removeEventListener('abort', abort); reject(error); },
    );
  });
}

async function discoverPage(
  source: ListingSource,
  pageNumber: number,
  searchBaseUrl: string | undefined,
  client: BrowserlessPageClient,
  policy: HourlyBrowserlessPolicy,
  signal: AbortSignal,
): Promise<DiscoveredPage> {
  const provider = providerBySource(source);
  const searchUrl = provider.buildSearchUrl(pageNumber, {
    areaMin: LISTING_SELECTION.areaMin,
    areaMax: LISTING_SELECTION.areaMax,
    floor: LISTING_SELECTION.floor,
    searchBaseUrl,
  });
  const page: BrowserlessPage = await client.fetchPage(searchUrl, {
    includeLinks: true,
    allowUnblock: false,
    directUnblock: policy.directUnblock,
    strategies: [policy.strategy],
    retryCount: 0,
    ...resolveBrowserlessTimeoutProfile(source, 'discovery', policy.strategy),
    signal,
  });
  if (signal.aborted) throw new RuntimeBudgetError();
  const attempts = Math.min(1, page.attempted.length || 1);
  const safe = {
    statusCode: page.statusCode,
    durationMs: page.durationMs,
    attemptSummaries: page.attemptSummaries || [],
  };
  if (page.status === 'blocked') {
    return { page: pageNumber, status: 'blocked', urls: [], attempts, strategy: page.strategy, errorCode: safeCode(page.blockReason || 'blocked'), ...safe };
  }
  if (page.status === 'error') {
    return { page: pageNumber, status: 'failed', urls: [], attempts, strategy: page.strategy, errorCode: safeCode(page.errorCode), ...safe };
  }
  const urls = provider.deduplicate(provider.discoverListingUrls(page));
  if (urls.length) return { page: pageNumber, status: 'ok', urls, attempts, strategy: page.strategy, errorCode: null, ...safe };
  const diagnostic = pageDiscoveryDiagnostics(page);
  return {
    page: pageNumber,
    status: diagnostic.noResultsDetected ? 'empty' : 'failed',
    urls: [],
    attempts,
    strategy: page.strategy,
    errorCode: diagnostic.noResultsDetected ? null : 'discovery_zero_unexpected',
    ...safe,
  };
}

function queueInputs(source: ListingSource, urls: string[]): Array<{ listingUrl: string; externalId: string | null }> {
  const provider = providerBySource(source);
  return urls.flatMap((url) => {
    const canonical = provider.validateAndCanonicalizeUrl(url);
    return canonical.ok && canonical.canonicalUrl
      ? [{ listingUrl: canonical.canonicalUrl, externalId: canonical.externalId }]
      : [];
  });
}

function countQueue(results: QueueEnqueueResult[]): { queuedNew: number; observedExisting: number } {
  const queuedNew = results.filter((entry) => entry.queuedNew).length;
  return { queuedNew, observedExisting: results.length - queuedNew };
}

function safePageDiagnostic(page: DiscoveredPage): Record<string, unknown> {
  return {
    page: page.page,
    status: page.status,
    strategy: page.strategy,
    errorCode: page.errorCode,
    statusCode: page.statusCode,
    durationMs: Math.max(0, Math.trunc(page.durationMs)),
    attempts: page.attemptSummaries,
  };
}

export function createRefreshListingsHandler(dependencies: RefreshDependencies = {}): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    const environment = dependencies.environment || runtimeEnvironment();
    if (!secureSecretMatches(request.headers.get(CRON_HEADER) || '', String(environment.get('SLOGI_LISTING_CRON_SECRET') || ''))) {
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
    const runtimeMs = setting(environment, 'SLOGI_LISTING_DISCOVERY_RUNTIME_MS', DISCOVERY_LIMITS.defaultRuntimeMs, DISCOVERY_LIMITS.minRuntimeMs, DISCOVERY_LIMITS.hardRuntimeMs);
    const staleMs = setting(environment, 'SLOGI_LISTING_REFRESH_STALE_RUN_MS', DISCOVERY_LIMITS.defaultStaleRunMs, DISCOVERY_LIMITS.minStaleRunMs, DISCOVERY_LIMITS.maxStaleRunMs);
    const runSlot = discoverySlot(now);
    const staleBefore = new Date(now.getTime() - staleMs).toISOString();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new RuntimeBudgetError()), runtimeMs);
    let runId: number | null = null;
    let browserlessAttempts = 0;
    try {
      const claim = await abortable(store.claimRun(source, 'discovery', runSlot, startedAt, staleBefore, controller.signal), controller.signal);
      if (!claim.claimed || claim.runId == null) {
        return response({ status: 'completed', runSlot, source, outcome: { status: 'duplicate', browserlessAttempts: 0 } });
      }
      runId = claim.runId;
      const state = await abortable(store.getState(source, controller.signal), controller.signal);
      state.nextPage = Math.max(2, state.nextPage);
      state.lastDiscoveryStartedAt = startedAt;
      if (state.cooldownUntil && new Date(state.cooldownUntil).getTime() > now.getTime()) {
        await store.saveState(state, startedAt, controller.signal);
        await store.finishRun(runId, {
          status: 'cooldown', finishedAt: startedAt, metrics: {}, strategy: null,
          errorCode: state.lastDiscoveryErrorCode || 'cooldown',
          diagnostic: { browserlessAttempts: 0, cooldownActive: true, staleRunRecovered: claim.recovered },
        }, controller.signal);
        return response({ status: 'completed', runSlot, source, outcome: { status: 'cooldown', browserlessAttempts: 0 } });
      }

      const client = dependencies.client || lazyClient(environment);
      const backfillPage = state.nextPage;
      const searchBaseUrl = environment.get('CIAN_COMMERCIAL_RENT_SEARCH_URL');
      const hotPage = await abortable(
        discoverPage(source, 1, searchBaseUrl, client, policy, controller.signal),
        controller.signal,
      );
      const backfillPageResult = await abortable(
        discoverPage(source, backfillPage, searchBaseUrl, client, policy, controller.signal),
        controller.signal,
      );
      browserlessAttempts = hotPage.attempts + backfillPageResult.attempts;
      if (browserlessAttempts > DISCOVERY_LIMITS.browserlessCalls) throw new Error('discovery_browserless_budget_exhausted');

      const hotInputs = queueInputs(source, hotPage.urls);
      const hotUrls = new Set(hotInputs.map((entry) => entry.listingUrl));
      const backfillInputs = queueInputs(source, backfillPageResult.urls).filter((entry) => !hotUrls.has(entry.listingUrl));
      const [hotQueue, backfillQueue] = await abortable(Promise.all([
        store.enqueue(source, 'hot', hotInputs, startedAt, controller.signal),
        store.enqueue(source, 'backfill', backfillInputs, startedAt, controller.signal),
      ]), controller.signal);
      const counts = countQueue([...hotQueue, ...backfillQueue]);
      const pages = [hotPage, backfillPageResult];
      const failedPages = pages.filter((page) => page.status === 'failed').length;
      const blockedPages = pages.filter((page) => page.status === 'blocked').length;
      const success = failedPages === 0 && blockedPages === 0;
      const oldOnlyBackfill = backfillQueue.length > 0 && backfillQueue.every((entry) => entry.queueStatus === 'discarded_old');
      let cursorResetReason: string | null = null;
      if (backfillPageResult.status === 'empty') cursorResetReason = 'deep_page_empty';
      else if (oldOnlyBackfill) cursorResetReason = 'deep_page_old_only';
      if (success) {
        state.discoveryFailures = 0;
        state.lastDiscoverySucceededAt = startedAt;
        state.lastDiscoveryErrorCode = null;
        state.nextPage = cursorResetReason ? 2 : backfillPage + 1;
      } else {
        state.discoveryFailures += 1;
        state.lastDiscoveryErrorCode = pages.find((page) => page.errorCode)?.errorCode || (blockedPages ? 'blocked' : 'provider_error');
      }
      await abortable(store.saveState(state, startedAt, controller.signal), controller.signal);
      const status: RunFinish['status'] = success ? (hotInputs.length + backfillInputs.length ? 'ok' : 'empty') : (hotInputs.length + backfillInputs.length ? 'partial' : blockedPages ? 'blocked' : 'failed');
      const errorCode = success ? null : state.lastDiscoveryErrorCode;
      await abortable(store.finishRun(runId, {
        status,
        finishedAt: new Date().toISOString(),
        metrics: {
          discovered: hotInputs.length + backfillInputs.length,
          queued_new: counts.queuedNew,
          // The historical column name is retained for schema compatibility;
          // its value is the number of known URLs observed, not a queue delta.
          queued_existing: counts.observedExisting,
          hot: hotInputs.length,
          backfill: backfillInputs.length,
          attempted: browserlessAttempts,
          blocked: blockedPages,
          failed: failedPages,
        },
        strategy: policy.strategy,
        errorCode,
        diagnostic: {
          cursorBefore: backfillPage,
          cursorAfter: state.nextPage,
          cursorResetReason,
          durationMs: Math.max(0, Date.now() - now.getTime()),
          browserlessAttempts,
          observedExisting: counts.observedExisting,
          staleRunRecovered: claim.recovered,
          pages: pages.map(safePageDiagnostic),
        },
      }, controller.signal), controller.signal);
      return response({
        status: 'completed', runSlot, source,
        outcome: {
          status, discovered: hotInputs.length + backfillInputs.length,
          queuedNew: counts.queuedNew, observedExisting: counts.observedExisting,
          hot: hotInputs.length, backfill: backfillInputs.length,
          cursorBefore: backfillPage, cursorAfter: state.nextPage,
          cursorResetReason, browserlessAttempts, errorCode, strategy: policy.strategy,
          pages: pages.map(safePageDiagnostic),
        },
      });
    } catch (error) {
      const timedOut = error instanceof RuntimeBudgetError || controller.signal.aborted;
      const errorCode = timedOut ? 'runtime_budget_exceeded' : safeCode(error instanceof Error ? error.message : error);
      if (runId != null) {
        try {
          await store.finishRun(runId, {
            status: timedOut ? 'timed_out' : 'failed', finishedAt: new Date().toISOString(),
            metrics: { attempted: browserlessAttempts, failed: 1 }, strategy: null, errorCode,
            diagnostic: { browserlessAttempts, runtimeMs, timedOut },
          });
        } catch { /* Best-effort terminal bookkeeping. */ }
      }
      return response({ status: timedOut ? 'timed_out' : 'completed', runSlot, source, outcome: { status: timedOut ? 'timed_out' : 'failed', errorCode, browserlessAttempts } });
    } finally {
      clearTimeout(timer);
    }
  };
}

if (typeof Deno !== 'undefined' && import.meta.main) {
  Deno.serve(createRefreshListingsHandler());
}
