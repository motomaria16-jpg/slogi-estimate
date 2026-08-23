import {
  boundedNumber,
  cleanText,
  extractStructured,
  isCompleteListing,
  listingCompleteness,
  pageBlockReason,
  rawPageLinkCandidates,
  removedFromText,
  uniqueWarnings,
  visibleText,
} from './parsing.ts';
import { extractListingDates } from './freshness.ts';
import type {
  BrowserlessPage,
  ListingProvider,
  ListingProviderDiagnostics,
  ListingSearchFilters,
  ListingSource,
  ListingUrlResult,
  NormalizedListing,
} from './types.ts';

export interface ProviderFallback {
  candidate: Partial<NormalizedListing>;
  warnings: string[];
  authoritativeFields?: Array<keyof NormalizedListing>;
}

function defined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined && entry !== null && entry !== '')) as Partial<T>;
}

function normalizedTimestamp(value: unknown): string | null {
  if (!value) return null;
  const parsed = new Date(String(value));
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

export abstract class BaseListingProvider implements ListingProvider {
  readonly source: ListingSource;

  protected constructor(source: ListingSource) {
    this.source = source;
  }

  protected abstract hostAllowed(hostname: string): boolean;
  protected abstract canonicalHost(hostname: string): string;
  protected abstract externalIdFromUrl(url: URL): string | null;
  protected abstract listingPathAllowed(url: URL): boolean;
  protected abstract defaultSearchUrl(): string;
  protected abstract parseFallback(page: BrowserlessPage, canonicalUrl: string): ProviderFallback;

  validateAndCanonicalizeUrl(rawUrl: string): ListingUrlResult {
    const rejected = (reason: string): ListingUrlResult => ({
      ok: false,
      source: this.source,
      canonicalUrl: null,
      externalId: null,
      reason,
    });
    if (!rawUrl || rawUrl.length > 2_048) return rejected('invalid_url');
    try {
      const url = new URL(String(rawUrl).trim());
      const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port) return rejected('invalid_url');
      if (!this.hostAllowed(hostname)) return rejected('unsupported_domain');
      if (!this.listingPathAllowed(url)) return rejected('not_a_public_listing');
      const externalId = this.externalIdFromUrl(url);
      if (!externalId) return rejected('missing_external_id');
      url.protocol = 'https:';
      url.hostname = this.canonicalHost(hostname);
      url.hash = '';
      url.search = '';
      url.pathname = url.pathname.replace(/\/{2,}/g, '/').replace(/\/$/, '');
      return { ok: true, source: this.source, canonicalUrl: url.toString(), externalId };
    } catch {
      return rejected('invalid_url');
    }
  }

  buildSearchUrl(page: number, filters: ListingSearchFilters): string {
    const fallback = new URL(this.defaultSearchUrl());
    let url = fallback;
    if (filters.searchBaseUrl) {
      try {
        const candidate = new URL(filters.searchBaseUrl);
        if (['http:', 'https:'].includes(candidate.protocol) && !candidate.username && !candidate.password && !candidate.port && this.hostAllowed(candidate.hostname.toLowerCase())) {
          candidate.protocol = 'https:';
          candidate.hash = '';
          url = candidate;
        }
      } catch {
        // Invalid overrides are ignored; the provider-owned safe default wins.
      }
    }
    this.applySearchParameters(url, Math.max(1, Math.trunc(page)), filters);
    return url.toString();
  }

  protected applySearchParameters(url: URL, page: number, _filters: ListingSearchFilters): void {
    url.searchParams.set('p', String(page));
  }

  discoverListingUrls(page: BrowserlessPage): string[] {
    const values = rawPageLinkCandidates(page);
    const resolved = values.map((value) => {
      try {
        return new URL(String(value).replace(/&amp;/g, '&').replace(/\\\//g, '/'), this.defaultSearchUrl()).toString();
      } catch {
        return '';
      }
    });
    return this.deduplicate(resolved);
  }

  deduplicate(urls: string[]): string[] {
    const unique = new Set<string>();
    for (const value of urls) {
      const result = this.validateAndCanonicalizeUrl(value);
      if (result.ok && result.canonicalUrl) unique.add(result.canonicalUrl);
    }
    return [...unique];
  }

  parseListing(page: BrowserlessPage, canonicalUrl: string, observedAt = new Date().toISOString()): NormalizedListing {
    const structured = extractStructured(page.html || '');
    const fallback = this.parseFallback(page, canonicalUrl);
    const urlResult = this.validateAndCanonicalizeUrl(canonicalUrl);
    const text = visibleText(page.html || '', page.markdown || '');
    const dates = extractListingDates(page.html || '', page.markdown || '', observedAt);
    const authoritative = Object.fromEntries((fallback.authoritativeFields || []).map((field) => [field, fallback.candidate[field]]));
    const candidate: Partial<NormalizedListing> = {
      ...defined(fallback.candidate),
      ...defined(structured.candidate as Partial<NormalizedListing>),
      ...authoritative,
      externalId: urlResult.externalId || structured.candidate.externalId || fallback.candidate.externalId || null,
      ...dates,
      marketStatus: structured.candidate.marketStatus || (removedFromText(text) ? 'removed' : 'active'),
      parseWarnings: uniqueWarnings([
        ...structured.warnings,
        ...fallback.warnings,
        ...(page.warnings || []),
        pageBlockReason(page.html || '', page.markdown || '') ? 'blocked_content_detected' : null,
        !text ? 'empty_page' : null,
      ]),
    };
    return this.normalizeResult(candidate, canonicalUrl, observedAt);
  }

  normalizeResult(candidate: Partial<NormalizedListing>, canonicalUrl: string, observedAt = new Date().toISOString()): NormalizedListing {
    const urlResult = this.validateAndCanonicalizeUrl(canonicalUrl);
    const warnings = [...(candidate.parseWarnings || [])];
    const dateWarnings = [...(candidate.dateWarnings || [])];
    const publishedAt = normalizedTimestamp(candidate.publishedAt);
    const sourceUpdatedAt = normalizedTimestamp(candidate.sourceUpdatedAt);
    const explicitFreshness = normalizedTimestamp(candidate.freshnessAt);
    const freshnessAt = publishedAt || sourceUpdatedAt || explicitFreshness;
    const freshnessKind = publishedAt ? 'published' : sourceUpdatedAt ? 'updated' : candidate.freshnessKind === 'published' || candidate.freshnessKind === 'updated' ? candidate.freshnessKind : null;
    if (!freshnessAt && !dateWarnings.includes('missing_freshness_date')) dateWarnings.push('missing_freshness_date');
    const area = boundedNumber(candidate.area, 5, 100_000);
    const rentMonthly = boundedNumber(candidate.rentMonthly, 1_000, 1_000_000_000);
    const publishedPricePerSquareMeter = boundedNumber(candidate.pricePerSquareMeter, 1, 100_000_000);
    let pricePerSquareMeter = publishedPricePerSquareMeter;
    if (pricePerSquareMeter == null && area != null && area > 0 && rentMonthly != null) {
      pricePerSquareMeter = Math.round((rentMonthly / area) * 100) / 100;
      warnings.push('price_per_square_meter_derived');
    }
    if (area != null && rentMonthly != null) {
      const derivedMonthlyRate = rentMonthly / area;
      if (derivedMonthlyRate < 100 || derivedMonthlyRate > 1_000_000) warnings.push('semantic_rent_area_ratio_outlier');
      if (publishedPricePerSquareMeter != null) {
        const relativeDifference = Math.abs(publishedPricePerSquareMeter - derivedMonthlyRate) / Math.max(publishedPricePerSquareMeter, derivedMonthlyRate);
        if (relativeDifference > 0.08) warnings.push('semantic_price_per_square_meter_mismatch');
      }
    }
    const listing: NormalizedListing = {
      source: this.source,
      listingUrl: urlResult.canonicalUrl || canonicalUrl,
      externalId: candidate.externalId ? cleanText(candidate.externalId, 100) : urlResult.externalId,
      title: candidate.title ? cleanText(candidate.title, 500) : null,
      address: cleanText(candidate.address || '', 500),
      latitude: boundedNumber(candidate.latitude, -90, 90),
      longitude: boundedNumber(candidate.longitude, -180, 180),
      area,
      rentMonthly,
      pricePerSquareMeter,
      floor: boundedNumber(candidate.floor, -5, 300),
      totalFloors: boundedNumber(candidate.totalFloors, 1, 300),
      ceilingHeight: boundedNumber(candidate.ceilingHeight, 1.5, 30),
      description: candidate.description ? cleanText(candidate.description, 10_000) : null,
      publishedAt,
      sourceUpdatedAt,
      freshnessAt,
      freshnessKind,
      dateConfidence: candidate.dateConfidence ? cleanText(candidate.dateConfidence, 50) : null,
      dateWarnings: uniqueWarnings(dateWarnings),
      firstSeenAt: candidate.firstSeenAt || observedAt,
      lastSeenAt: candidate.lastSeenAt || observedAt,
      marketStatus: candidate.marketStatus === 'removed' ? 'removed' : candidate.marketStatus === 'new' ? 'new' : 'active',
      parseCompleteness: 0,
      parseWarnings: [],
      windowsCount: boundedNumber(candidate.windowsCount, 0, 1_000),
      previousRentMonthly: candidate.previousRentMonthly ?? null,
      priceChanged: Boolean(candidate.priceChanged),
      clusterName: String(candidate.clusterName || ''),
    };
    if (!listing.address) warnings.push('missing_address');
    if (listing.area == null) warnings.push('missing_area');
    if (listing.rentMonthly == null) warnings.push('missing_rent_monthly');
    if (!isCompleteListing(listing)) warnings.push('partial_listing');
    listing.parseCompleteness = listingCompleteness(listing);
    listing.parseWarnings = uniqueWarnings(warnings);
    return listing;
  }

  diagnostics(listing: NormalizedListing, page: BrowserlessPage): ListingProviderDiagnostics {
    return {
      source: this.source,
      strategy: page.strategy,
      completeness: listing.parseCompleteness,
      warnings: uniqueWarnings([...page.warnings, ...listing.parseWarnings]),
    };
  }
}
