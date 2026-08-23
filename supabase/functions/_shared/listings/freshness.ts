import { cleanText, structuredRoots, uniqueWarnings, visibleText } from './parsing.ts';
import type { NormalizedListing } from './types.ts';

export const LISTING_FRESHNESS_DAYS = 30;
export const LISTING_FRESHNESS_MS = LISTING_FRESHNESS_DAYS * 24 * 60 * 60 * 1_000;

export interface ListingDateExtraction {
  publishedAt: string | null;
  sourceUpdatedAt: string | null;
  freshnessAt: string | null;
  freshnessKind: 'published' | 'updated' | null;
  dateConfidence: string | null;
  dateWarnings: string[];
}

interface ParsedDate {
  value: Date;
  confidence: 'high' | 'medium';
  relative: boolean;
}

const MONTHS: Record<string, number> = {
  января: 0, февраля: 1, марта: 2, апреля: 3, мая: 4, июня: 5,
  июля: 6, августа: 7, сентября: 8, октября: 9, ноября: 10, декабря: 11,
};

function validDate(value: Date): boolean {
  return Number.isFinite(value.getTime());
}

function moscowParts(reference: Date): { year: number; month: number; day: number; hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(reference);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return { year: Number(value.year), month: Number(value.month) - 1, day: Number(value.day), hour: Number(value.hour), minute: Number(value.minute) };
}

function moscowLocalToUtc(year: number, month: number, day: number, hour = 0, minute = 0): Date {
  return new Date(Date.UTC(year, month, day, hour - 3, minute, 0, 0));
}

function timeFromText(value: string): { hour: number; minute: number } {
  const match = value.match(/(?:в\s*)?(\d{1,2})[:.](\d{2})/i);
  if (!match) return { hour: 0, minute: 0 };
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59 ? { hour, minute } : { hour: 0, minute: 0 };
}

export function parseMarketplaceDate(raw: unknown, reference = new Date()): ParsedDate | null {
  if (raw instanceof Date) return validDate(raw) ? { value: raw, confidence: 'high', relative: false } : null;
  if (typeof raw === 'number') {
    const millis = raw > 10_000_000_000 ? raw : raw * 1_000;
    const value = new Date(millis);
    return validDate(value) ? { value, confidence: 'high', relative: false } : null;
  }
  const text = cleanText(raw, 300).toLowerCase().replace(/ё/g, 'е');
  if (!text) return null;

  const iso = text.match(/\b(\d{4}-\d{2}-\d{2}(?:[tT][0-9:.+-]+(?:z)?)?)\b/i)?.[1];
  if (iso) {
    const value = new Date(iso);
    if (validDate(value)) return { value, confidence: 'high', relative: false };
  }

  const absolute = text.match(/\b(\d{1,2})\s+(января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)\s+(\d{4})(?:\s*(?:г\.?|года)?)?(?:\s*(?:в)?\s*(\d{1,2})[:.](\d{2}))?/i);
  if (absolute) {
    const day = Number(absolute[1]);
    const month = MONTHS[absolute[2]];
    const year = Number(absolute[3]);
    const hour = Number(absolute[4] || 0);
    const minute = Number(absolute[5] || 0);
    if (day >= 1 && day <= 31 && year >= 2000 && year <= 2200 && hour <= 23 && minute <= 59) {
      const value = moscowLocalToUtc(year, month, day, hour, minute);
      if (validDate(value)) return { value, confidence: 'high', relative: false };
    }
  }

  // Some marketplaces publish an absolute day and month without a year.
  // (for example, "2 июня в 23:39"). Resolve it in Europe/Moscow and, when
  // that calendar date would be in the future, use the previous year.
  const shortAbsolute = text.match(/\b(\d{1,2})\s+(января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)(?:\s*(?:в)?\s*(\d{1,2})[:.](\d{2}))?/i);
  if (shortAbsolute) {
    const parts = moscowParts(reference);
    const day = Number(shortAbsolute[1]);
    const month = MONTHS[shortAbsolute[2]];
    const hour = Number(shortAbsolute[3] || 0);
    const minute = Number(shortAbsolute[4] || 0);
    if (day >= 1 && day <= 31 && hour <= 23 && minute <= 59) {
      let value = moscowLocalToUtc(parts.year, month, day, hour, minute);
      if (value.getTime() > reference.getTime() + 5 * 60_000) value = moscowLocalToUtc(parts.year - 1, month, day, hour, minute);
      if (validDate(value)) return { value, confidence: 'medium', relative: false };
    }
  }

  const hoursAgo = text.match(/(?:^|\s)(\d{1,3})\s+час(?:а|ов)?\s+назад(?=\s|$|[,.])/i);
  if (hoursAgo) return { value: new Date(reference.getTime() - Number(hoursAgo[1]) * 60 * 60 * 1_000), confidence: 'medium', relative: true };
  const daysAgo = text.match(/(?:^|\s)(\d{1,3})\s+д(?:ень|ня|ней)\s+назад(?=\s|$|[,.])/i);
  if (daysAgo) return { value: new Date(reference.getTime() - Number(daysAgo[1]) * 24 * 60 * 60 * 1_000), confidence: 'medium', relative: true };

  const relativeDay = text.match(/(?:^|\s)(сегодня|вчера)(?=\s|$|[,.])/i)?.[1];
  if (relativeDay) {
    const parts = moscowParts(reference);
    const time = timeFromText(text);
    const day = relativeDay === 'вчера' ? parts.day - 1 : parts.day;
    return { value: moscowLocalToUtc(parts.year, parts.month, day, time.hour, time.minute), confidence: 'medium', relative: true };
  }
  return null;
}

function walk(root: unknown, visit: (key: string, value: unknown) => void, depth = 0, seen = new Set<object>()): void {
  if (!root || typeof root !== 'object' || depth > 15 || seen.has(root)) return;
  seen.add(root);
  if (Array.isArray(root)) {
    for (const item of root.slice(0, 2_000)) walk(item, visit, depth + 1, seen);
    return;
  }
  for (const [key, value] of Object.entries(root as Record<string, unknown>)) {
    visit(key, value);
    walk(value, visit, depth + 1, seen);
  }
}

function markedDateTexts(html: string): Array<{ kind: 'published' | 'updated'; value: string }> {
  const output: Array<{ kind: 'published' | 'updated'; value: string }> = [];
  for (const match of String(html || '').matchAll(/<([a-z0-9]+)\b([^>]*(?:data-marker|data-name|data-testid|itemprop)=["'][^"']*(?:date|published|publication|created|updated|modified)[^"']*["'][^>]*)>([\s\S]{0,1000}?)<\/\1>/gi)) {
    const attributes = match[2] || '';
    const value = cleanText(match[3], 300);
    if (!value) continue;
    output.push({ kind: /updated|modified/i.test(attributes) ? 'updated' : 'published', value });
  }
  return output;
}

function labeledDateTexts(html: string, markdown: string): Array<{ kind: 'published' | 'updated'; value: string }> {
  const text = visibleText(html, markdown);
  const output: Array<{ kind: 'published' | 'updated'; value: string }> = [];
  const pattern = /(Дата публикации|Опубликовано|Размещено|Добавлено|Дата обновления|Обновлено|Изменено)\s*[:—-]?\s*([^\n|]{2,100})/gi;
  for (const match of text.matchAll(pattern)) {
    output.push({ kind: /обнов|измен/i.test(match[1] || '') ? 'updated' : 'published', value: match[2] || '' });
  }
  return output;
}

function acceptedDate(values: unknown[], reference: Date, warnings: string[], kind: 'published' | 'updated', source: 'structured' | 'visible'): { iso: string; confidence: string } | null {
  for (const value of values) {
    const parsed = parseMarketplaceDate(value, reference);
    if (!parsed) continue;
    if (parsed.value.getTime() > reference.getTime() + 5 * 60 * 1_000) {
      warnings.push('future_date_rejected');
      continue;
    }
    warnings.push(`${kind}_date_from_${source}_data`);
    if (parsed.relative) warnings.push('relative_date_interpreted_europe_moscow');
    return { iso: parsed.value.toISOString(), confidence: parsed.confidence };
  }
  return null;
}

export function extractListingDates(html: string, markdown = '', referenceValue: Date | string = new Date()): ListingDateExtraction {
  const reference = referenceValue instanceof Date ? referenceValue : new Date(referenceValue);
  const warnings: string[] = [];
  const structuredPublished: unknown[] = [];
  const structuredUpdated: unknown[] = [];
  const { roots } = structuredRoots(html);
  for (const root of roots) {
    walk(root, (key, value) => {
      if (/^(?:datePublished|publishedAt|createdAt|publicationDate)$/i.test(key)) structuredPublished.push(value);
      if (/^(?:dateModified|updatedAt|modifiedAt|lastUpdatedAt)$/i.test(key)) structuredUpdated.push(value);
    });
  }
  const visible = [...markedDateTexts(html), ...labeledDateTexts(html, markdown)];
  const published = acceptedDate(structuredPublished, reference, warnings, 'published', 'structured')
    || acceptedDate(visible.filter((item) => item.kind === 'published').map((item) => item.value), reference, warnings, 'published', 'visible');
  const updated = acceptedDate(structuredUpdated, reference, warnings, 'updated', 'structured')
    || acceptedDate(visible.filter((item) => item.kind === 'updated').map((item) => item.value), reference, warnings, 'updated', 'visible');
  const chosen = published || updated;
  if (!chosen) warnings.push('missing_freshness_date');
  if (published && updated) warnings.push('published_date_priority');
  return {
    publishedAt: published?.iso || null,
    sourceUpdatedAt: updated?.iso || null,
    freshnessAt: chosen?.iso || null,
    freshnessKind: published ? 'published' : updated ? 'updated' : null,
    dateConfidence: chosen?.confidence || null,
    dateWarnings: uniqueWarnings(warnings),
  };
}

export function listingFreshnessDecision(listing: Pick<NormalizedListing, 'freshnessAt'>, nowValue: Date | string = new Date()): 'recent' | 'old' | 'unknown' | 'future' {
  if (!listing.freshnessAt) return 'unknown';
  const freshness = new Date(listing.freshnessAt);
  const now = nowValue instanceof Date ? nowValue : new Date(nowValue);
  if (!validDate(freshness) || !validDate(now)) return 'unknown';
  const age = now.getTime() - freshness.getTime();
  if (age < -5 * 60 * 1_000) return 'future';
  return age <= LISTING_FRESHNESS_MS ? 'recent' : 'old';
}
