import type { BrowserlessPage, ListingPremiseType, NormalizedListing } from './types.ts';

export interface StructuredCandidate {
  externalId?: string | null;
  title?: string | null;
  address?: string;
  latitude?: number | null;
  longitude?: number | null;
  area?: number | null;
  rentMonthly?: number | null;
  pricePerSquareMeter?: number | null;
  floor?: number | null;
  premiseType?: ListingPremiseType | null;
  hasBasementOrSocle?: boolean;
  totalFloors?: number | null;
  ceilingHeight?: number | null;
  windowsCount?: number | null;
  description?: string | null;
  marketStatus?: 'active' | 'removed';
}

export interface StructuredExtraction {
  candidate: StructuredCandidate;
  warnings: string[];
}

export interface LinkedOfferUnit {
  area: number;
  rentMonthly: number | null;
  floor: number | null;
  totalFloors: number | null;
  pricePerSquareMeter: number | null;
  ratePeriod: 'month' | 'year' | null;
  sourceIndex: number;
}

export interface PageDiscoveryDiagnostics {
  contentLength: number;
  markdownLength: number;
  rawLinks: number;
  anchorCount: number;
  structuredDataDetected: boolean;
  noResultsDetected: boolean;
}

const HTML_ENTITIES: Record<string, string> = {
  amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ', laquo: '«', raquo: '»',
};

export function decodeHtml(value: string): string {
  return String(value || '').replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity) => {
    if (entity[0] === '#') {
      const hex = entity[1]?.toLowerCase() === 'x';
      const parsed = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
      return Number.isFinite(parsed) ? String.fromCodePoint(parsed) : match;
    }
    return HTML_ENTITIES[String(entity).toLowerCase()] ?? match;
  });
}

export function cleanText(value: unknown, maxLength = 20_000): string {
  return decodeHtml(String(value ?? ''))
    .replace(/\\u([0-9a-f]{4})/gi, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)))
    .replace(/<[^>]+>/g, ' ')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

export function visibleText(html: string, markdown = ''): string {
  const rendered = String(html || '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--([\s\S]*?)-->/g, ' ')
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|div|li|section|article|h[1-6])\s*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  return decodeHtml(`${markdown || ''}\n${rendered}`)
    .replace(/\r/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 500_000);
}

export function firstMatch(text: string, patterns: RegExp[]): string {
  for (const pattern of patterns) {
    const match = String(text || '').match(pattern);
    if (match?.[1]) return cleanText(match[1], 2_000);
  }
  return '';
}

export function parseNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const normalized = value.replace(/\u00a0/g, ' ').replace(/\s/g, '').replace(',', '.').replace(/[^0-9.-]/g, '');
  if (!normalized || normalized === '-' || normalized === '.') return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseMoney(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
  if (typeof value !== 'string') return null;
  const digits = value.replace(/\u00a0/g, ' ').replace(/[^0-9]/g, '');
  if (!digits) return null;
  const parsed = Number(digits);
  return Number.isFinite(parsed) ? parsed : null;
}

const AREA_NUMBER_SOURCE = '[0-9]+(?:[\\s\\u00a0][0-9]{3})*(?:[.,][0-9]+)?';
const AREA_UNIT_SOURCE = '(?:м²|м2|м\\^2|кв\\.?\\s*м)';
const ENGINEERING_AREA_CONTEXT = /энерговооруж|электрическ|мощност|нагрузк|ватт|\bквт\b|вентиляц|теплов|холодоснаб|инженерн|процент|коэффициент/i;
const BASEMENT_OR_SOCLE = /(?:^|[^А-Яа-яЁё])(?:подвал(?:е|а|у|ом|ьн(?:ый|ое|ая|ом|ые|ых)?)?|цокол(?:ь|е|я|ю|ем|ьн(?:ый|ое|ая|ом|ые|ых)?))(?=$|[^А-Яа-яЁё])/iu;

export interface PremiseTypeDetection {
  premiseType: ListingPremiseType | null;
  ambiguous: boolean;
}

export function detectPremiseType(values: unknown[]): PremiseTypeDetection {
  const matches = new Set<ListingPremiseType>();
  for (const value of values) {
    const text = cleanText(value, 2_000).toLowerCase();
    if (!text) continue;
    if (/офис(?:ное|ная|ный|ные|ных|ов|ы)?(?:\s+помещени[ея])?|(?:^|[^a-z])offices?(?=$|[^a-z])/iu.test(text)) matches.add('office');
    if (/торгов(?:ая|ое|ые|ых)\s+(?:площад(?:ь|и|ей)|помещени[ея])|стрит[-\s]?ритейл|магазин|(?:^|[^a-z])retail(?=$|[^a-z])|shopping[-_\s]?area/iu.test(text)) matches.add('retail');
    if (/помещени[ея]\s+свободного\s+назначения|(?:^|[^А-Яа-яЁё])псн(?=$|[^А-Яа-яЁё])|free[-_\s]?(?:purpose|appointment)/iu.test(text)) matches.add('free_purpose');
  }
  return { premiseType: matches.size === 1 ? [...matches][0] : null, ambiguous: matches.size > 1 };
}

export function hasBasementOrSocle(value: unknown): boolean {
  return BASEMENT_OR_SOCLE.test(cleanText(value, 500_000));
}

export function floorNumberFromText(value: unknown): number | null {
  const text = cleanText(value, 2_000);
  const token = '(?:-?\\d{1,3}|1\\s*[-–—]?\\s*(?:й|ый)|перв(?:ый|ом))';
  if (/^(?:1\s*[-–—]?\s*(?:й|ый)|перв(?:ый|ом))$/iu.test(text)) return 1;
  const labeled = text.match(new RegExp(`(?:Этаж|Этаж помещения)\\s*[:—-]?\\s*(${token})`, 'iu'));
  const compact = labeled || text.match(new RegExp(`(?:^|[\\s,;])(${token})\\s+(?:этаж(?:е|а)?|эт\\.)(?=$|[^А-Яа-яЁё])`, 'iu'));
  const raw = compact?.[1] || '';
  if (/^\s*(?:1\s*[-–—]?\s*(?:й|ый)|перв(?:ый|ом))\s*$/iu.test(raw)) return 1;
  return parseNumber(raw);
}

function forbiddenAreaCandidate(text: string, numberIndex: number, matchedText: string, labeled: boolean): boolean {
  const tail = text.slice(numberIndex, numberIndex + Math.max(100, matchedText.length + 50));
  if (new RegExp(`^${AREA_NUMBER_SOURCE}\\s*(?:Вт\\s*\\/\\s*${AREA_UNIT_SOURCE}|кВт|₽\\s*\\/\\s*${AREA_UNIT_SOURCE}(?:\\s*(?:в|\\/)\\s*(?:год|месяц|мес))?|%|процент)`, 'i').test(tail)) return true;
  const before = text.slice(Math.max(0, numberIndex - 120), numberIndex);
  if (!labeled && ENGINEERING_AREA_CONTEXT.test(before)) return true;
  if (!labeled && /(?:[0-9][0-9\s\u00a0]*(?:[.,][0-9]+)?)\s*[-–—]\s*$/.test(before)) return true;
  if (!labeled && /(?:диапазон|площади\s+от|от)\s+[0-9][0-9\s\u00a0]*(?:[.,][0-9]+)?\s*[-–—]\s*$/i.test(before)) return true;
  return false;
}

interface AreaOccurrence {
  area: number;
  index: number;
  end: number;
  labeled: boolean;
}

function areaOccurrences(text: string): AreaOccurrence[] {
  const pattern = new RegExp(`(?:(Общая площадь|Площадь помещения|Площадь)\\s*[:—-]?\\s*)?(${AREA_NUMBER_SOURCE})\\s*${AREA_UNIT_SOURCE}`, 'gi');
  const occurrences: AreaOccurrence[] = [];
  for (const match of String(text || '').matchAll(pattern)) {
    const rawNumber = match[2] || '';
    const numberOffset = match[0].lastIndexOf(rawNumber);
    const numberIndex = (match.index || 0) + Math.max(0, numberOffset);
    const labeled = Boolean(match[1]);
    if (forbiddenAreaCandidate(text, numberIndex, match[0], labeled)) continue;
    const area = boundedNumber(rawNumber, 5, 100_000);
    if (area == null) continue;
    occurrences.push({ area, index: match.index || 0, end: (match.index || 0) + match[0].length, labeled });
  }
  return occurrences;
}

export function labeledAreaValue(text: string): string {
  const occurrence = areaOccurrences(text).find((value) => value.labeled);
  return occurrence ? String(occurrence.area) : '';
}

function rentFromOfferSegment(segment: string): number | null {
  const labeled = segment.match(/(?:Арендная плата|Стоимость аренды|Аренда|Цена)\s*[:—-]?\s*([0-9][0-9\s\u00a0]*(?:[.,][0-9]+)?)\s*(?:₽|руб(?:\.|лей)?)\s*(?!\/\s*(?:м²|м2|м\^2|кв\.?\s*м))/i)?.[1];
  const monthly = segment.match(/([0-9][0-9\s\u00a0]*(?:[.,][0-9]+)?)\s*(?:₽|руб(?:\.|лей)?)\s*(?:\/\s*|в\s*)?(?:мес(?:яц)?|месяц)(?!\w)/i)?.[1];
  return parseMoney(labeled || monthly || '');
}

function floorFromOfferSegment(segment: string): { floor: number | null; totalFloors: number | null } {
  const floor = floorNumberFromText(segment);
  const total = segment.match(/(?:Этаж|Этаж помещения)\s*[:—-]?\s*(?:-?\d{1,3}|1\s*[-–—]?\s*(?:й|ый)|перв(?:ый|ом))\s*(?:из|\/)\s*(\d{1,3})/iu);
  return { floor, totalFloors: parseNumber(total?.[1]) };
}

function rateFromOfferSegment(segment: string): { pricePerSquareMeter: number | null; ratePeriod: 'month' | 'year' | null } {
  const match = segment.match(new RegExp(`(${AREA_NUMBER_SOURCE})\\s*(?:₽|руб(?:\\.|лей)?)\\s*\\/\\s*${AREA_UNIT_SOURCE}\\s*(?:(?:в|\\/)\\s*)?(год|месяц|мес)(?!\\w)`, 'i'));
  const value = boundedNumber(match?.[1], 1, 100_000_000);
  if (value == null) return { pricePerSquareMeter: null, ratePeriod: null };
  const ratePeriod = /^год$/i.test(match?.[2] || '') ? 'year' : 'month';
  return {
    pricePerSquareMeter: ratePeriod === 'year' ? Math.round((value / 12) * 100) / 100 : value,
    ratePeriod,
  };
}

export function extractLinkedOfferUnits(text: string): LinkedOfferUnit[] {
  const occurrences = areaOccurrences(text);
  const units: LinkedOfferUnit[] = [];
  for (let index = 0; index < occurrences.length; index += 1) {
    const occurrence = occurrences[index];
    const next = occurrences[index + 1];
    const segmentEnd = Math.min(next?.index ?? text.length, occurrence.end + 1_200);
    const segment = text.slice(occurrence.index, segmentEnd);
    const rentMonthly = rentFromOfferSegment(segment);
    const floor = floorFromOfferSegment(segment);
    const rate = rateFromOfferSegment(segment);
    units.push({
      area: occurrence.area,
      rentMonthly,
      floor: floor.floor,
      totalFloors: floor.totalFloors,
      pricePerSquareMeter: rate.pricePerSquareMeter,
      ratePeriod: rate.ratePeriod,
      sourceIndex: occurrence.index,
    });
  }
  const unique = new Map<string, LinkedOfferUnit>();
  for (const unit of units) {
    const key = [unit.area, unit.rentMonthly, unit.floor, unit.totalFloors, unit.pricePerSquareMeter].join('|');
    if (!unique.has(key)) unique.set(key, unit);
  }
  return [...unique.values()];
}

export function boundedNumber(value: unknown, min: number, max: number): number | null {
  const parsed = parseNumber(value);
  return parsed != null && parsed >= min && parsed <= max ? parsed : null;
}

export function metaContent(html: string, names: string[]): string {
  for (const name of names) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const patterns = [
      new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']+)["']`, 'i'),
      new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${escaped}["']`, 'i'),
    ];
    const value = firstMatch(html, patterns);
    if (value) return value;
  }
  return '';
}

export function markedText(html: string, attributes: Array<[string, string]>): string {
  for (const [attribute, value] of attributes) {
    const attr = attribute.replace(/[^a-z0-9_:-]/gi, '');
    const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`<([a-z0-9]+)\\b[^>]*\\b${attr}=["'][^"']*${escaped}[^"']*["'][^>]*>([\\s\\S]{0,5000}?)<\\/\\1>`, 'i');
    const match = html.match(pattern);
    if (match?.[2]) {
      const value = cleanText(match[2], 2_000);
      if (value) return value;
    }
  }
  return '';
}

function walkJson(root: unknown, visit: (key: string, value: unknown, parent: Record<string, unknown>) => void, depth = 0, seen = new Set<object>()): void {
  if (!root || typeof root !== 'object' || depth > 15 || seen.has(root)) return;
  seen.add(root);
  if (Array.isArray(root)) {
    for (const value of root.slice(0, 1_000)) walkJson(value, visit, depth + 1, seen);
    return;
  }
  const object = root as Record<string, unknown>;
  for (const [key, value] of Object.entries(object)) {
    visit(key, value, object);
    walkJson(value, visit, depth + 1, seen);
  }
}

function parseJsonScripts(html: string, selector: (attributes: string, text: string) => boolean, malformedWarning: string): { values: unknown[]; warnings: string[] } {
  const values: unknown[] = [];
  const warnings: string[] = [];
  for (const match of String(html || '').matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const attributes = match[1] || '';
    const text = decodeHtml(match[2] || '').trim();
    if (!text || text.length > 2_000_000 || !selector(attributes, text)) continue;
    try {
      values.push(JSON.parse(text));
    } catch {
      warnings.push(malformedWarning);
    }
  }
  return { values, warnings };
}

export function structuredRoots(html: string): { roots: unknown[]; warnings: string[] } {
  const jsonLd = parseJsonScripts(
    html,
    (attributes) => /type\s*=\s*["']application\/ld\+json["']/i.test(attributes),
    'malformed_json_ld',
  );
  const embedded = parseJsonScripts(
    html,
    (attributes, text) => !/application\/ld\+json/i.test(attributes) &&
      (/type\s*=\s*["']application\/(?:json|json\+ld)["']/i.test(attributes) || /id\s*=\s*["']__NEXT_DATA__["']/i.test(attributes) || /^[\[{]/.test(text)),
    'malformed_structured_data',
  );
  return {
    roots: [...jsonLd.values, ...embedded.values],
    warnings: uniqueWarnings([...jsonLd.warnings, ...embedded.warnings]),
  };
}

function decodeJsonString(value: string): string {
  try {
    return JSON.parse(`"${value.replace(/"/g, '\\"')}"`);
  } catch {
    return value.replace(/\\\//g, '/').replace(/\\u002F/gi, '/').replace(/&amp;/gi, '&');
  }
}

export function structuredLinkCandidates(html: string): string[] {
  const candidates: string[] = [];
  const { roots } = structuredRoots(html);
  for (const root of roots) {
    walkJson(root, (key, value) => {
      if (typeof value !== 'string') return;
      if (/^(?:url|urlPath|canonicalUrl|href|link|uri|path|itemUrl|seoUrl)$/i.test(key) || /^(?:https?:\/\/|\/)/.test(value)) {
        candidates.push(value);
      }
    });
  }
  const keyedValue = /["'](?:url|urlPath|canonicalUrl|href|link|uri|path|itemUrl|seoUrl)["']\s*:\s*"((?:\\.|[^"\\])*)"/gi;
  for (const match of String(html || '').matchAll(keyedValue)) candidates.push(decodeJsonString(match[1] || ''));
  return [...new Set(candidates.map((value) => String(value || '').trim()).filter(Boolean))].slice(0, 5_000);
}

export function rawPageLinkCandidates(page: Pick<BrowserlessPage, 'html' | 'markdown' | 'links'>): string[] {
  const values: string[] = [...(page.links || []).map(String), ...structuredLinkCandidates(page.html || '')];
  const raw = `${page.html || ''}\n${page.markdown || ''}`;
  for (const match of raw.matchAll(/(?:href\s*=\s*["']|\]\()([^"')\s<>]+)(?:["']|\))/gi)) values.push(match[1]);
  for (const match of raw.matchAll(/https?:\/\/[^\s"'<>\])]+/gi)) values.push(match[0]);
  return [...new Set(values.map((value) => String(value || '').replace(/&amp;/g, '&').replace(/\\\//g, '/').trim()).filter(Boolean))].slice(0, 10_000);
}

export function pageDiscoveryDiagnostics(page: Pick<BrowserlessPage, 'html' | 'markdown' | 'links'>): PageDiscoveryDiagnostics {
  const html = String(page.html || '');
  const markdown = String(page.markdown || '');
  const text = visibleText(html, markdown).toLowerCase();
  return {
    contentLength: html.length,
    markdownLength: markdown.length,
    rawLinks: rawPageLinkCandidates(page).length,
    anchorCount: (html.match(/<a\b/gi) || []).length,
    structuredDataDetected: /<script\b[^>]*(?:type\s*=\s*["']application\/(?:ld\+json|json)["']|id\s*=\s*["']__NEXT_DATA__["'])/i.test(html) || structuredLinkCandidates(html).length > 0,
    noResultsDetected: /ничего не найдено|объявлений не найдено|по вашему запросу ничего|нет подходящих объявлений|предложений не найдено|no listings found|no results found/i.test(text),
  };
}

function postalAddress(value: unknown): string {
  if (typeof value === 'string') return cleanText(value, 500);
  if (!value || typeof value !== 'object') return '';
  const object = value as Record<string, unknown>;
  return cleanText([
    object.addressCountry,
    object.addressRegion,
    object.addressLocality,
    object.streetAddress,
    object.house,
  ].filter(Boolean).join(', '), 500);
}

function scalar(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value;
  const object = value as Record<string, unknown>;
  return object.value ?? object.valueReference ?? object.name ?? object.amount ?? null;
}

export function extractStructured(html: string): StructuredExtraction {
  const { roots, warnings } = structuredRoots(html);
  const candidate: StructuredCandidate = {};
  const typeValues: unknown[] = [];
  for (const root of roots) {
    walkJson(root, (key, value, parent) => {
      if (!candidate.title && /^(name|headline|title)$/i.test(key) && typeof value === 'string') candidate.title = cleanText(value, 500) || null;
      if (!candidate.description && /^description$/i.test(key) && typeof value === 'string') candidate.description = cleanText(value, 10_000) || null;
      if (!candidate.address && /^(address|locationAddress|fullAddress|formattedAddress)$/i.test(key)) candidate.address = postalAddress(value);
      if (!candidate.address && /^streetAddress$/i.test(key)) candidate.address = postalAddress(parent.address ?? parent);
      if (candidate.area == null && /^(floorSize|totalArea|area|square|squareMeters|objectArea)$/i.test(key)) candidate.area = boundedNumber(scalar(value), 5, 100_000);
      if (candidate.rentMonthly == null && /^(rentMonthly|monthlyPrice|rentPrice|priceValue)$/i.test(key)) candidate.rentMonthly = boundedNumber(scalar(value), 1_000, 1_000_000_000);
      if (candidate.rentMonthly == null && /^price$/i.test(key)) {
        const price = boundedNumber(scalar(value), 1_000, 1_000_000_000);
        const unit = cleanText(parent.unitText ?? parent.billingDuration ?? parent.priceType ?? '', 100);
        if (price != null && !/(м²|m2|sqm|кв)/i.test(unit)) candidate.rentMonthly = price;
      }
      if (candidate.pricePerSquareMeter == null && /^(pricePerSquareMeter|pricePerSqm|squareMeterPrice)$/i.test(key)) candidate.pricePerSquareMeter = boundedNumber(scalar(value), 1, 100_000_000);
      if (/^(category|categoryName|propertyType|commercialType|premiseType|offerType|objectType|objectTypeName)$/i.test(key)) typeValues.push(scalar(value));
      if (/^(floor|floorNumber|floorNum|objectFloor)$/i.test(key)) {
        if (candidate.floor == null) candidate.floor = boundedNumber(scalar(value), -5, 300) ?? floorNumberFromText(scalar(value));
        if (hasBasementOrSocle(scalar(value))) candidate.hasBasementOrSocle = true;
      }
      if (candidate.totalFloors == null && /^(numberOfFloors|totalFloors|floorsTotal|buildingFloors)$/i.test(key)) candidate.totalFloors = boundedNumber(scalar(value), 1, 300);
      if (candidate.ceilingHeight == null && /^(ceilingHeight|ceiling)$/i.test(key)) candidate.ceilingHeight = boundedNumber(scalar(value), 1.5, 30);
      if (candidate.windowsCount == null && /^(numberOfWindows|windowsCount)$/i.test(key)) candidate.windowsCount = boundedNumber(scalar(value), 0, 1_000);
      if (candidate.latitude == null && /^(latitude|lat)$/i.test(key)) candidate.latitude = boundedNumber(value, -90, 90);
      if (candidate.longitude == null && /^(longitude|lng|lon)$/i.test(key)) candidate.longitude = boundedNumber(value, -180, 180);
      if (!candidate.externalId && /^(sku|productID|listingId|offerId)$/i.test(key) && ['string', 'number'].includes(typeof value)) candidate.externalId = cleanText(value, 100) || null;
      if (/^(availability|marketStatus|status)$/i.test(key) && typeof value === 'string') {
        if (/outofstock|soldout|removed|inactive|снят|закрыт/i.test(value)) candidate.marketStatus = 'removed';
      }
    });
  }
  const titleType = detectPremiseType([candidate.title]);
  const structuredType = detectPremiseType(typeValues);
  const preferred = structuredType.premiseType || titleType.premiseType;
  const conflict = structuredType.ambiguous || titleType.ambiguous
    || Boolean(structuredType.premiseType && titleType.premiseType && structuredType.premiseType !== titleType.premiseType);
  candidate.premiseType = conflict ? null : preferred;
  candidate.hasBasementOrSocle = Boolean(candidate.hasBasementOrSocle || hasBasementOrSocle([candidate.title, candidate.description].filter(Boolean).join(' ')));
  if (conflict) warnings.push('ambiguous_premise_type');
  return { candidate, warnings };
}

export function blockReason(text: string): string | null {
  const normalized = cleanText(text, 200_000).toLowerCase();
  if (!normalized) return null;
  if (/captcha|recaptcha|hcaptcha|turnstile|datadome|yandex.*captcha/.test(normalized)) return 'captcha';
  if (/подтвердите,? что вы не робот|проверка браузера|robot check|verify you are human|checking your browser/.test(normalized)) return 'robot_check';
  if (/войдите,? чтобы (?:увидеть|продолжить|получить доступ)|требуется авторизация|login required|sign in to continue/.test(normalized)) return 'login_required';
  if (/access denied|доступ (?:запрещ[её]н|ограничен)|request forbidden|temporarily blocked|ваш доступ ограничен/.test(normalized)) return 'access_denied';
  if (/too many requests|слишком много запросов|rate limit/.test(normalized)) return 'rate_limited';
  return null;
}

export function pageBlockReason(html: string, markdown = ''): string | null {
  return blockReason(`${markdown || ''}\n${visibleText(html)}`);
}

export function removedFromText(text: string): boolean {
  return /объявление\s+(?:снято|закрыто|неактивно)|объявление больше не актуально|страница не найдена|listing (?:was )?removed/i.test(text);
}

export function uniqueWarnings(warnings: Array<string | null | undefined>): string[] {
  return [...new Set(warnings.map((warning) => String(warning || '').trim()).filter(Boolean))].slice(0, 30);
}

export function listingCompleteness(listing: Partial<NormalizedListing>): number {
  const fields = [
    listing.externalId,
    listing.title,
    listing.address,
    listing.latitude != null && listing.longitude != null ? 'geo' : null,
    listing.area,
    listing.rentMonthly,
    listing.pricePerSquareMeter,
    listing.floor,
    listing.premiseType,
    listing.hasBasementOrSocle,
    listing.totalFloors,
    listing.ceilingHeight,
    listing.description,
  ];
  const present = fields.filter((value) => value !== null && value !== undefined && value !== '').length;
  return Number((present / fields.length).toFixed(2));
}

export function isCompleteListing(listing: Partial<NormalizedListing>): boolean {
  const semanticFailure = (listing.parseWarnings || []).some((warning) => [
    'semantic_offer_association_failed',
    'semantic_linked_pair_missing',
    'semantic_price_per_square_meter_mismatch',
    'semantic_rent_area_ratio_outlier',
  ].includes(warning));
  return !semanticFailure && Boolean(String(listing.address || '').trim()) && listing.area != null && listing.rentMonthly != null;
}
