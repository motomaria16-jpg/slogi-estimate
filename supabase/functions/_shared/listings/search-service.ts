import type { BrowserlessPageClient } from './browserless.ts';
import { isCompleteListing, pageDiscoveryDiagnostics, uniqueWarnings } from './parsing.ts';
import { providerBySource } from './providers/index.ts';
import { isListingSelected } from './selection.ts';
import type {
  ListingProvider,
  ListingSource,
  NormalizedListing,
  SourceSearchMeta,
} from './types.ts';

export const SEARCH_LIMITS = Object.freeze({
  maxPages: 3,
  maxCardsPerSource: 40,
  cardConcurrency: 2,
});

export interface ListingSearchRequest {
  sources: ListingSource[];
  page: number;
  pages: number;
  pageNumbers?: number[];
  additionalPageCardBudget?: number;
  limit: number;
  areaMin: number | null;
  areaMax: number | null;
  floor: number | null;
  searchBaseUrls?: Partial<Record<ListingSource, string>>;
}

export interface ListingSearchResult {
  items: NormalizedListing[];
  sources: Record<ListingSource, SourceSearchMeta> | Partial<Record<ListingSource, SourceSearchMeta>>;
  itemPages?: Partial<Record<ListingSource, Record<string, number>>>;
  discoveryPages?: Partial<Record<ListingSource, ListingDiscoveryPage[]>>;
}

export interface ListingDiscoveryPage {
  page: number;
  status: 'ok' | 'empty' | 'blocked' | 'failed';
  discovered: number;
}

export interface ListingSearchDependencies {
  client: BrowserlessPageClient;
  providers?: Partial<Record<ListingSource, ListingProvider>>;
  now?: () => Date;
  signal?: AbortSignal;
  allowUnblock?: boolean;
}

function passesFilters(listing: NormalizedListing, request: ListingSearchRequest): boolean {
  if (!isListingSelected(listing)) return false;
  if (request.areaMin != null && (listing.area == null || listing.area < request.areaMin)) return false;
  if (request.areaMax != null && (listing.area == null || listing.area > request.areaMax)) return false;
  if (request.floor != null && (listing.floor == null || listing.floor !== request.floor)) return false;
  return true;
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

function sourceStatus(meta: Pick<SourceSearchMeta, 'discovered' | 'parsed' | 'partial' | 'blocked' | 'failed'>): SourceSearchMeta['status'] {
  if (meta.parsed > 0 || meta.partial > 0) return meta.partial > 0 || meta.blocked > 0 || meta.failed > 0 ? 'partial' : 'ok';
  if (meta.blocked > 0) return 'blocked';
  if (meta.failed > 0) return 'failed';
  return 'empty';
}

async function searchSource(
  source: ListingSource,
  request: ListingSearchRequest,
  dependencies: ListingSearchDependencies,
): Promise<{
  items: NormalizedListing[];
  meta: SourceSearchMeta;
  itemPages: Record<string, number>;
  discoveryPages: ListingDiscoveryPage[];
}> {
  const started = Date.now();
  const provider = dependencies.providers?.[source] || providerBySource(source);
  const strategies = new Set<string>();
  const warnings: string[] = [];
  const discoveredByPage = new Map<number, string[]>();
  const discoveryPages: ListingDiscoveryPage[] = [];
  let blocked = 0;
  let failed = 0;
  let parsed = 0;
  let partial = 0;
  let searchRequests = 0;
  const discoveryDiagnostic = {
    contentLength: 0,
    markdownLength: 0,
    rawLinks: 0,
    anchorCount: 0,
    structuredDataDetected: false,
    noResultsDetected: false,
  };

  const requestedPages = request.pageNumbers?.length
    ? request.pageNumbers
    : Array.from({ length: request.pages }, (_, index) => request.page + index);
  const pageNumbers = [...new Set(requestedPages
    .map((value) => Math.max(1, Math.trunc(Number(value) || 1))))]
    .slice(0, SEARCH_LIMITS.maxPages);
  for (const pageNumber of pageNumbers) {
    const searchUrl = provider.buildSearchUrl(pageNumber, {
      areaMin: request.areaMin,
      areaMax: request.areaMax,
      floor: request.floor,
      searchBaseUrl: request.searchBaseUrls?.[source],
    });
    searchRequests += 1;
    const page = await dependencies.client.fetchPage(searchUrl, { includeLinks: true, allowUnblock: dependencies.allowUnblock !== false, signal: dependencies.signal });
    const pageDiagnostic = pageDiscoveryDiagnostics(page);
    discoveryDiagnostic.contentLength += pageDiagnostic.contentLength;
    discoveryDiagnostic.markdownLength += pageDiagnostic.markdownLength;
    discoveryDiagnostic.rawLinks += pageDiagnostic.rawLinks;
    discoveryDiagnostic.anchorCount += pageDiagnostic.anchorCount;
    discoveryDiagnostic.structuredDataDetected ||= pageDiagnostic.structuredDataDetected;
    discoveryDiagnostic.noResultsDetected ||= pageDiagnostic.noResultsDetected;
    for (const strategy of page.attempted) strategies.add(strategy);
    if (page.status === 'blocked') {
      blocked += 1;
      warnings.push(`search_page_${pageNumber}_blocked:${page.blockReason || 'blocked'}`);
      discoveryPages.push({ page: pageNumber, status: 'blocked', discovered: 0 });
      continue;
    }
    if (page.status === 'error') {
      failed += 1;
      warnings.push(`search_page_${pageNumber}_failed:${page.errorCode || 'provider_error'}`);
      discoveryPages.push({ page: pageNumber, status: 'failed', discovered: 0 });
      continue;
    }
    const pageListings = provider.deduplicate(provider.discoverListingUrls(page));
    if (!pageListings.length) {
      if (pageDiagnostic.noResultsDetected) {
        warnings.push(`search_page_${pageNumber}:explicit_no_results`);
        discoveryPages.push({ page: pageNumber, status: 'empty', discovered: 0 });
      } else {
        failed += 1;
        warnings.push('discovery_zero_unexpected', `search_page_${pageNumber}:discovery_zero_unexpected`);
        discoveryPages.push({ page: pageNumber, status: 'failed', discovered: 0 });
      }
      warnings.push(...page.warnings.map((warning) => `search_page_${pageNumber}:${warning}`));
      continue;
    }
    discoveredByPage.set(pageNumber, pageListings);
    discoveryPages.push({ page: pageNumber, status: 'ok', discovered: pageListings.length });
    warnings.push(...page.warnings.map((warning) => `search_page_${pageNumber}:${warning}`));
  }

  // The requested page order is authoritative. Refresh passes page 1 first, so
  // hot-discovery links win deduplication and the bounded card budget.
  const pageByUrl = new Map<string, number>();
  const canonicalUrls: string[] = [];
  for (const pageNumber of pageNumbers) {
    for (const url of discoveredByPage.get(pageNumber) || []) {
      if (pageByUrl.has(url)) continue;
      pageByUrl.set(url, pageNumber);
      canonicalUrls.push(url);
    }
  }
  const additionalBudget = Math.max(0, Math.min(
    request.limit,
    Math.trunc(Number(request.additionalPageCardBudget) || 0),
  ));
  let attemptedUrls = canonicalUrls.slice(0, request.limit);
  if (additionalBudget > 0 && pageNumbers.length > 1) {
    const primaryPage = pageNumbers[0];
    const primaryUrls = canonicalUrls.filter((url) => pageByUrl.get(url) === primaryPage);
    const additionalUrls = canonicalUrls.filter((url) => pageByUrl.get(url) !== primaryPage);
    const selectedPrimary = primaryUrls.slice(0, Math.max(0, request.limit - additionalBudget));
    const selectedAdditional = additionalUrls.slice(0, additionalBudget);
    const selected = new Set([...selectedPrimary, ...selectedAdditional]);
    for (const url of canonicalUrls) {
      if (selected.size >= request.limit) break;
      selected.add(url);
    }
    attemptedUrls = [...selected];
  }
  const cardsRequestedByPage: Record<string, number> = {};
  for (const url of attemptedUrls) {
    const pageNumber = pageByUrl.get(url);
    if (pageNumber != null) cardsRequestedByPage[String(pageNumber)] = (cardsRequestedByPage[String(pageNumber)] || 0) + 1;
  }
  const outcomes = await mapLimit(attemptedUrls, SEARCH_LIMITS.cardConcurrency, async (url) => {
    const page = await dependencies.client.fetchPage(url, { includeLinks: false, allowUnblock: dependencies.allowUnblock !== false, signal: dependencies.signal });
    for (const strategy of page.attempted) strategies.add(strategy);
    if (page.status === 'blocked') {
      blocked += 1;
      warnings.push(`card_blocked:${page.blockReason || 'blocked'}`);
      return null;
    }
    if (page.status === 'error') {
      failed += 1;
      warnings.push(`card_failed:${page.errorCode || 'provider_error'}`);
      return null;
    }
    try {
      const observedAt = (dependencies.now?.() || new Date()).toISOString();
      const listing = provider.parseListing(page, url, observedAt);
      if (isCompleteListing(listing)) parsed += 1;
      else partial += 1;
      warnings.push(...provider.diagnostics(listing, page).warnings.map((warning) => `card:${warning}`));
      return listing;
    } catch {
      failed += 1;
      warnings.push('card_failed:parse_error');
      return null;
    }
  });

  const parsedItems = outcomes.filter((item): item is NormalizedListing => Boolean(item));
  const accepted = parsedItems.filter((listing) => passesFilters(listing, request));
  const addresses = parsedItems.filter((listing) => Boolean(listing.address)).length;
  const areas = parsedItems.filter((listing) => listing.area != null).length;
  const floors = parsedItems.filter((listing) => listing.floor != null).length;
  const prices = parsedItems.filter((listing) => listing.rentMonthly != null).length;
  const unique = uniqueWarnings(warnings);
  const meta: SourceSearchMeta = {
    status: 'empty',
    discovered: canonicalUrls.length,
    attempted: attemptedUrls.length,
    parsed,
    partial,
    blocked,
    failed,
    strategy: [...strategies].join(', '),
    durationMs: Date.now() - started,
    warnings: unique,
    returned: accepted.length,
    strategies: [...strategies],
    errors: unique.filter((warning) => /blocked|failed|timeout|error|discovery_zero_unexpected/.test(warning)).slice(0, 20),
    removedConfirmed: 0,
    diagnostic: {
      linksFound: canonicalUrls.length,
      cardsRequested: attemptedUrls.length,
      networkRequested: searchRequests + attemptedUrls.length,
      cardsSucceeded: parsedItems.length,
      cacheHits: 0,
      addressesParsed: addresses,
      areasParsed: areas,
      floorsParsed: floors,
      pricesParsed: prices,
      blocked,
      captcha: unique.filter((warning) => warning.includes('captcha')).length,
      captchaSolved: 0,
      timeouts: unique.filter((warning) => warning.includes('timeout')).length,
      errors: failed,
      methodUsed: Object.fromEntries([...strategies].map((strategy) => [strategy, 1])),
      contentLength: discoveryDiagnostic.contentLength,
      markdownLength: discoveryDiagnostic.markdownLength,
      rawLinks: discoveryDiagnostic.rawLinks,
      anchorCount: discoveryDiagnostic.anchorCount,
      structuredDataDetected: discoveryDiagnostic.structuredDataDetected,
      noResultsDetected: discoveryDiagnostic.noResultsDetected,
      pages: discoveryPages,
      cardsRequestedByPage,
    },
    quality: {
      addressRate: parsedItems.length ? addresses / parsedItems.length : 0,
      areaRate: parsedItems.length ? areas / parsedItems.length : 0,
      floorRate: parsedItems.length ? floors / parsedItems.length : 0,
      priceRate: parsedItems.length ? prices / parsedItems.length : 0,
      warning: partial > 0 || blocked > 0 || failed > 0,
    },
  };
  meta.status = sourceStatus(meta);
  const itemPages = Object.fromEntries(accepted.map((listing) => [listing.listingUrl, pageByUrl.get(listing.listingUrl) || pageNumbers[0] || 1]));
  return { items: accepted, meta, itemPages, discoveryPages };
}

export async function searchListings(request: ListingSearchRequest, dependencies: ListingSearchDependencies): Promise<ListingSearchResult> {
  const processed = await Promise.all(request.sources.map(async (source) => {
    try {
      return { source, ...(await searchSource(source, request, dependencies)) };
    } catch {
      const meta: SourceSearchMeta = {
        status: 'failed', discovered: 0, attempted: 0, parsed: 0, partial: 0, blocked: 0, failed: 1,
        strategy: '', durationMs: 0, warnings: ['source_failed:provider_error'], returned: 0, strategies: [],
        errors: ['source_failed:provider_error'], removedConfirmed: 0,
        diagnostic: { linksFound: 0, cardsRequested: 0, networkRequested: 0, cardsSucceeded: 0, cacheHits: 0, addressesParsed: 0, areasParsed: 0, floorsParsed: 0, pricesParsed: 0, blocked: 0, captcha: 0, captchaSolved: 0, timeouts: 0, errors: 1, methodUsed: {}, contentLength: 0, markdownLength: 0, rawLinks: 0, anchorCount: 0, structuredDataDetected: false, noResultsDetected: false },
        quality: { addressRate: 0, areaRate: 0, floorRate: 0, priceRate: 0, warning: true },
      };
      return { source, items: [] as NormalizedListing[], meta, itemPages: {}, discoveryPages: [] as ListingDiscoveryPage[] };
    }
  }));
  const sourceMeta: Partial<Record<ListingSource, SourceSearchMeta>> = {};
  const itemPages: Partial<Record<ListingSource, Record<string, number>>> = {};
  const discoveryPages: Partial<Record<ListingSource, ListingDiscoveryPage[]>> = {};
  const byCanonicalUrl = new Map<string, NormalizedListing>();
  for (const entry of processed) {
    sourceMeta[entry.source] = entry.meta;
    itemPages[entry.source] = entry.itemPages;
    discoveryPages[entry.source] = entry.discoveryPages;
    for (const item of entry.items) byCanonicalUrl.set(item.listingUrl, item);
  }
  return { items: [...byCanonicalUrl.values()], sources: sourceMeta, itemPages, discoveryPages };
}
