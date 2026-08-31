import { BaseListingProvider, type ProviderFallback } from '../provider.ts';
import {
  extractLinkedOfferUnits,
  detectPremiseType,
  firstMatch,
  floorNumberFromText,
  hasBasementOrSocle,
  labeledAreaValue,
  markedText,
  metaContent,
  parseMoney,
  parseNumber,
  visibleText,
} from '../parsing.ts';
import { LISTING_SELECTION } from '../selection.ts';
import type { BrowserlessPage, ListingSearchFilters, NormalizedListing } from '../types.ts';

export class CianListingProvider extends BaseListingProvider {
  constructor() {
    super('cian');
  }

  protected hostAllowed(hostname: string): boolean {
    return hostname === 'cian.ru' || hostname.endsWith('.cian.ru');
  }

  protected canonicalHost(hostname: string): string {
    return ['cian.ru', 'm.cian.ru', 'www.cian.ru'].includes(hostname) ? 'www.cian.ru' : hostname;
  }

  protected listingPathAllowed(url: URL): boolean {
    return /^\/(?:rent|sale)\/commercial\/\d+\/?$/i.test(url.pathname);
  }

  protected externalIdFromUrl(url: URL): string | null {
    return url.pathname.match(/^\/(?:rent|sale)\/commercial\/(\d+)\/?$/i)?.[1] || null;
  }

  protected defaultSearchUrl(): string {
    return 'https://www.cian.ru/cat.php?deal_type=rent&engine_version=2&offer_type=offices&region=1';
  }

  protected applySearchParameters(url: URL, page: number, filters: ListingSearchFilters): void {
    url.searchParams.set('deal_type', url.searchParams.get('deal_type') || 'rent');
    url.searchParams.set('engine_version', url.searchParams.get('engine_version') || '2');
    url.searchParams.set('offer_type', url.searchParams.get('offer_type') || 'offices');
    url.searchParams.set('region', url.searchParams.get('region') || '1');
    url.searchParams.set('p', String(page));
    if (filters.areaMin != null) url.searchParams.set('minarea', String(filters.areaMin));
    if (filters.areaMax != null) url.searchParams.set('maxarea', String(filters.areaMax));
    if (filters.floor != null) url.searchParams.set('floor', String(filters.floor));
  }

  protected parseFallback(page: BrowserlessPage, _canonicalUrl: string): ProviderFallback {
    const html = page.html || '';
    const text = visibleText(html, page.markdown || '');
    const warnings: string[] = [];

    const markedAddress = markedText(html, [
      ['data-name', 'AddressContainer'],
      ['data-name', 'Geo'],
      ['data-testid', 'address'],
      ['itemprop', 'address'],
    ]);
    const textAddress = firstMatch(text, [
      /(?:Адрес|Расположение|Местоположение)\s*[:—-]?\s*([^\n]{5,220})/i,
      /((?:Москва|Московская область)\s*,\s*(?:ул\.|улица|ш\.|шоссе|проспект|пр-т|пер\.|переулок|наб\.|набережная)[^\n]{3,160}?\d+[А-Яа-яA-Za-z0-9/\-]*)/i,
    ]);
    const address = markedAddress || textAddress;
    if (!markedAddress && textAddress) warnings.push('address_from_visible_text');

    const markedTitle = markedText(html, [
      ['data-name', 'OfferTitle'],
      ['data-testid', 'offer-title'],
      ['itemprop', 'name'],
    ]);
    const title = markedTitle || metaContent(html, ['og:title', 'twitter:title']);

    const description = markedText(html, [
      ['data-name', 'Description'],
      ['data-testid', 'description'],
      ['itemprop', 'description'],
    ]) || metaContent(html, ['og:description', 'description']);

    const linkedUnits = extractLinkedOfferUnits(text);
    const completeUnits = linkedUnits
      .filter((unit) => unit.area != null && unit.rentMonthly != null)
      .sort((left, right) => left.area - right.area || left.sourceIndex - right.sourceIndex);
    const multipleUnits = linkedUnits.length > 1;
    const selectedUnits = completeUnits.filter((unit) => unit.area >= LISTING_SELECTION.areaMin
      && unit.area <= LISTING_SELECTION.areaMax && unit.floor === LISTING_SELECTION.floor);
    const representative = multipleUnits ? selectedUnits[0] || completeUnits[0] || null : null;

    const areaLabel = labeledAreaValue(text);
    const rentLabel = firstMatch(text, [
      /(?:Арендная плата|Стоимость аренды|Аренда|Цена)\s*[:—-]?\s*([0-9][0-9\s\u00a0]{3,})\s*(?:₽|руб)/i,
      /([0-9][0-9\s\u00a0]{3,})\s*(?:₽|руб)[^\n]{0,35}(?:мес|месяц)/i,
    ]);
    if (representative || areaLabel) warnings.push('area_from_visible_text');
    if (representative || rentLabel) warnings.push('rent_from_visible_text');
    if (multipleUnits) warnings.push('multiple_units_detected');
    if (representative) warnings.push('representative_unit_selected');
    if (selectedUnits.length) warnings.push('selection_unit_selected');
    if (representative?.ratePeriod === 'year') warnings.push('price_per_square_meter_annual_converted');
    if (multipleUnits && !representative) warnings.push('semantic_linked_pair_missing', 'semantic_offer_association_failed');

    const floorValue = floorNumberFromText(text);
    const totalFloorsMatch = text.match(/(?:Этаж|Этаж помещения)\s*[:—-]?\s*(?:-?\d{1,3}|1\s*[-–—]?\s*(?:й|ый)|перв(?:ый|ом))\s*(?:из|\/)\s*(\d{1,3})/iu);
    const ceilingLabel = firstMatch(text, [/(?:Высота потолк(?:а|ов))\s*[:—-]?\s*([0-9]+(?:[.,][0-9]+)?)\s*м/i]);
    const windowsLabel = firstMatch(text, [/(?:Количество окон|Окон)\s*[:—-]?\s*([0-9]+)/i, /([0-9]+)\s+окон(?:а|о)?\b/i]);
    const titleType = detectPremiseType([title]);
    const descriptionType = titleType.premiseType || titleType.ambiguous ? { premiseType: null, ambiguous: false } : detectPremiseType([description]);
    const premiseType = titleType.premiseType || descriptionType.premiseType;
    const premiseTypeAmbiguous = titleType.ambiguous || descriptionType.ambiguous;
    if (premiseTypeAmbiguous) warnings.push('ambiguous_premise_type');

    const candidate: Partial<NormalizedListing> = {
      title: title || null,
      address,
      area: multipleUnits ? representative?.area ?? null : parseNumber(areaLabel),
      rentMonthly: multipleUnits ? representative?.rentMonthly ?? null : parseMoney(rentLabel),
      pricePerSquareMeter: multipleUnits ? representative?.pricePerSquareMeter ?? null : null,
      floor: multipleUnits ? representative?.floor ?? null : floorValue,
      premiseType: premiseTypeAmbiguous ? null : premiseType,
      hasBasementOrSocle: hasBasementOrSocle(text),
      totalFloors: multipleUnits ? representative?.totalFloors ?? null : parseNumber(totalFloorsMatch?.[1]),
      ceilingHeight: parseNumber(ceilingLabel),
      windowsCount: parseNumber(windowsLabel),
      description: description || null,
    };
    return {
      candidate,
      warnings,
      authoritativeFields: multipleUnits ? ['area', 'rentMonthly', 'pricePerSquareMeter', 'floor', 'totalFloors'] : undefined,
    };
  }
}
