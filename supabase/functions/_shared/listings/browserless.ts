import { pageBlockReason, uniqueWarnings } from './parsing.ts';
import type {
  BrowserlessAttemptSummary,
  BrowserlessFailureFingerprint,
  BrowserlessPage,
  BrowserlessStrategy,
  ListingSource,
} from './types.ts';

const DEFAULT_BROWSERLESS_URL = 'https://production-sfo.browserless.io';
const ALLOWED_TARGET = /^(?:[a-z0-9-]+\.)*cian\.ru$/i;
const STRATEGIES: BrowserlessStrategy[] = ['smart-scrape', 'content', 'unblock'];

export const BROWSERLESS_LIMITS = Object.freeze({
  apiTimeoutMs: 14_000,
  requestTimeoutMs: 18_000,
  overallTimeoutMs: 55_000,
  navigationTimeoutMs: 14_000,
  hardApiTimeoutMs: 60_000,
  hardClientTimeoutMs: 75_000,
  retryCount: 1,
  retryDelayMs: 200,
  maxResponseBytes: 5_000_000,
  maxLinks: 2_000,
});

export interface EnvironmentReader {
  get(name: string): string | undefined;
}

export interface BrowserlessFetchOptions {
  includeLinks?: boolean;
  allowUnblock?: boolean;
  directUnblock?: boolean;
  strategies?: BrowserlessStrategy[];
  retryCount?: number;
  apiTimeoutMs?: number;
  requestTimeoutMs?: number;
  overallTimeoutMs?: number;
  signal?: AbortSignal;
}

export interface BrowserlessTimeoutProfile {
  apiTimeoutMs: number;
  requestTimeoutMs: number;
  overallTimeoutMs: number;
}

export type BrowserlessOperationKind = 'discovery' | 'card';

export interface BrowserlessPageClient {
  fetchPage(url: string, options?: BrowserlessFetchOptions): Promise<BrowserlessPage>;
}

class BrowserlessRequestError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly statusCode: number | null;
  readonly failureFingerprint: BrowserlessFailureFingerprint | null;

  constructor(
    code: string,
    retryable = false,
    statusCode: number | null = null,
    failureFingerprint: BrowserlessFailureFingerprint | null = null,
  ) {
    super(code);
    this.name = 'BrowserlessRequestError';
    this.code = code;
    this.retryable = retryable;
    this.statusCode = statusCode;
    this.failureFingerprint = failureFingerprint;
  }
}

interface BrowserlessAttemptFailure {
  summary: BrowserlessAttemptSummary;
  failureFingerprint: BrowserlessFailureFingerprint | null;
}

interface BrowserlessRequestResult {
  page: BrowserlessPage;
  browserlessStatusCode: number;
}

export interface HourlyBrowserlessPolicy {
  strategy: 'smart-scrape' | 'unblock';
  directUnblock: boolean;
}

const CIAN_TIMEOUT_PROFILE = Object.freeze<BrowserlessTimeoutProfile>({
  apiTimeoutMs: BROWSERLESS_LIMITS.apiTimeoutMs,
  requestTimeoutMs: BROWSERLESS_LIMITS.requestTimeoutMs,
  overallTimeoutMs: BROWSERLESS_LIMITS.overallTimeoutMs,
});

export function resolveBrowserlessTimeoutProfile(
  source: ListingSource,
  operation: BrowserlessOperationKind,
  strategy: HourlyBrowserlessPolicy['strategy'],
): BrowserlessTimeoutProfile {
  if (source !== 'cian' || strategy !== 'smart-scrape' || !['discovery', 'card'].includes(operation)) {
    throw new BrowserlessRequestError('browserless_timeout_profile_invalid');
  }
  return { ...CIAN_TIMEOUT_PROFILE };
}

export function resolveHourlyBrowserlessPolicy(source: ListingSource, environment: EnvironmentReader): HourlyBrowserlessPolicy {
  void environment;
  if (source !== 'cian') throw new Error('browserless_source_disabled');
  return { strategy: 'smart-scrape', directUnblock: false };
}

export function classifyBrowserlessHttpFailure(status: number, body: string): string {
  const normalized = String(body || '').toLowerCase().replace(/\s+/g, ' ').slice(0, 20_000);
  if (status === 401 && /(?:out of credits|unit limit reached|credits? exhausted|insufficient units?)/.test(normalized)) {
    return 'browserless_credits_exhausted';
  }
  if (status === 401) return 'browserless_http_401';
  if (status === 402) return 'browserless_http_402';
  if (status === 403) return 'browserless_http_403';
  if (status === 408) return 'browserless_http_408';
  if (status === 429) return 'browserless_http_429';
  if (status >= 500 && status <= 599) return 'browserless_http_5xx';

  if (status === 400) {
    const mentionsProxy = /\bproxy|residential/.test(normalized);
    if (mentionsProxy && /\b(plan|subscription|billing|upgrade|paid tier|not included|not available on)/.test(normalized)) {
      return 'browserless_proxy_plan_unavailable';
    }
    if (mentionsProxy && /\b(unavailable|not available|no proxies|capacity|exhausted)/.test(normalized)) {
      return 'browserless_proxy_unavailable';
    }
    if (/\b(unsupported|not supported|unknown|unrecognized)\b/.test(normalized)
      && /\b(parameter|property|field|option|argument|proxycountry|proxylocalematch|stealth)\b/.test(normalized)) {
      return 'browserless_unsupported_parameter';
    }
    if (/\b(invalid|malformed|required|expected|must be|must provide)\b/.test(normalized)
      && /\b(parameter|property|field|option|argument|request|payload|url)\b/.test(normalized)) {
      return 'browserless_invalid_parameter';
    }
  }
  return 'browserless_http_400_unclassified';
}

function runtimeEnvironment(): EnvironmentReader {
  return {
    get(name: string): string | undefined {
      if (typeof Deno !== 'undefined') return Deno.env.get(name);
      return undefined;
    },
  };
}

function safeBaseUrl(raw: string | undefined): URL {
  const candidate = String(raw || DEFAULT_BROWSERLESS_URL).trim();
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new BrowserlessRequestError('browserless_url_invalid');
  }
  const local = ['localhost', '127.0.0.1', '::1'].includes(url.hostname.toLowerCase());
  if ((url.protocol !== 'https:' && !(local && url.protocol === 'http:')) || url.username || url.password) {
    throw new BrowserlessRequestError('browserless_url_unsafe');
  }
  if (ALLOWED_TARGET.test(url.hostname)) throw new BrowserlessRequestError('browserless_url_unsafe');
  url.search = '';
  url.hash = '';
  if (!url.pathname.endsWith('/')) url.pathname += '/';
  return url;
}

function validateTarget(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port || !ALLOWED_TARGET.test(url.hostname)) {
      throw new Error('invalid');
    }
    return url.toString();
  } catch {
    throw new BrowserlessRequestError('target_url_rejected');
  }
}

function timeoutValue(value: unknown, fallback: number, hardMaximum: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value) || value <= 0) {
    throw new BrowserlessRequestError('browserless_timeout_options_invalid');
  }
  return Math.min(value, hardMaximum);
}

export function resolveBrowserlessTimeoutSettings(options: BrowserlessFetchOptions = {}): BrowserlessTimeoutProfile {
  const profile = {
    apiTimeoutMs: timeoutValue(options.apiTimeoutMs, BROWSERLESS_LIMITS.apiTimeoutMs, BROWSERLESS_LIMITS.hardApiTimeoutMs),
    requestTimeoutMs: timeoutValue(options.requestTimeoutMs, BROWSERLESS_LIMITS.requestTimeoutMs, BROWSERLESS_LIMITS.hardClientTimeoutMs),
    overallTimeoutMs: timeoutValue(options.overallTimeoutMs, BROWSERLESS_LIMITS.overallTimeoutMs, BROWSERLESS_LIMITS.hardClientTimeoutMs),
  };
  if (!(profile.apiTimeoutMs < profile.requestTimeoutMs && profile.requestTimeoutMs < profile.overallTimeoutMs)) {
    throw new BrowserlessRequestError('browserless_timeout_options_invalid');
  }
  return profile;
}

function strategyEndpoint(base: URL, strategy: BrowserlessStrategy, token: string, apiTimeoutMs: number): URL {
  const endpoint = new URL(strategy, base);
  endpoint.searchParams.set('token', token);
  endpoint.searchParams.set('timeout', String(apiTimeoutMs));
  if (strategy === 'unblock') endpoint.searchParams.set('proxy', 'residential');
  return endpoint;
}

async function readLimitedText(response: Response): Promise<string> {
  const declared = Number(response.headers.get('content-length') || 0);
  if (declared > BROWSERLESS_LIMITS.maxResponseBytes) throw new BrowserlessRequestError('response_too_large');
  if (!response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let text = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > BROWSERLESS_LIMITS.maxResponseBytes) {
        await reader.cancel();
        throw new BrowserlessRequestError('response_too_large');
      }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

async function failureFingerprint(statusCode: number, body: string): Promise<BrowserlessFailureFingerprint> {
  const bytes = new TextEncoder().encode(body);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const bodySha256 = [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
  return { statusCode, bodyByteLength: bytes.byteLength, bodySha256 };
}

function requestBody(strategy: BrowserlessStrategy, targetUrl: string, includeLinks: boolean, apiTimeoutMs: number): Record<string, unknown> {
  if (strategy === 'smart-scrape') {
    return { url: targetUrl, formats: includeLinks ? ['html', 'markdown', 'links'] : ['html', 'markdown'] };
  }
  if (strategy === 'content') {
    return {
      url: targetUrl,
      bestAttempt: true,
      gotoOptions: { waitUntil: 'domcontentloaded', timeout: apiTimeoutMs },
      rejectResourceTypes: ['image', 'media', 'font'],
    };
  }
  return {
    url: targetUrl,
    content: true,
    cookies: false,
    screenshot: false,
    browserWSEndpoint: false,
  };
}

function linkedController(parent: AbortSignal | undefined, timeoutMs: number): {
  controller: AbortController;
  timedOut: () => boolean;
  dispose: () => void;
} {
  const controller = new AbortController();
  let timedOut = false;
  const abort = () => controller.abort(parent?.reason);
  if (parent?.aborted) abort();
  else parent?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => {
    if (parent?.aborted) abort();
    else {
      timedOut = true;
      controller.abort(new Error('timeout'));
    }
  }, timeoutMs);
  return {
    controller,
    timedOut: () => timedOut,
    dispose: () => {
      clearTimeout(timer);
      parent?.removeEventListener('abort', abort);
    },
  };
}

function errorPage(
  attempted: BrowserlessStrategy[],
  durationMs: number,
  code: string,
  warnings: string[] = [],
  statusCode: number | null = null,
  attemptSummaries: BrowserlessAttemptSummary[] = [],
  fingerprint: BrowserlessFailureFingerprint | null = null,
): BrowserlessPage {
  return {
    status: 'error',
    html: '',
    markdown: '',
    links: [],
    strategy: attempted.at(-1) || null,
    attempted,
    statusCode,
    durationMs,
    blockReason: null,
    warnings: uniqueWarnings(warnings),
    errorCode: code,
    attemptSummaries,
    failureFingerprint: fingerprint,
  };
}

function retryableStatus(status: number): boolean {
  return [408, 425, 429, 500, 502, 503, 504].includes(status);
}

function errorPriority(code: string): number {
  if (/browserless_credits_exhausted|browserless_http_(?:401|402|403)$|browserless_proxy_plan_unavailable/.test(code)) return 0;
  if (/browserless_(?:invalid_parameter|unsupported_parameter|http_400_unclassified)$/.test(code)) return 1;
  if (code === 'browserless_http_429') return 2;
  if (/browserless_http_408|timeout/.test(code)) return 3;
  if (/network|proxy_unavailable/.test(code)) return 4;
  return 5;
}

function primaryFailure(failures: BrowserlessAttemptFailure[]): BrowserlessAttemptFailure | null {
  return [...failures].sort((left, right) => {
    const priority = errorPriority(left.summary.errorCode || '') - errorPriority(right.summary.errorCode || '');
    return priority || left.summary.ordinalAttempt - right.summary.ordinalAttempt;
  })[0] || null;
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new BrowserlessRequestError('request_aborted'));
    const timer = setTimeout(resolve, ms);
    const abort = () => {
      clearTimeout(timer);
      reject(new BrowserlessRequestError('request_aborted'));
    };
    signal?.addEventListener('abort', abort, { once: true });
  });
}

export class BrowserlessClient implements BrowserlessPageClient {
  #baseUrl: URL;
  #token: string;
  #fetch: typeof fetch;

  private constructor(baseUrl: URL, token: string, fetchImpl: typeof fetch) {
    this.#baseUrl = baseUrl;
    this.#token = token;
    this.#fetch = fetchImpl;
  }

  static fromEnvironment(environment: EnvironmentReader = runtimeEnvironment(), fetchImpl: typeof fetch = fetch): BrowserlessClient {
    const token = String(environment.get('BROWSERLESS_TOKEN') || '').trim();
    if (!token) throw new BrowserlessRequestError('browserless_not_configured');
    return new BrowserlessClient(safeBaseUrl(environment.get('BROWSERLESS_URL')), token, fetchImpl);
  }

  async #request(
    strategy: BrowserlessStrategy,
    targetUrl: string,
    includeLinks: boolean,
    timeouts: BrowserlessTimeoutProfile,
    signal?: AbortSignal,
  ): Promise<BrowserlessRequestResult> {
    const endpoint = strategyEndpoint(this.#baseUrl, strategy, this.#token, timeouts.apiTimeoutMs);
    const linked = linkedController(signal, timeouts.requestTimeoutMs);
    const started = Date.now();
    try {
      let response: Response;
      try {
        response = await this.#fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' },
          body: JSON.stringify(requestBody(strategy, targetUrl, includeLinks, timeouts.apiTimeoutMs)),
          signal: linked.controller.signal,
        });
      } catch {
        if (signal?.aborted) throw new BrowserlessRequestError('request_aborted');
        if (linked.timedOut()) throw new BrowserlessRequestError('browserless_timeout', true);
        throw new BrowserlessRequestError('browserless_network_error', true);
      }
      const raw = await readLimitedText(response);
      if (!response.ok) {
        const code = classifyBrowserlessHttpFailure(response.status, raw);
        const fingerprint = code === 'browserless_http_400_unclassified'
          ? await failureFingerprint(response.status, raw)
          : null;
        throw new BrowserlessRequestError(code, retryableStatus(response.status), response.status, fingerprint);
      }

      let html = '';
      let markdown = '';
      let links: string[] = [];
      let statusCode: number | null = response.status;
      if (strategy === 'content') {
        html = raw;
      } else {
        let payload: Record<string, unknown>;
        try {
          payload = JSON.parse(raw) as Record<string, unknown>;
        } catch {
          throw new BrowserlessRequestError('browserless_invalid_json', false, response.status);
        }
        if (strategy === 'smart-scrape') {
          if (payload.ok === false) throw new BrowserlessRequestError('smart_scrape_failed', false, response.status);
          html = typeof payload.content === 'string' ? payload.content : payload.content ? JSON.stringify(payload.content) : '';
          markdown = typeof payload.markdown === 'string' ? payload.markdown : '';
          links = Array.isArray(payload.links) ? payload.links.map(String).slice(0, BROWSERLESS_LIMITS.maxLinks) : [];
          statusCode = typeof payload.statusCode === 'number' ? payload.statusCode : response.status;
        } else {
          html = typeof payload.content === 'string' ? payload.content : '';
        }
      }
      const reason = pageBlockReason(html, markdown);
      return {
        browserlessStatusCode: response.status,
        page: {
          status: reason ? 'blocked' : 'ok',
          html,
          markdown,
          links,
          strategy,
          attempted: [strategy],
          statusCode,
          durationMs: Date.now() - started,
          blockReason: reason,
          warnings: html || markdown ? [] : ['empty_content'],
        },
      };
    } finally {
      linked.dispose();
    }
  }

  async #requestWithRetry(
    strategy: BrowserlessStrategy,
    targetUrl: string,
    includeLinks: boolean,
    timeouts: BrowserlessTimeoutProfile,
    retryCount: number,
    summaries: BrowserlessAttemptSummary[],
    failures: BrowserlessAttemptFailure[],
    signal?: AbortSignal,
  ): Promise<BrowserlessPage> {
    let lastError = new BrowserlessRequestError('browserless_request_failed');
    for (let attempt = 0; attempt <= retryCount; attempt += 1) {
      const attemptStarted = Date.now();
      const ordinalAttempt = summaries.length + 1;
      try {
        const result = await this.#request(strategy, targetUrl, includeLinks, timeouts, signal);
        summaries.push({
          strategy,
          ordinalAttempt,
          errorCode: result.page.blockReason,
          statusCode: result.browserlessStatusCode,
          durationMs: Math.max(0, Date.now() - attemptStarted),
          retryable: false,
        });
        result.page.attemptSummaries = [...summaries];
        return result.page;
      } catch (error) {
        lastError = error instanceof BrowserlessRequestError ? error : new BrowserlessRequestError('browserless_request_failed');
        const summary: BrowserlessAttemptSummary = {
          strategy,
          ordinalAttempt,
          errorCode: lastError.code,
          statusCode: lastError.statusCode,
          durationMs: Math.max(0, Date.now() - attemptStarted),
          retryable: lastError.retryable,
        };
        summaries.push(summary);
        failures.push({ summary, failureFingerprint: lastError.failureFingerprint });
        if (!lastError.retryable || attempt >= retryCount) break;
        await delay(BROWSERLESS_LIMITS.retryDelayMs * (attempt + 1), signal);
      }
    }
    throw lastError;
  }

  async fetchPage(rawUrl: string, options: BrowserlessFetchOptions = {}): Promise<BrowserlessPage> {
    const started = Date.now();
    let targetUrl: string;
    let timeouts: BrowserlessTimeoutProfile;
    try {
      targetUrl = validateTarget(rawUrl);
      timeouts = resolveBrowserlessTimeoutSettings(options);
    } catch (error) {
      return errorPage([], Date.now() - started, error instanceof BrowserlessRequestError ? error.code : 'target_url_rejected');
    }
    const attempted: BrowserlessStrategy[] = [];
    const attemptSummaries: BrowserlessAttemptSummary[] = [];
    const failures: BrowserlessAttemptFailure[] = [];
    const warnings: string[] = [];
    let bestBlocked: BrowserlessPage | null = null;
    let bestThin: BrowserlessPage | null = null;
    let unblockEligible = false;
    const requestedStrategies = options.strategies?.length ? [...options.strategies] : [...STRATEGIES];
    if (requestedStrategies.some((strategy) => !STRATEGIES.includes(strategy))) {
      return errorPage([], Date.now() - started, 'browserless_strategy_rejected');
    }
    const strategies = requestedStrategies as BrowserlessStrategy[];
    const directUnblockOnly = strategies.length === 1 && strategies[0] === 'unblock';
    if (directUnblockOnly && options.directUnblock !== true) {
      return errorPage([], Date.now() - started, 'browserless_direct_unblock_forbidden');
    }
    if (options.directUnblock === true && !directUnblockOnly) {
      return errorPage([], Date.now() - started, 'browserless_direct_unblock_invalid');
    }
    const overall = linkedController(options.signal, timeouts.overallTimeoutMs);
    const retryCount = Math.max(0, Math.min(BROWSERLESS_LIMITS.retryCount, Math.trunc(options.retryCount ?? BROWSERLESS_LIMITS.retryCount)));
    try {
      for (const strategy of strategies) {
        if (strategy === 'unblock' && options.directUnblock !== true && (options.allowUnblock === false || !unblockEligible)) continue;
        attempted.push(strategy);
        try {
          const page = await this.#requestWithRetry(
            strategy,
            targetUrl,
            Boolean(options.includeLinks),
            timeouts,
            retryCount,
            attemptSummaries,
            failures,
            overall.controller.signal,
          );
          const contentLength = page.html.length + page.markdown.length;
          page.attempted = [...attempted];
          page.durationMs = Date.now() - started;
          page.attemptSummaries = [...attemptSummaries];
          if (page.status === 'blocked') {
            unblockEligible = true;
            warnings.push(`${strategy}_blocked`);
            bestBlocked = page;
            continue;
          }
          if (contentLength < 80) {
            unblockEligible = true;
            warnings.push(`${strategy}_thin`);
            bestThin = page;
            continue;
          }
          page.warnings = uniqueWarnings([...warnings, ...page.warnings]);
          return page;
        } catch (error) {
          if (options.signal?.aborted || overall.controller.signal.aborted) {
            const parentAborted = Boolean(options.signal?.aborted);
            const overallTimedOut = overall.timedOut() && !parentAborted;
            const primary = primaryFailure(failures);
            return errorPage(
              attempted,
              Date.now() - started,
              parentAborted ? 'request_aborted' : overallTimedOut ? 'browserless_overall_timeout' : primary?.summary.errorCode || 'request_aborted',
              warnings,
              parentAborted || overallTimedOut ? null : primary?.summary.statusCode ?? null,
              attemptSummaries,
              parentAborted || overallTimedOut ? null : primary?.failureFingerprint || null,
            );
          }
        }
      }
      if (bestBlocked) {
        bestBlocked.attempted = attempted;
        bestBlocked.durationMs = Date.now() - started;
        bestBlocked.warnings = uniqueWarnings([...warnings, ...bestBlocked.warnings]);
        bestBlocked.attemptSummaries = [...attemptSummaries];
        return bestBlocked;
      }
      if (bestThin) {
        bestThin.attempted = attempted;
        bestThin.durationMs = Date.now() - started;
        bestThin.warnings = uniqueWarnings([...warnings, ...bestThin.warnings]);
        bestThin.attemptSummaries = [...attemptSummaries];
        return bestThin;
      }
      const primary = primaryFailure(failures);
      return errorPage(
        attempted,
        Date.now() - started,
        primary?.summary.errorCode || 'browserless_all_strategies_failed',
        warnings,
        primary?.summary.statusCode ?? null,
        attemptSummaries,
        primary?.failureFingerprint || null,
      );
    } finally {
      overall.dispose();
    }
  }
}

export function safeBrowserlessError(error: unknown): string {
  return error instanceof BrowserlessRequestError ? error.code : 'browserless_initialization_failed';
}
