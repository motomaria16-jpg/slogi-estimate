(function searchSpaceCardModalModule(window, document) {
  'use strict';

  const ROOT_ID = 'slogi-search-space-card-dialog';
  const EVENTS = Object.freeze({
    open: 'slogi-space-card:open',
    resolve: 'slogi-space-card:resolve-address',
    save: 'slogi-space-card:save',
    takeToWork: 'slogi-space-card:take-to-work',
    delete: 'slogi-space-card:delete'
  });

  const state = {
    dialog: null,
    form: null,
    draft: null,
    evaluation: null,
    callbacks: {},
    context: '',
    activeTab: 'object',
    workflowView: null,
    proposalView: null,
    embeddedDrafts: { workflow: null, proposal: null },
    embeddedDraftsReady: false,
    opener: null,
    busy: '',
    resolution: 'idle',
    resolutionMessage: ''
  };

  function own(value, key) {
    return Boolean(value) && Object.prototype.hasOwnProperty.call(value, key);
  }

  function text(value) {
    return value == null ? '' : String(value).trim();
  }

  function numberOrNull(value) {
    if (value == null || value === '') return null;
    const parsed = Number(String(value).replace(/\s/g, '').replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : null;
  }

  function safeHttpUrl(value) {
    const raw = text(value);
    if (!raw) return '';
    try {
      const url = new URL(raw);
      return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : '';
    } catch (_error) {
      return '';
    }
  }

  function boolOrNull(value) {
    if (value === true || value === 'true' || value === 'yes' || value === '1' || value === 1) return true;
    if (value === false || value === 'false' || value === 'no' || value === '0' || value === 0) return false;
    return null;
  }

  function nested(value, key, fallback) {
    return own(value, key) ? value[key] : fallback;
  }

  function normalizeFallback(input) {
    const raw = input && typeof input === 'object' ? input : {};
    const rawCluster = raw.cluster && typeof raw.cluster === 'object' ? raw.cluster : {};
    const rawCompetitive = raw.competitive && typeof raw.competitive === 'object' ? raw.competitive : {};
    const rawRent = raw.rent && typeof raw.rent === 'object' ? raw.rent : {};
    const rawWork = raw.work && typeof raw.work === 'object' ? raw.work : {};
    const clusterId = text(nested(rawCluster, 'id', raw.clusterId));
    const clusterName = text(nested(rawCluster, 'name', raw.clusterName));
    const matchedValue = nested(rawCluster, 'matched', raw.clusterMatched);
    const explicitMatched = boolOrNull(matchedValue);
    const rawClusterStatus = text(nested(rawCluster, 'status', raw.clusterStatus)).toLowerCase();
    const clusterStatus = ['inside', 'outside', 'address', 'not_computed'].includes(rawClusterStatus)
      ? rawClusterStatus
      : explicitMatched === true ? 'inside' : explicitMatched === false ? 'outside' : (clusterId || clusterName ? 'inside' : 'not_computed');
    const matched = explicitMatched != null
      ? explicitMatched
      : ['inside', 'address'].includes(clusterStatus) ? true : clusterStatus === 'outside' ? false : null;
    const rank = numberOrNull(nested(rawCompetitive, 'rank', raw.clusterRank));
    const explicitTop35 = boolOrNull(nested(rawCompetitive, 'isTop35', raw.isTop35));
    const sourceValue = text(raw.source).toLowerCase();
    const latitude = numberOrNull(nested(raw.geo, 'lat', nested(raw.geo, 'latitude', raw.latitude)));
    const longitude = numberOrNull(nested(raw.geo, 'lng', nested(raw.geo, 'longitude', raw.longitude)));
    const calculatedPricePerSqm = raw.area > 0 && nested(raw, 'rentMonthly', rawRent.amount) > 0
      ? numberOrNull(nested(raw, 'rentMonthly', rawRent.amount)) / numberOrNull(raw.area)
      : null;
    const pricePerSqmOverride = numberOrNull(nested(raw, 'pricePerSqmOverride', raw.price_per_sqm_override));
    const area = numberOrNull(raw.area);
    const rawAreaConfirmed = boolOrNull(nested(raw, 'areaConfirmed', nested(raw, 'area_confirmed', raw.technical && raw.technical.areaConfirmed)));
    let areaConfirmedSource = text(nested(raw, 'areaConfirmedSource', nested(raw, 'area_confirmed_source', raw.technical && raw.technical.areaConfirmedSource))).toLowerCase();
    if (!['manual', 'automatic'].includes(areaConfirmedSource)) areaConfirmedSource = rawAreaConfirmed == null ? (area == null ? null : 'automatic') : 'manual';
    const areaConfirmed = areaConfirmedSource === 'automatic' || rawAreaConfirmed == null
      ? area == null ? null : area >= 90 && area <= 150
      : rawAreaConfirmed;

    return {
      id: text(raw.id),
      source: sourceValue === 'parsed' || sourceValue === 'cian' ? 'parsed' : 'manual',
      sourceProvider: text(nested(raw, 'sourceProvider', raw.source_provider)),
      listingUrl: safeHttpUrl(nested(raw, 'listingUrl', nested(raw, 'listing_url', nested(raw, 'canonicalUrl', raw.canonical_url)))),
      address: text(raw.address),
      geo: {
        lat: latitude,
        lng: longitude,
        resolutionSource: ['manual', 'automatic'].includes(text(nested(raw.geo, 'resolutionSource', raw.geoResolutionSource)).toLowerCase())
          ? text(nested(raw.geo, 'resolutionSource', raw.geoResolutionSource)).toLowerCase()
          : null
      },
      cluster: {
        id: clusterId,
        name: clusterName,
        status: clusterStatus,
        matched,
        resolutionSource: ['manual', 'automatic'].includes(text(nested(rawCluster, 'resolutionSource', raw.clusterResolutionSource)).toLowerCase())
          ? text(nested(rawCluster, 'resolutionSource', raw.clusterResolutionSource)).toLowerCase()
          : null,
        hasSlogiCenter: boolOrNull(nested(rawCluster, 'hasSlogiCenter', raw.hasSlogiCenter)),
        centerDetails: text(nested(rawCluster, 'centerDetails', nested(rawCluster, 'center_details', raw.centerDetails)))
      },
      competitive: {
        rating: numberOrNull(nested(rawCompetitive, 'rating', raw.clusterRating)),
        rank,
        isTop30: rank == null ? null : rank >= 1 && rank <= 30,
        isTop35: explicitTop35 == null && rank != null ? rank >= 1 && rank <= 35 : explicitTop35,
        resolutionSource: ['manual', 'automatic'].includes(text(nested(rawCompetitive, 'resolutionSource', raw.competitiveResolutionSource)).toLowerCase())
          ? text(nested(rawCompetitive, 'resolutionSource', raw.competitiveResolutionSource)).toLowerCase()
          : null,
        averageRentPerSqm: numberOrNull(nested(rawCompetitive, 'averageRentPerSqm', raw.averageRentPerSqm)),
        comparisonPercentOverride: numberOrNull(nested(rawCompetitive, 'comparisonPercentOverride', raw.comparisonPercentOverride))
      },
      rentMonthly: numberOrNull(nested(raw, 'rentMonthly', rawRent.amount)),
      area,
      areaConfirmed,
      areaConfirmedSource,
      calculatedPricePerSqm,
      pricePerSqmOverride,
      pricePerSqm: pricePerSqmOverride == null ? calculatedPricePerSqm : pricePerSqmOverride,
      separateEntrance: boolOrNull(raw.separateEntrance),
      hasWindows: boolOrNull(raw.hasWindows),
      windowsOpen: boolOrNull(raw.windowsOpen),
      ceilingHeight: numberOrNull(raw.ceilingHeight),
      ceilingHeightConfirmed: boolOrNull(raw.ceilingHeightConfirmed),
      repair: ['none', 'rough', 'finished'].includes(raw.repair) ? raw.repair : null,
      work: Object.assign({}, rawWork)
    };
  }

  function normalize(input) {
    const model = window.SlogiSearchSpaceCard;
    if (model && typeof model.normalize === 'function') {
      try {
        const normalized = normalizeFallback(model.normalize(input));
        const original = normalizeFallback(input);
        normalized.listingUrl = original.listingUrl || normalized.listingUrl;
        normalized.geo = Object.assign({}, normalized.geo || {}, original.geo || {});
        normalized.areaConfirmed = original.areaConfirmed;
        normalized.areaConfirmedSource = original.areaConfirmedSource || normalized.areaConfirmedSource;
        normalized.calculatedPricePerSqm = original.calculatedPricePerSqm;
        normalized.pricePerSqmOverride = original.pricePerSqmOverride;
        normalized.pricePerSqm = original.pricePerSqm;
        normalized.separateEntrance = original.separateEntrance;
        normalized.hasWindows = original.hasWindows;
        normalized.windowsOpen = original.windowsOpen;
        normalized.ceilingHeightConfirmed = original.ceilingHeightConfirmed;
        normalized.repair = original.repair;
        normalized.sourceProvider = original.sourceProvider || normalized.sourceProvider;
        normalized.work = Object.assign({}, normalized.work || {}, original.work || {});
        if (original.cluster.matched != null) {
          normalized.cluster.matched = original.cluster.matched;
          normalized.cluster.status = original.cluster.status;
        }
        normalized.cluster.centerDetails = original.cluster.centerDetails || normalized.cluster.centerDetails;
        if (original.competitive.isTop35 != null) normalized.competitive.isTop35 = original.competitive.isTop35;
        normalized.competitive.comparisonPercentOverride = original.competitive.comparisonPercentOverride;
        return normalized;
      } catch (_error) {
        return normalizeFallback(input);
      }
    }
    return normalizeFallback(input);
  }

  function computedFallback(card) {
    const calculatedRentPerSqm = card.area > 0 && card.rentMonthly != null ? card.rentMonthly / card.area : null;
    const rentPerSqm = card.pricePerSqmOverride > 0 ? card.pricePerSqmOverride : calculatedRentPerSqm;
    const averageRentPerSqm = card.competitive.averageRentPerSqm;
    const calculatedDeviationPercent = rentPerSqm != null && averageRentPerSqm > 0
      ? ((rentPerSqm - averageRentPerSqm) / averageRentPerSqm) * 100
      : null;
    const deviationPercent = card.competitive.comparisonPercentOverride == null
      ? calculatedDeviationPercent
      : card.competitive.comparisonPercentOverride;
    return { rentPerSqm, calculatedRentPerSqm, averageRentPerSqm, deviationPercent, calculatedDeviationPercent };
  }

  function evaluateFallback(card) {
    const missing = [];
    const reasons = [];
    if (!card.address) missing.push('Укажите адрес помещения.');
    if (card.cluster.matched !== true) reasons.push(card.cluster.matched === false
      ? 'Помещение не попало ни в один кластер.'
      : 'Кластер по адресу ещё не определён.');
    if (card.cluster.hasSlogiCenter == null) reasons.push('Не определено, есть ли в кластере центр Слоги.');
    else if (card.cluster.hasSlogiCenter) reasons.push('В кластере уже есть открытый центр Слоги.');
    if (card.competitive.isTop35 == null) reasons.push('Нет результата проверки по конкурентному анализу.');
    else if (!card.competitive.isTop35) reasons.push('Кластер помещения находится ниже ТОП-35.');
    if (!(card.rentMonthly > 0)) missing.push('Укажите стоимость аренды.');
    if (!(card.area > 0)) missing.push('Укажите площадь помещения.');
    if (card.areaConfirmed !== true) missing.push('Укажите «Да» для соответствия площади диапазону 90–150 м².');
    if (card.separateEntrance == null) missing.push('Укажите наличие отдельного входа.');
    if (card.hasWindows == null) missing.push('Укажите наличие окон.');
    if (card.hasWindows === true && card.windowsOpen == null) missing.push('Укажите, открываются ли окна.');
    if (!(card.ceilingHeight > 0)) missing.push('Укажите высоту потолков.');
    if (card.ceilingHeightConfirmed !== true) missing.push('Подтвердите норматив высоты потолков.');
    if (!card.repair) missing.push('Укажите состояние ремонта.');
    if (!(card.competitive.averageRentPerSqm > 0)) missing.push('В конкурентном анализе нет средней стоимости аренды по кластеру.');
    const checks = {
      clusterInside: card.cluster.status === 'inside' && card.cluster.matched === true,
      clusterFree: card.cluster.hasSlogiCenter === false,
      clusterTop35: card.competitive.isTop35 === true,
      requiredComplete: missing.length === 0
    };
    const allReasons = reasons.concat(missing);
    return {
      canTakeToWork: allReasons.length === 0,
      reasons: allReasons,
      missing,
      checks,
      computed: computedFallback(card)
    };
  }

  function firstArray() {
    for (let index = 0; index < arguments.length; index += 1) {
      if (Array.isArray(arguments[index])) return arguments[index].map(text).filter(Boolean);
    }
    return [];
  }

  const REASON_LABELS = Object.freeze({
    cluster_outside: 'Помещение не попало ни в один кластер.',
    cluster_not_confirmed: 'Кластер по адресу ещё не определён.',
    cluster_occupied: 'В кластере уже есть открытый центр Слоги.',
    cluster_occupancy_unknown: 'Не определено, есть ли в кластере центр Слоги.',
    cluster_rank_unknown: 'Нет результата проверки по конкурентному анализу.',
    cluster_not_top30: 'Кластер помещения находится ниже ТОП-35.',
    cluster_not_top35: 'Кластер помещения находится ниже ТОП-35.',
    already_in_work: 'Помещение уже находится в работе.',
    required_fields_incomplete: 'Не все обязательные параметры заполнены.'
  });

  const FIELD_LABELS = Object.freeze({
    address: 'Укажите адрес помещения.',
    rentMonthly: 'Укажите стоимость аренды.',
    area: 'Укажите площадь помещения.',
    areaConfirmed: 'Укажите соответствие площади диапазону 90–150 м².',
    pricePerSqm: 'Укажите площадь и аренду для расчёта цены за 1 м².',
    separateEntrance: 'Укажите наличие отдельного входа.',
    hasWindows: 'Укажите наличие окон.',
    windowsOpen: 'Укажите, открываются ли окна.',
    ceilingHeight: 'Укажите высоту потолков.',
    ceilingHeightConfirmed: 'Подтвердите норматив высоты потолков.',
    repair: 'Укажите состояние ремонта.',
    competitiveAverage: 'В конкурентном анализе нет средней стоимости аренды по кластеру.'
  });

  function messageFor(value, labels) {
    const normalized = text(value);
    return labels[normalized] || normalized.replace(/_/g, ' ');
  }

  function evaluate(card) {
    const fallback = evaluateFallback(card);
    const model = window.SlogiSearchSpaceCard;
    if (!model || typeof model.evaluate !== 'function') return fallback;
    try {
      const raw = model.evaluate(card) || {};
      const gate = raw.eligibility && typeof raw.eligibility === 'object' ? raw.eligibility : raw;
      const reasonCodes = firstArray(gate.reasons, gate.blockingReasons, raw.reasons, raw.blockingReasons);
      const missingCodes = firstArray(gate.missing, raw.missing, gate.missingFields, raw.missingFields);
      const missing = missingCodes.map((value) => messageFor(value, FIELD_LABELS));
      const reasons = reasonCodes
        .filter((value) => !(value === 'required_fields_incomplete' && missing.length))
        .map((value) => messageFor(value, REASON_LABELS));
      const computed = Object.assign({}, fallback.computed, raw.computed || {}, gate.computed || {});
      const explicit = own(gate, 'canTakeToWork') ? gate.canTakeToWork
        : own(gate, 'eligible') ? gate.eligible
          : own(gate, 'ready') ? gate.ready : null;
      const combined = Array.from(new Set(reasons.concat(missing)));
      return {
        canTakeToWork: explicit == null ? combined.length === 0 && fallback.canTakeToWork : Boolean(explicit),
        reasons: combined.length || explicit != null ? combined : fallback.reasons,
        missing: missing.length || explicit != null ? missing : fallback.missing,
        checks: Object.assign({}, fallback.checks, raw.checks || {}, gate.checks || {}),
        computed
      };
    } catch (_error) {
      return fallback;
    }
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function choice(name, value, label) {
    return `<label class="ss-card-choice"><input type="radio" name="${name}" value="${value}"><span>${label}</span></label>`;
  }

  function template() {
    return `<dialog class="ss-card-dialog" id="${ROOT_ID}" aria-labelledby="ss-card-title" aria-describedby="ss-card-subtitle">
      <form class="ss-card-form" method="dialog" novalidate>
        <header class="ss-card-header">
          <div class="ss-card-header-copy">
            <h2 id="ss-card-title">Карточка помещения</h2>
            <div class="ss-card-header-meta">
              <span class="ss-card-header-address" data-header-address>Адрес не указан</span>
              <span class="ss-card-header-badge" data-source-badge></span>
              <span class="ss-card-header-badge ss-card-header-badge-status" data-header-status hidden></span>
            </div>
          </div>
          <p class="ss-card-visually-hidden" id="ss-card-subtitle">Единая карточка помещения: объект, сопровождение и коммерческое предложение</p>
          <a class="ss-card-header-link" data-listing-field-link target="_blank" rel="noopener noreferrer" hidden>Открыть объявление</a>
          <button class="ss-card-close" type="button" data-action="close" aria-label="Закрыть карточку">×</button>
        </header>

        <nav class="ss-card-tabs" role="tablist" aria-label="Разделы карточки помещения">
          <button type="button" role="tab" id="ss-card-tab-object" aria-controls="ss-card-panel-object" aria-selected="true" tabindex="0" data-card-tab="object">Объект</button>
          <button type="button" role="tab" id="ss-card-tab-workflow" aria-controls="ss-card-panel-workflow" aria-selected="false" aria-disabled="true" tabindex="-1" data-card-tab="workflow">Сопровождение</button>
          <button type="button" role="tab" id="ss-card-tab-proposal" aria-controls="ss-card-panel-proposal" aria-selected="false" aria-disabled="true" tabindex="-1" data-card-tab="proposal">КП</button>
        </nav>

        <div class="ss-card-body">
          <div class="ss-card-alert" data-alert role="alert" hidden></div>
          <div class="ss-card-layout">
            <div class="ss-card-main">
              <section class="ss-card-tab-panel" id="ss-card-panel-object" role="tabpanel" aria-labelledby="ss-card-tab-object" data-card-panel="object">
                <section class="ss-card-identity" aria-label="Адрес, объявление и координаты">
                  <label class="ss-card-inline-field ss-card-address" data-tone-field="address"><span>Адрес</span><input name="address" type="text" autocomplete="street-address" placeholder="Город, улица, дом" required></label>
                  <button class="ss-card-button ss-card-button-secondary ss-card-compact-action" type="button" data-action="resolve-address">Определить</button>
                  <label class="ss-card-inline-field ss-card-listing" data-tone-field="listing-url"><span>Объявление</span><input name="listingUrl" type="url" inputmode="url" autocomplete="url" placeholder="https://…"></label>
                  <div class="ss-card-inline-field ss-card-coordinates" data-manual-coordinates>
                    <span>Координаты <small class="ss-card-origin" data-origin="coordinates"></small></span>
                    <div class="ss-card-coordinate-inputs">
                      <label class="ss-card-visually-hidden" for="ss-card-latitude">Широта</label><input id="ss-card-latitude" name="latitudeManual" type="number" min="-90" max="90" step="0.000001" inputmode="decimal" placeholder="55.7558" aria-label="Широта">
                      <label class="ss-card-visually-hidden" for="ss-card-longitude">Долгота</label><input id="ss-card-longitude" name="longitudeManual" type="number" min="-180" max="180" step="0.000001" inputmode="decimal" placeholder="37.6176" aria-label="Долгота">
                    </div>
                  </div>
                </section>

                <div class="ss-card-columns">
                  <section class="ss-card-section" aria-labelledby="ss-card-cluster-title">
                    <div class="ss-card-section-heading"><span aria-hidden="true">▥</span><h3 id="ss-card-cluster-title">Кластер и рейтинг</h3></div>
                    <div class="ss-card-section-content">
                      <label class="ss-card-row" data-manual-cluster data-tone-field="cluster-name"><span>Название кластера <small class="ss-card-origin" data-origin="cluster"></small></span><input name="clusterNameManual" type="text" placeholder="Название"></label>
                      <fieldset class="ss-card-row ss-card-option" data-manual-cluster data-tone-field="cluster-status"><legend>Входит в кластер</legend><div>${choice('clusterStatusManual', 'inside', 'Да')}${choice('clusterStatusManual', 'outside', 'Нет')}</div></fieldset>
                      <fieldset class="ss-card-row ss-card-option ss-card-center-choice" data-manual-cluster data-tone-field="cluster-center"><legend>Объект СЛОГИ</legend><div>${choice('hasSlogiCenterManual', 'true', 'Да')}${choice('hasSlogiCenterManual', 'false', 'Нет')}</div></fieldset>
                      <label class="ss-card-row" data-center-details data-manual-cluster><span>Сведения об объекте</span><input name="centerDetailsManual" type="text" placeholder="Адрес или комментарий"></label>
                      <label class="ss-card-row" data-manual-competitive data-tone-field="cluster-rank"><span>Место в ТОП-35 <small class="ss-card-origin" data-origin="competitive"></small></span><input class="ss-card-short" name="clusterRankManual" type="number" min="1" step="1" inputmode="numeric" placeholder="1–35"></label>
                      <label class="ss-card-row" data-manual-competitive><span>Рейтинг кластера</span><input class="ss-card-short" name="clusterRatingManual" type="number" step="0.01" inputmode="decimal" placeholder="—"></label>
                    </div>
                  </section>

                  <section class="ss-card-section" aria-labelledby="ss-card-economy-title">
                    <div class="ss-card-section-heading"><span aria-hidden="true">≋</span><h3 id="ss-card-economy-title">Экономика</h3></div>
                    <div class="ss-card-section-content">
                      <label class="ss-card-row" data-tone-field="rent"><span>Аренда</span><input name="rentMonthly" type="number" min="0" step="1" inputmode="decimal" placeholder="₽/мес."></label>
                      <div class="ss-card-row" data-tone-field="area">
                        <span>Площадь</span>
                        <div class="ss-card-value-combo">
                          <label class="ss-card-visually-hidden" for="ss-card-area">Площадь, м²</label><input id="ss-card-area" class="ss-card-short" name="area" type="number" min="0" step="0.01" inputmode="decimal" placeholder="м²">
                          <fieldset class="ss-card-option ss-card-compact-choice" data-manual-area-confirmation><legend class="ss-card-visually-hidden">Площадь соответствует диапазону 90–150 м²</legend>${choice('areaConfirmed', 'true', 'Да')}${choice('areaConfirmed', 'false', 'Нет')}</fieldset>
                        </div>
                      </div>
                      <label class="ss-card-row" data-manual-price data-tone-field="price"><span>Цена за 1 м²</span><input name="pricePerSqm" type="number" min="0" step="1" inputmode="decimal" placeholder="₽"></label>
                      <label class="ss-card-row" data-manual-competitive data-tone-field="average"><span>Средняя в кластере</span><input name="averageRentManual" type="number" min="0" step="1" inputmode="decimal" placeholder="₽"></label>
                      <label class="ss-card-row" data-manual-comparison data-tone-field="comparison"><span>Отклонение</span><input name="comparisonPercent" type="text" inputmode="decimal" pattern="-?[0-9]+(?:\\.[0-9]+)?" placeholder="%"></label>
                    </div>
                  </section>

                  <section class="ss-card-section" aria-labelledby="ss-card-technical-title">
                    <div class="ss-card-section-heading"><span aria-hidden="true">⚙</span><h3 id="ss-card-technical-title">Технические условия</h3></div>
                    <div class="ss-card-section-content">
                      <fieldset class="ss-card-row ss-card-option"><legend>Входная группа</legend><div>${choice('separateEntrance', 'true', 'Да')}${choice('separateEntrance', 'false', 'Нет')}</div></fieldset>
                      <fieldset class="ss-card-row ss-card-option"><legend>Окна</legend><div>${choice('hasWindows', 'true', 'Да')}${choice('hasWindows', 'false', 'Нет')}</div></fieldset>
                      <fieldset class="ss-card-row ss-card-option" data-windows-open><legend>Открываются</legend><div>${choice('windowsOpen', 'true', 'Да')}${choice('windowsOpen', 'false', 'Нет')}</div></fieldset>
                      <div class="ss-card-row" data-tone-field="ceiling">
                        <span>Потолки</span>
                        <div class="ss-card-value-combo">
                          <label class="ss-card-visually-hidden" for="ss-card-ceiling">Высота потолков, м</label><input id="ss-card-ceiling" class="ss-card-short" name="ceilingHeight" type="number" min="0" step="0.01" inputmode="decimal" placeholder="м">
                          <fieldset class="ss-card-option ss-card-compact-choice"><legend class="ss-card-visually-hidden">Высота соответствует нормативу</legend>${choice('ceilingHeightConfirmed', 'true', 'Да')}${choice('ceilingHeightConfirmed', 'false', 'Нет')}</fieldset>
                        </div>
                      </div>
                      <label class="ss-card-row ss-card-repair"><span>Ремонт</span><select name="repair"><option value="">Не указано</option><option value="none">Бетон</option><option value="rough">Черновой</option><option value="finished">Чистовой</option></select></label>
                    </div>
                  </section>
                </div>
              </section>

              <section class="ss-card-tab-panel" id="ss-card-panel-workflow" role="tabpanel" aria-labelledby="ss-card-tab-workflow" data-card-panel="workflow" data-workflow-section hidden>
                <div class="ss-card-workflow-content" data-workflow-content></div>
              </section>

              <section class="ss-card-tab-panel" id="ss-card-panel-proposal" role="tabpanel" aria-labelledby="ss-card-tab-proposal" data-card-panel="proposal" data-proposal-section hidden>
                <div class="ss-card-proposal-content" data-proposal-content></div>
              </section>
            </div>

            <aside class="ss-card-context" aria-live="polite" aria-label="Состояние карточки">
              <div data-context-content></div>
            </aside>
          </div>
        </div>

        <footer class="ss-card-footer">
          <button class="ss-card-delete" type="button" data-action="delete" hidden>Удалить помещение</button>
          <div class="ss-card-footer-main">
            <button class="ss-card-button ss-card-button-primary" type="button" data-action="start-proposal" data-workflow-footer-action hidden>Сформировать КП</button>
            <button class="ss-card-button ss-card-button-ghost" type="button" data-action="close">Отмена</button>
            <button class="ss-card-button ss-card-button-secondary" type="button" data-action="save">Сохранить</button>
          </div>
        </footer>
      </form>
    </dialog>`;
  }

  function emit(type, detail) {
    if (!state.dialog || typeof window.CustomEvent !== 'function') return;
    state.dialog.dispatchEvent(new window.CustomEvent(type, { bubbles: true, detail }));
  }

  function ensureDialog() {
    if (state.dialog && document.contains(state.dialog)) return state.dialog;
    const host = document.createElement('div');
    host.innerHTML = template().trim();
    state.dialog = host.firstElementChild;
    document.body.appendChild(state.dialog);
    state.form = state.dialog.querySelector('form');
    bindEvents();
    return state.dialog;
  }

  function input(name) {
    return state.form && state.form.elements.namedItem(name);
  }

  function setControl(name, value) {
    const control = input(name);
    if (!control) return;
    if (typeof control.length === 'number' && !control.tagName) {
      const radioValue = value === 'yes' || value === true
        ? 'true'
        : value === 'no' || value === false
          ? 'false'
          : value == null || value === 'unknown'
            ? ''
            : String(value);
      Array.from(control).forEach((item) => { item.checked = radioValue === item.value; });
      return;
    }
    control.value = value == null ? '' : String(value);
  }

  function readRadio(name) {
    const selected = state.form.querySelector(`input[name="${name}"]:checked`);
    return selected ? selected.value : null;
  }

  function collectDraft(manualGroups) {
    const current = state.draft || normalizeFallback({});
    const groups = manualGroups || {};
    const manualClusterName = text(input('clusterNameManual') && input('clusterNameManual').value);
    const manualClusterStatus = readRadio('clusterStatusManual');
    const manualCenter = boolOrNull(readRadio('hasSlogiCenterManual'));
    const manualCenterDetails = text(input('centerDetailsManual') && input('centerDetailsManual').value);
    const manualRank = numberOrNull(input('clusterRankManual') && input('clusterRankManual').value);
    const manualRating = numberOrNull(input('clusterRatingManual') && input('clusterRatingManual').value);
    const manualAverage = numberOrNull(input('averageRentManual') && input('averageRentManual').value);
    const latitude = numberOrNull(input('latitudeManual') && input('latitudeManual').value);
    const longitude = numberOrNull(input('longitudeManual') && input('longitudeManual').value);
    const pricePerSqmValue = numberOrNull(input('pricePerSqm') && input('pricePerSqm').value);
    const pricePerSqmOverride = groups.price
      ? pricePerSqmValue
      : current.pricePerSqmOverride;
    const comparisonPercentValue = numberOrNull(input('comparisonPercent') && input('comparisonPercent').value);
    const comparisonPercentOverride = groups.comparison
      ? comparisonPercentValue
      : current.competitive.comparisonPercentOverride;
    const area = numberOrNull(input('area') && input('area').value);
    const selectedAreaConfirmed = boolOrNull(readRadio('areaConfirmed'));
    const areaConfirmedSource = groups.areaConfirmation
      ? 'manual'
      : current.areaConfirmedSource === 'manual'
        ? 'manual'
        : area == null ? null : 'automatic';
    const areaConfirmed = areaConfirmedSource === 'manual'
      ? selectedAreaConfirmed
      : area == null ? null : area >= 90 && area <= 150;
    const cluster = Object.assign({}, current.cluster, {
      id: groups.cluster && manualClusterName !== current.cluster.name ? '' : current.cluster.id,
      name: manualClusterName,
      status: manualClusterStatus || current.cluster.status,
      matched: manualClusterStatus === 'inside' ? true : manualClusterStatus === 'outside' ? false : current.cluster.matched,
      resolutionSource: groups.cluster ? 'manual' : current.cluster.resolutionSource,
      hasSlogiCenter: manualCenter,
      centerDetails: manualCenterDetails
    });
    const competitive = Object.assign({}, current.competitive, {
      rating: manualRating,
      rank: manualRank == null ? null : Math.trunc(manualRank),
      isTop30: manualRank == null ? null : manualRank >= 1 && manualRank <= 30,
      isTop35: manualRank == null ? null : manualRank >= 1 && manualRank <= 35,
      resolutionSource: groups.competitive ? 'manual' : current.competitive.resolutionSource,
      averageRentPerSqm: manualAverage,
      comparisonPercentOverride
    });
    return normalizeFallback(Object.assign({}, current, {
      listingUrl: text(input('listingUrl') && input('listingUrl').value),
      address: text(input('address') && input('address').value),
      geo: {
        lat: latitude,
        lng: longitude,
        resolutionSource: groups.coordinates ? 'manual' : current.geo && current.geo.resolutionSource
      },
      cluster,
      competitive,
      rentMonthly: numberOrNull(input('rentMonthly') && input('rentMonthly').value),
      area,
      areaConfirmed,
      areaConfirmedSource,
      pricePerSqmOverride,
      separateEntrance: boolOrNull(readRadio('separateEntrance')),
      hasWindows: boolOrNull(readRadio('hasWindows')),
      windowsOpen: readRadio('hasWindows') === 'true' ? boolOrNull(readRadio('windowsOpen')) : null,
      ceilingHeight: numberOrNull(input('ceilingHeight') && input('ceilingHeight').value),
      ceilingHeightConfirmed: boolOrNull(readRadio('ceilingHeightConfirmed')),
      repair: input('repair') && input('repair').value
    }));
  }

  function fillForm(card) {
    setControl('listingUrl', card.listingUrl);
    setControl('address', card.address);
    setControl('latitudeManual', card.geo && card.geo.lat);
    setControl('longitudeManual', card.geo && card.geo.lng);
    setControl('clusterNameManual', card.cluster.name);
    setControl('clusterStatusManual', card.cluster.status === 'inside' || card.cluster.status === 'outside' ? card.cluster.status : null);
    setControl('hasSlogiCenterManual', card.cluster.hasSlogiCenter);
    setControl('centerDetailsManual', card.cluster.centerDetails);
    setControl('clusterRankManual', card.competitive.rank);
    setControl('clusterRatingManual', card.competitive.rating);
    setControl('averageRentManual', card.competitive.averageRentPerSqm);
    setControl('comparisonPercent', card.competitive.deltaPercent);
    setControl('rentMonthly', card.rentMonthly);
    setControl('area', card.area);
    setControl('areaConfirmed', card.areaConfirmed);
    setControl('pricePerSqm', card.pricePerSqm);
    setControl('separateEntrance', card.separateEntrance);
    setControl('hasWindows', card.hasWindows);
    setControl('windowsOpen', card.windowsOpen);
    setControl('ceilingHeight', card.ceilingHeight);
    setControl('ceilingHeightConfirmed', card.ceilingHeightConfirmed);
    setControl('repair', card.repair);
  }

  function mergeCard(base, update) {
    const next = update && typeof update === 'object' ? update : {};
    return Object.assign({}, base, next, {
      geo: Object.assign({}, base.geo || {}, next.geo || {}),
      cluster: Object.assign({}, base.cluster || {}, next.cluster || {}),
      competitive: Object.assign({}, base.competitive || {}, next.competitive || {})
    });
  }

  function setToneField(name, tone) {
    const node = state.dialog.querySelector(`[data-tone-field="${name}"]`);
    if (node) node.dataset.tone = tone || 'neutral';
  }

  function setComputedControl(name, value) {
    const control = input(name);
    if (control && document.activeElement === control) return;
    setControl(name, value);
  }

  function renderEconomy(evaluation) {
    const computed = evaluation.computed || {};
    const rentPerSqm = numberOrNull(computed.rentPerSqm);
    const deviation = numberOrNull(computed.deviationPercent);
    setComputedControl('pricePerSqm', rentPerSqm);
    setComputedControl('comparisonPercent', deviation);
    const priceTone = deviation == null ? 'neutral' : deviation > 0 ? 'danger' : 'success';
    setToneField('rent', state.draft.rentMonthly > 0 ? 'success' : 'warning');
    setToneField('area', state.draft.areaConfirmed == null ? 'warning' : state.draft.areaConfirmed === true ? 'success' : 'danger');
    setToneField('price', priceTone);
    setToneField('average', state.draft.competitive.averageRentPerSqm > 0 ? 'success' : 'warning');
    setToneField('comparison', priceTone);
    setToneField('address', state.draft.address ? 'success' : 'warning');
    setToneField('listing-url', state.draft.listingUrl ? 'success' : 'neutral');
    setToneField('ceiling', state.draft.ceilingHeightConfirmed == null ? 'warning' : state.draft.ceilingHeightConfirmed ? 'success' : 'danger');
    setToneField('latitude', state.draft.geo && state.draft.geo.lat != null ? 'success' : 'warning');
    setToneField('longitude', state.draft.geo && state.draft.geo.lng != null ? 'success' : 'warning');
    setToneField('cluster-name', state.draft.cluster.name ? (state.draft.cluster.status === 'inside' ? 'success' : 'warning') : 'warning');
    setToneField('cluster-status', state.draft.cluster.status === 'inside' ? 'success' : state.draft.cluster.status === 'outside' ? 'danger' : 'warning');
    setToneField('cluster-center', state.draft.cluster.hasSlogiCenter == null ? 'warning' : state.draft.cluster.hasSlogiCenter ? 'danger' : 'success');
    setToneField('cluster-rank', state.draft.competitive.rank == null ? 'warning' : state.draft.competitive.isTop35 ? 'success' : 'danger');
  }

  function renderTakeAction() {
    const takeButton = state.dialog.querySelector('[data-action="take-to-work"]');
    if (!takeButton) return;
    takeButton.hidden = state.context === 'in-work';
    takeButton.disabled = Boolean(state.busy);
    takeButton.setAttribute('aria-disabled', String(takeButton.disabled));
  }

  function originLabel(value) {
    return value === 'manual' ? 'вручную' : value === 'automatic' ? 'авто' : '';
  }

  function setOrigin(name, value) {
    const node = state.dialog.querySelector(`[data-origin="${name}"]`);
    if (!node) return;
    node.textContent = originLabel(value);
    node.hidden = !node.textContent;
  }

  function workflowEnabled() {
    return (state.context === 'in-work' || state.context === 'proposal') && typeof state.callbacks.renderWorkflow === 'function';
  }

  function proposalEnabled() {
    return state.context === 'proposal' && typeof state.callbacks.renderProposal === 'function';
  }

  function renderWorkflowFooterAction() {
    const button = state.dialog && state.dialog.querySelector('[data-workflow-footer-action]');
    if (!button) return;
    const config = state.workflowView && state.workflowView.footerAction;
    const visible = state.activeTab === 'workflow' && workflowEnabled() && config && text(config.action);
    button.hidden = !visible;
    if (!visible) return;
    button.dataset.action = text(config.action);
    button.textContent = text(config.label) || 'Продолжить';
    button.disabled = Boolean(state.busy || config.disabled);
    button.setAttribute('aria-disabled', String(button.disabled));
  }

  function tabAvailable(name) {
    if (name === 'object') return true;
    if (name === 'workflow') return workflowEnabled();
    if (name === 'proposal') return proposalEnabled();
    return false;
  }

  function setActiveTab(name, focus) {
    const requested = text(name);
    state.activeTab = tabAvailable(requested) ? requested : 'object';
    state.dialog.querySelectorAll('[data-card-tab]').forEach((tab) => {
      const selected = tab.dataset.cardTab === state.activeTab;
      const available = tabAvailable(tab.dataset.cardTab);
      tab.setAttribute('aria-selected', String(selected));
      tab.setAttribute('aria-disabled', String(!available));
      tab.tabIndex = selected ? 0 : -1;
      if (selected && focus) tab.focus();
    });
    state.dialog.querySelectorAll('[data-card-panel]').forEach((panel) => {
      panel.hidden = panel.dataset.cardPanel !== state.activeTab;
    });
    renderHeaderStatus();
    renderContextPanel();
    renderWorkflowFooterAction();
  }

  function renderHeaderStatus() {
    const status = state.dialog && state.dialog.querySelector('[data-header-status]');
    if (!status) return;
    const workflowStatus = state.workflowView && text(state.workflowView.status);
    const proposalStatus = state.proposalView && text(state.proposalView.status);
    status.textContent = state.activeTab === 'workflow'
      ? workflowStatus
      : state.activeTab === 'proposal'
        ? proposalStatus
        : proposalStatus || workflowStatus || '';
    status.hidden = !status.textContent;
  }

  function renderHeader() {
    const address = state.dialog.querySelector('[data-header-address]');
    const source = state.dialog.querySelector('[data-source-badge]');
    address.textContent = state.draft.address || 'Адрес не указан';
    const provider = text(state.draft.sourceProvider).toLocaleUpperCase('ru-RU');
    source.textContent = state.draft.source === 'manual' ? 'Введено вручную' : `Получено из ${provider || 'источника'}`;
    renderHeaderStatus();
    setOrigin('coordinates', state.draft.geo && state.draft.geo.resolutionSource);
    setOrigin('cluster', state.draft.cluster && state.draft.cluster.resolutionSource);
    setOrigin('competitive', state.draft.competitive && state.draft.competitive.resolutionSource);
  }

  function checkItems() {
    const checks = state.evaluation && state.evaluation.checks || {};
    return [
      { label: 'Кластер определён', ready: Boolean(checks.clusterInside) },
      { label: 'Кластер свободен', ready: Boolean(checks.clusterFree) },
      { label: 'ТОП-35', ready: Boolean(checks.clusterTop35) },
      { label: 'Технические данные заполнены', ready: Boolean(checks.requiredComplete) }
    ];
  }

  function renderContextPanel() {
    const target = state.dialog.querySelector('[data-context-content]');
    const context = target.closest('.ss-card-context');
    const layout = target.closest('.ss-card-layout');
    if (state.activeTab === 'workflow' || state.activeTab === 'proposal') {
      const view = state.activeTab === 'proposal' ? state.proposalView : state.workflowView;
      const sidebar = view && text(view.sidebarHtml);
      context.hidden = !sidebar;
      layout.classList.toggle('ss-card-layout-full', !sidebar);
      target.innerHTML = sidebar || '';
      return;
    }
    context.hidden = false;
    layout.classList.remove('ss-card-layout-full');
    const items = checkItems();
    const reasons = state.evaluation && state.evaluation.reasons || [];
    const inWork = workflowEnabled();
    const inProposal = proposalEnabled();
    const action = inProposal ? 'go-proposal' : inWork ? 'go-workflow' : state.context === 'in-work' ? 'save' : 'take-to-work';
    const actionLabel = inProposal ? 'Перейти к КП' : inWork ? 'Перейти к сопровождению' : state.context === 'in-work' ? 'Добавить помещение в работу' : 'Добавить в «Помещение в работе»';
    target.innerHTML = `<section class="ss-card-context-section"><div class="ss-card-context-heading"><span aria-hidden="true">✓</span><h3>Готовность</h3></div><ul class="ss-card-check-list">${items.map((item) => `<li class="${item.ready ? 'ready' : 'pending'}"><span aria-hidden="true"></span>${escapeHtml(item.label)}</li>`).join('')}</ul>${reasons.length ? `<ul class="ss-card-context-reasons">${reasons.map((reason) => `<li>${escapeHtml(reason)}</li>`).join('')}</ul>` : ''}</section>
      <section class="ss-card-context-section ss-card-next"><div class="ss-card-context-heading"><span aria-hidden="true">⚑</span><h3>Следующий этап</h3></div><button class="ss-card-button ss-card-button-primary ss-card-next-button" type="button" data-action="${action}">${actionLabel} <span aria-hidden="true">→</span></button></section>`;
  }

  function renderWorkflow() {
    const content = state.dialog.querySelector('[data-workflow-content]');
    const enabled = workflowEnabled();
    if (!enabled) {
      content.innerHTML = '';
      state.workflowView = null;
      return;
    }
    const rendered = state.callbacks.renderWorkflow(state.draft) || {};
    state.workflowView = typeof rendered === 'string' ? { html: rendered } : rendered;
    content.innerHTML = typeof rendered === 'string' ? rendered : text(rendered.html);
    content.querySelectorAll('button[disabled]').forEach((button) => { button.dataset.businessDisabled = 'true'; });
    content.onclick = (event) => {
      const button = event.target.closest('[data-action]');
      if (!button) return;
      event.stopPropagation();
      runWorkflowAction(button);
    };
    content.onchange = (event) => {
      if (!event.target.matches('input[type="file"]')) return;
      event.stopPropagation();
      runWorkflowFile(event.target);
    };
  }

  function renderProposal() {
    const content = state.dialog.querySelector('[data-proposal-content]');
    const enabled = proposalEnabled();
    if (!enabled) {
      content.innerHTML = '';
      state.proposalView = null;
      return;
    }
    const rendered = state.callbacks.renderProposal(state.draft) || {};
    state.proposalView = typeof rendered === 'string' ? { html: rendered } : rendered;
    content.innerHTML = typeof rendered === 'string' ? rendered : text(rendered.html);
    content.querySelectorAll('button[disabled]').forEach((button) => { button.dataset.businessDisabled = 'true'; });
    content.onclick = (event) => {
      const button = event.target.closest('[data-action]');
      if (!button) return;
      event.stopPropagation();
      runWorkflowAction(button);
    };
    content.onchange = (event) => {
      if (!event.target.matches('input[type="file"]')) return;
      event.stopPropagation();
      runWorkflowFile(event.target);
    };
  }

  function captureWorkflowUi() {
    const selector = state.activeTab === 'proposal' ? '[data-proposal-content]' : '[data-workflow-content]';
    const content = state.dialog && state.dialog.querySelector(selector);
    const body = state.dialog && state.dialog.querySelector('.ss-card-body');
    if (!content) return null;
    const controls = Array.from(content.querySelectorAll('input:not([type="file"]), select, textarea'));
    const active = document.activeElement;
    return {
      scrollTop: body ? body.scrollTop : 0,
      controls: controls.map((control, index) => ({ index, name: control.name, type: control.type, value: control.value, checked: control.checked })),
      activeControl: controls.includes(active) ? controls.indexOf(active) : -1,
      activeAction: active && active.dataset ? text(active.dataset.action) : '',
      activeMediaId: active && active.dataset ? text(active.dataset.mediaId) : '',
      selectionStart: active && typeof active.selectionStart === 'number' ? active.selectionStart : null,
      selectionEnd: active && typeof active.selectionEnd === 'number' ? active.selectionEnd : null
    };
  }

  function captureEmbeddedDraft(name) {
    const content = state.dialog && state.dialog.querySelector(`[data-${name}-content]`);
    if (!content) return null;
    return Array.from(content.querySelectorAll('input:not([type="file"]), select, textarea')).map((control, index) => ({
      index,
      name: control.name,
      type: control.type,
      value: control.value,
      checked: control.checked
    }));
  }

  function restoreEmbeddedDraft(name, snapshot) {
    if (!snapshot) return;
    const content = state.dialog.querySelector(`[data-${name}-content]`);
    if (!content) return;
    const controls = Array.from(content.querySelectorAll('input:not([type="file"]), select, textarea'));
    snapshot.forEach((saved) => {
      const control = controls[saved.index];
      if (!control || control.name !== saved.name || control.type !== saved.type) return;
      if (control.type === 'radio' || control.type === 'checkbox') control.checked = saved.checked;
      else control.value = saved.value;
    });
  }

  function restoreWorkflowUi(snapshot) {
    if (!snapshot) return;
    const selector = state.activeTab === 'proposal' ? '[data-proposal-content]' : '[data-workflow-content]';
    const content = state.dialog.querySelector(selector);
    const body = state.dialog.querySelector('.ss-card-body');
    const controls = Array.from(content.querySelectorAll('input:not([type="file"]), select, textarea'));
    snapshot.controls.forEach((saved) => {
      const control = controls[saved.index];
      if (!control || control.name !== saved.name || control.type !== saved.type) return;
      if (control.type === 'radio' || control.type === 'checkbox') control.checked = saved.checked;
      else control.value = saved.value;
    });
    requestAnimationFrame(() => {
      if (body) body.scrollTop = snapshot.scrollTop;
      let focusTarget = snapshot.activeControl >= 0 ? controls[snapshot.activeControl] : null;
      if (!focusTarget && snapshot.activeAction) focusTarget = Array.from(content.querySelectorAll(`[data-action="${snapshot.activeAction}"]`)).find((node) => !snapshot.activeMediaId || text(node.dataset.mediaId) === snapshot.activeMediaId);
      if (!focusTarget || focusTarget.disabled) return;
      focusTarget.focus({ preventScroll: true });
      if (snapshot.selectionStart != null && typeof focusTarget.setSelectionRange === 'function') focusTarget.setSelectionRange(snapshot.selectionStart, snapshot.selectionEnd);
    });
  }

  function render() {
    if (!state.dialog || !state.draft) return;
    if (state.embeddedDraftsReady) {
      state.embeddedDrafts.workflow = captureEmbeddedDraft('workflow');
      state.embeddedDrafts.proposal = captureEmbeddedDraft('proposal');
    }
    state.evaluation = evaluate(state.draft);
    const listingUrl = safeHttpUrl(state.draft.listingUrl);
    const listingLink = state.dialog.querySelector('[data-listing-field-link]');
    listingLink.hidden = !listingUrl;
    if (listingUrl) listingLink.href = listingUrl;
    else listingLink.removeAttribute('href');
    renderEconomy(state.evaluation);
    renderWorkflow();
    renderProposal();
    restoreEmbeddedDraft('workflow', state.embeddedDrafts.workflow);
    restoreEmbeddedDraft('proposal', state.embeddedDrafts.proposal);
    state.embeddedDraftsReady = true;
    renderHeader();
    setActiveTab(state.activeTab);
    renderTakeAction();
    if (state.draft.hasWindows !== true && state.draft.hasWindows !== 'yes') setControl('windowsOpen', null);
    const centerDetails = state.dialog.querySelector('[data-center-details]');
    centerDetails.hidden = !(state.draft.cluster.hasSlogiCenter || state.draft.cluster.centerDetails);
    const deleteButton = state.dialog.querySelector('[data-action="delete"]');
    deleteButton.hidden = !(state.draft.id && typeof state.callbacks.onDelete === 'function');
    state.dialog.querySelectorAll('button').forEach((button) => {
      button.disabled = Boolean(state.busy) || button.dataset.businessDisabled === 'true';
    });
    const resolveButton = state.dialog.querySelector('[data-action="resolve-address"]');
    resolveButton.textContent = state.busy === 'resolve' ? 'Определяем…' : 'Определить';
    renderWorkflowFooterAction();
  }

  function syncFromForm(event) {
    const target = event && event.target;
    state.draft = collectDraft({
      cluster: Boolean(target && target.closest && target.closest('[data-manual-cluster]')),
      competitive: Boolean(target && target.closest && target.closest('[data-manual-competitive]')),
      coordinates: Boolean(target && target.closest && target.closest('[data-manual-coordinates]')),
      areaConfirmation: Boolean(target && target.closest && target.closest('[data-manual-area-confirmation]')),
      price: Boolean(target && target.closest && target.closest('[data-manual-price]')),
      comparison: Boolean(target && target.closest && target.closest('[data-manual-comparison]'))
    });
    render();
  }

  function finishDeferredEdit(event) {
    const target = event && event.target;
    const name = target && target.name;
    if (name !== 'address' && name !== 'pricePerSqm' && name !== 'comparisonPercent') return;
    syncFromForm(event);
    if (name === 'address') {
      setControl('address', state.draft.address);
      return;
    }
    const computed = state.evaluation && state.evaluation.computed || {};
    if (name === 'pricePerSqm') setControl(name, numberOrNull(computed.rentPerSqm));
    if (name === 'comparisonPercent') setControl(name, numberOrNull(computed.deviationPercent));
  }

  function showAlert(message) {
    const node = state.dialog.querySelector('[data-alert]');
    node.textContent = text(message);
    node.hidden = !node.textContent;
    if (!node.hidden) node.focus && node.focus();
  }

  function clearAlert() {
    showAlert('');
  }

  async function resolveAddress() {
    syncFromForm();
    if (!state.draft.address) {
      input('address').setCustomValidity('Укажите адрес помещения.');
      input('address').reportValidity();
      return;
    }
    input('address').setCustomValidity('');
    clearAlert();
    if (typeof state.callbacks.onResolveAddress !== 'function') {
      state.resolution = 'error';
      state.resolutionMessage = 'Сервис определения адреса не подключён.';
      render();
      return;
    }
    state.busy = 'resolve';
    state.resolution = 'loading';
    state.resolutionMessage = 'Определяем кластер и проверяем конкурентный анализ…';
    render();
    try {
      const result = await state.callbacks.onResolveAddress(state.draft);
      const payload = result && (result.card || result.data) ? (result.card || result.data) : result;
      if (payload && typeof payload === 'object') state.draft = normalize(mergeCard(state.draft, payload));
      state.draft.cluster.resolutionSource = 'automatic';
      state.draft.competitive.resolutionSource = 'automatic';
      state.resolution = 'success';
      state.resolutionMessage = '';
      fillForm(state.draft);
      emit(EVENTS.resolve, { card: state.draft, evaluation: evaluate(state.draft) });
    } catch (error) {
      state.resolution = 'error';
      state.resolutionMessage = error && error.message ? error.message : 'Не удалось определить адрес. Повторите попытку.';
    } finally {
      state.busy = '';
      render();
    }
  }

  async function runCallback(name, eventName, closeAfter) {
    syncFromForm();
    clearAlert();
    const callback = state.callbacks[name];
    if (typeof callback !== 'function') return;
    state.busy = name;
    render();
    try {
      const result = await callback(state.draft, state.evaluation);
      if (result === false) return;
      const payload = result && (result.card || result.data) ? (result.card || result.data) : result;
      if (payload && typeof payload === 'object') {
        state.draft = normalize(mergeCard(state.draft, payload));
        fillForm(state.draft);
      }
      emit(eventName, { card: state.draft, evaluation: evaluate(state.draft) });
      if (closeAfter) close(name.replace(/^on/, '').replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`), true);
    } catch (error) {
      showAlert(error && error.message ? error.message : 'Не удалось выполнить действие. Повторите попытку.');
    } finally {
      state.busy = '';
      render();
    }
  }

  async function runWorkflowAction(button) {
    const inProposal = Boolean(button && button.closest('[data-card-panel="proposal"]')) || state.activeTab === 'proposal';
    const callback = inProposal ? state.callbacks.onProposalAction : state.callbacks.onWorkflowAction;
    if (typeof callback !== 'function') return;
    clearAlert();
    const formData = typeof window.FormData === 'function' ? new window.FormData(state.form) : null;
    const action = text(button && button.dataset && button.dataset.action);
    const ui = captureWorkflowUi();
    try {
      const pending = callback(action, { card: state.draft, evaluation: state.evaluation, formData, button });
      state.busy = `${inProposal ? 'proposal' : 'workflow'}-${action || 'action'}`;
      button.disabled = true;
      const panel = button.closest('[data-workflow-panel]');
      if (panel) panel.setAttribute('aria-busy', 'true');
      const result = await pending;
      const payload = result && (result.card || result.data) ? (result.card || result.data) : result;
      if (payload && typeof payload === 'object') {
        state.draft = normalize(mergeCard(state.draft, payload));
        fillForm(state.draft);
      }
    } catch (error) {
      showAlert(error && error.message ? error.message : 'Не удалось выполнить действие. Повторите попытку.');
    } finally {
      state.busy = '';
      render();
      restoreWorkflowUi(ui);
    }
  }

  async function runWorkflowFile(inputNode) {
    const inProposal = Boolean(inputNode && inputNode.closest('[data-card-panel="proposal"]')) || state.activeTab === 'proposal';
    const callback = inProposal ? state.callbacks.onProposalFile : state.callbacks.onWorkflowFile;
    if (typeof callback !== 'function' || !inputNode) return;
    const file = inputNode.files && inputNode.files[0];
    if (!file) return;
    const ui = captureWorkflowUi();
    clearAlert();
    try {
      const pending = callback(inputNode.name, file, { card: state.draft, evaluation: state.evaluation });
      state.busy = `${inProposal ? 'proposal' : 'workflow'}-file-${inputNode.name || 'upload'}`;
      inputNode.disabled = true;
      const panel = inputNode.closest('[data-workflow-panel]');
      if (panel) panel.setAttribute('aria-busy', 'true');
      const result = await pending;
      const payload = result && (result.card || result.data) ? (result.card || result.data) : result;
      if (payload && typeof payload === 'object') {
        state.draft = normalize(mergeCard(state.draft, payload));
        fillForm(state.draft);
      }
    } catch (error) {
      showAlert(error && error.message ? error.message : 'Не удалось загрузить файл.');
    } finally {
      state.busy = '';
      render();
      restoreWorkflowUi(ui);
    }
  }

  function bindEvents() {
    state.form.addEventListener('input', (event) => {
      if (event.target.closest('[data-workflow-section], [data-proposal-section]')) return;
      if (event.target.name === 'address') {
        event.target.setCustomValidity('');
        state.draft.address = event.target.value;
        state.draft.geo = { lat: null, lng: null, resolutionSource: null };
        state.draft.cluster = { id: '', name: '', status: 'not_computed', matched: null, resolutionSource: null, hasSlogiCenter: null, centerDetails: '' };
        state.draft.competitive = { rating: null, rank: null, isTop30: null, isTop35: null, resolutionSource: null, averageRentPerSqm: null, comparisonPercentOverride: null };
        setControl('latitudeManual', null);
        setControl('longitudeManual', null);
        setControl('clusterNameManual', '');
        setControl('clusterStatusManual', null);
        setControl('hasSlogiCenterManual', null);
        setControl('clusterRankManual', null);
        setControl('averageRentManual', null);
        setControl('comparisonPercent', null);
        state.resolution = 'idle';
        state.resolutionMessage = '';
        render();
        return;
      }
      if (event.target.name === 'pricePerSqm' || event.target.name === 'comparisonPercent') return;
      syncFromForm(event);
    });
    state.form.addEventListener('change', (event) => {
      if (event.target.closest('[data-workflow-section], [data-proposal-section]')) {
        if (event.target.matches('input[type="file"]')) runWorkflowFile(event.target);
        return;
      }
      syncFromForm(event);
    });
    state.form.addEventListener('focusout', finishDeferredEdit);
    state.form.addEventListener('submit', (event) => event.preventDefault());
    state.dialog.addEventListener('click', (event) => {
      const tab = event.target.closest('[data-card-tab]');
      if (tab) {
        if (tab.getAttribute('aria-disabled') !== 'true') setActiveTab(tab.dataset.cardTab, true);
        return;
      }
      const button = event.target.closest('[data-action]');
      if (!button) return;
      const action = button.dataset.action;
      if (action === 'close') close('cancel');
      else if (action === 'resolve-address') resolveAddress();
      else if (action === 'save') runCallback('onSave', EVENTS.save, true);
      else if (action === 'take-to-work') runCallback('onTakeToWork', EVENTS.takeToWork, true);
      else if (action === 'delete') runCallback('onDelete', EVENTS.delete, true);
      else if (action === 'go-workflow') setActiveTab('workflow', true);
      else if (action === 'go-proposal') setActiveTab('proposal', true);
      else if (button.matches('[data-workflow-footer-action]') && workflowEnabled()) runWorkflowAction(button);
      else if (button.closest('[data-card-panel="workflow"], [data-card-panel="proposal"], .ss-card-context')) runWorkflowAction(button);
    });
    state.dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      if (!state.busy) close('escape');
    });
    state.dialog.addEventListener('keydown', (event) => {
      const activeTab = event.target.closest && event.target.closest('[data-card-tab]');
      if (activeTab && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
        const tabs = Array.from(state.dialog.querySelectorAll('[data-card-tab]')).filter((tab) => tab.getAttribute('aria-disabled') !== 'true');
        const current = tabs.indexOf(activeTab);
        if (current >= 0 && tabs.length) {
          event.preventDefault();
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (current + (event.key === 'ArrowLeft' ? -1 : 1) + tabs.length) % tabs.length;
          setActiveTab(tabs[next].dataset.cardTab, true);
        }
        return;
      }
      if (event.key !== 'Tab' || !state.dialog.open) return;
      const focusable = Array.from(state.dialog.querySelectorAll('button:not(:disabled), a[href], input:not(:disabled), summary, [tabindex]:not([tabindex="-1"])'))
        .filter((node) => !node.hidden && node.getClientRects().length);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    });
    state.dialog.addEventListener('close', () => {
      document.body.classList.remove('ss-card-modal-open');
      if (state.opener && document.contains(state.opener) && typeof state.opener.focus === 'function') state.opener.focus();
      state.opener = null;
    });
  }

  function parseOpenArguments(initialOrOptions, maybeCallbacks) {
    const first = initialOrOptions && typeof initialOrOptions === 'object' ? initialOrOptions : {};
    const isOptions = own(first, 'initial') || own(first, 'onResolveAddress') || own(first, 'onSave') || own(first, 'onTakeToWork') || own(first, 'onDelete') || own(first, 'context') || own(first, 'renderWorkflow') || own(first, 'renderProposal');
    return isOptions
      ? { initial: first.initial || {}, callbacks: first }
      : { initial: first, callbacks: maybeCallbacks && typeof maybeCallbacks === 'object' ? maybeCallbacks : {} };
  }

  function open(initialOrOptions, maybeCallbacks) {
    const options = parseOpenArguments(initialOrOptions, maybeCallbacks);
    const dialog = ensureDialog();
    state.opener = options.callbacks.opener || document.activeElement;
    state.callbacks = options.callbacks;
    state.context = text(options.callbacks.context);
    state.draft = normalize(options.initial);
    state.activeTab = tabAvailable(text(options.callbacks.initialTab)) ? text(options.callbacks.initialTab) : 'object';
    state.workflowView = null;
    state.proposalView = null;
    state.embeddedDrafts = { workflow: null, proposal: null };
    state.embeddedDraftsReady = false;
    state.busy = '';
    state.resolution = 'idle';
    state.resolutionMessage = state.draft.cluster.status === 'inside'
      ? 'Кластер определён по адресу.'
      : state.draft.cluster.status === 'outside' ? 'Помещение находится вне действующих кластеров.' : state.draft.cluster.status === 'address' ? 'Район распознан предварительно — подтвердите кластер по координатам.' : '';
    clearAlert();
    fillForm(state.draft);
    render();
    if (!dialog.open) {
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
    }
    document.body.classList.add('ss-card-modal-open');
    window.setTimeout(() => {
      const panelSelector = state.activeTab === 'proposal' ? '[data-card-panel="proposal"]' : '[data-card-panel="workflow"]';
      const target=state.activeTab==='object'?input('address'):state.dialog.querySelector(`${panelSelector} input, ${panelSelector} textarea, ${panelSelector} button`);
      if(target&&typeof target.focus==='function')target.focus();
    }, 0);
    emit(EVENTS.open, { card: state.draft, evaluation: state.evaluation });
    return state.draft;
  }

  function close(reason, force) {
    if (!state.dialog || !state.dialog.open || (state.busy && !force)) return;
    if (typeof state.dialog.close === 'function') state.dialog.close(text(reason) || 'close');
    else {
      state.dialog.removeAttribute('open');
      document.body.classList.remove('ss-card-modal-open');
    }
  }

  function destroy() {
    if (!state.dialog) return;
    if (state.dialog.open && typeof state.dialog.close === 'function') state.dialog.close('destroy');
    state.dialog.remove();
    state.dialog = null;
    state.form = null;
    state.draft = null;
    state.evaluation = null;
    state.callbacks = {};
    state.context = '';
    state.activeTab = 'object';
    state.workflowView = null;
    state.proposalView = null;
    state.embeddedDrafts = { workflow: null, proposal: null };
    state.embeddedDraftsReady = false;
    document.body.classList.remove('ss-card-modal-open');
  }

  window.SlogiSearchSpaceCardModal = Object.freeze({
    open,
    close,
    destroy,
    normalize,
    evaluate,
    events: EVENTS
  });
})(window, document);
