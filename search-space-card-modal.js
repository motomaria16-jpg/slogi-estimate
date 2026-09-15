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

  function formatNumber(value, maximumFractionDigits) {
    const parsed = numberOrNull(value);
    if (parsed == null) return '—';
    return new Intl.NumberFormat('ru-RU', { maximumFractionDigits }).format(parsed);
  }

  function formatMoney(value) {
    const parsed = numberOrNull(value);
    if (parsed == null) return '—';
    return `${formatNumber(Math.round(parsed), 0)} ₽`;
  }

  function choice(name, value, label) {
    return `<label class="ss-card-choice"><input type="radio" name="${name}" value="${value}"><span>${label}</span></label>`;
  }

  function template() {
    return `<dialog class="ss-card-dialog" id="${ROOT_ID}" aria-labelledby="ss-card-title" aria-describedby="ss-card-subtitle">
      <form class="ss-card-form" method="dialog" novalidate>
        <header class="ss-card-header">
          <div>
            <h2 id="ss-card-title">Карточка помещения</h2>
            <p class="ss-card-visually-hidden" id="ss-card-subtitle">Данные помещения и решение специалиста</p>
            <div class="ss-card-header-meta">
              <span data-header-address>Адрес не указан</span>
              <span data-source-label>Добавлено вручную</span>
              <span data-header-area>Площадь не указана</span>
              <span data-header-rent>Аренда не указана</span>
              <a data-listing-link target="_blank" rel="noopener noreferrer" hidden>Открыть объявление</a>
            </div>
          </div>
          <button class="ss-card-close" type="button" data-action="close" aria-label="Закрыть карточку">×</button>
        </header>

        <div class="ss-card-body">
          <div class="ss-card-alert" data-alert role="alert" hidden></div>

          <section class="ss-card-section" aria-labelledby="ss-card-location-title">
            <div class="ss-card-section-heading"><span>01</span><div><h3 id="ss-card-location-title">Прохождение отбора кластера по конкурентному анализу</h3></div></div>
            <div class="ss-card-address-row">
              <label class="ss-card-field ss-card-field-wide" data-tone-field="address"><span>Адрес помещения <b aria-hidden="true">*</b></span><input name="address" type="text" autocomplete="street-address" placeholder="Город, улица, дом" required></label>
              <button class="ss-card-button ss-card-button-secondary" type="button" data-action="resolve-address">Определить автоматически</button>
            </div>
            <div class="ss-card-listing-row">
              <label class="ss-card-field" data-tone-field="listing-url"><span>Ссылка на объявление</span><input name="listingUrl" type="url" inputmode="url" autocomplete="url" placeholder="https://…"></label>
              <a class="ss-card-button ss-card-button-secondary" data-listing-field-link target="_blank" rel="noopener noreferrer" hidden>Открыть объявление</a>
            </div>
            <div class="ss-card-resolution" data-resolution role="status" aria-live="polite"></div>
            <div class="ss-card-status-grid">
              <article class="ss-card-status-card" data-status="cluster"><span>Попадание в кластер</span><strong>Нет данных</strong><p>Кластер не указан</p></article>
              <article class="ss-card-status-card" data-status="center"><span>Объект СЛОГИ в кластере</span><strong>Нет данных</strong><p>—</p></article>
              <article class="ss-card-status-card" data-status="ranking"><span>Рейтинг кластера</span><strong>Нет данных</strong><p>ТОП-35</p></article>
            </div>
            <fieldset class="ss-card-manual" data-manual-location>
              <legend>Ручные данные</legend>
              <div class="ss-card-manual-grid">
                <label class="ss-card-field" data-manual-coordinates><span>Широта</span><input name="latitudeManual" type="number" min="-90" max="90" step="0.000001" inputmode="decimal" placeholder="55.7558"></label>
                <label class="ss-card-field" data-manual-coordinates><span>Долгота</span><input name="longitudeManual" type="number" min="-180" max="180" step="0.000001" inputmode="decimal" placeholder="37.6176"></label>
                <label class="ss-card-field" data-manual-cluster><span>Название кластера</span><input name="clusterNameManual" type="text" placeholder="Название"></label>
                <fieldset class="ss-card-option" data-manual-cluster><legend>Помещение входит в кластер</legend><div>${choice('clusterStatusManual', 'inside', 'Да')}${choice('clusterStatusManual', 'outside', 'Нет')}</div></fieldset>
                <fieldset class="ss-card-option ss-card-center-choice" data-manual-cluster><legend>В кластере есть объект СЛОГИ</legend><div>${choice('hasSlogiCenterManual', 'true', 'Да')}${choice('hasSlogiCenterManual', 'false', 'Нет')}</div></fieldset>
                <label class="ss-card-field" data-manual-competitive><span>Место в рейтинге</span><input name="clusterRankManual" type="number" min="1" step="1" inputmode="numeric" placeholder="1–35"></label>
              </div>
            </fieldset>
          </section>

          <section class="ss-card-section" aria-labelledby="ss-card-technical-title">
            <div class="ss-card-section-heading"><span>02</span><div><h3 id="ss-card-technical-title">Прохождение технических условий</h3></div></div>
            <div class="ss-card-economy-fields">
              <label class="ss-card-field" data-tone-field="rent"><span>Стоимость аренды в месяц, ₽ <b aria-hidden="true">*</b></span><input name="rentMonthly" type="number" min="0" step="1" inputmode="decimal" placeholder="0"></label>
              <div class="ss-card-area-field" data-tone-field="area">
                <label class="ss-card-field"><span>Площадь, м² <b aria-hidden="true">*</b></span><input name="area" type="number" min="0" step="0.01" inputmode="decimal" placeholder="90–150"></label>
                <fieldset class="ss-card-binary ss-card-area-confirmation" data-manual-area-confirmation><legend>Соответствует диапазону 90–150 м²</legend>${choice('areaConfirmed', 'true', 'Да')}${choice('areaConfirmed', 'false', 'Нет')}</fieldset>
              </div>
              <label class="ss-card-field" data-tone-field="price"><span>Цена за 1 м², ₽</span><input name="pricePerSqmOverride" type="number" min="0" step="1" inputmode="decimal" placeholder="Автоматически"><small data-value="calculated-rent-per-sqm">—</small></label>
              <label class="ss-card-field" data-manual-competitive data-tone-field="average"><span>Средняя цена в кластере, ₽/м²</span><input name="averageRentManual" type="number" min="0" step="1" inputmode="decimal" placeholder="0"></label>
              <label class="ss-card-field" data-tone-field="comparison"><span>Сравнение со средней, %</span><input name="comparisonPercentOverride" type="number" step="0.1" inputmode="decimal" placeholder="Автоматически"><small data-value="calculated-rent-delta">—</small></label>
            </div>
            <div class="ss-card-technical-grid">
              <fieldset class="ss-card-option"><legend>Входная группа</legend><div>${choice('separateEntrance', 'true', 'Да')}${choice('separateEntrance', 'false', 'Нет')}</div></fieldset>
              <fieldset class="ss-card-option"><legend>Окна есть</legend><div>${choice('hasWindows', 'true', 'Да')}${choice('hasWindows', 'false', 'Нет')}</div></fieldset>
              <fieldset class="ss-card-option" data-windows-open><legend>Окна открываются</legend><div>${choice('windowsOpen', 'true', 'Да')}${choice('windowsOpen', 'false', 'Нет')}</div></fieldset>
              <div class="ss-card-combined-field" data-tone-field="ceiling">
                <label class="ss-card-field"><span>Высота потолков, м <b aria-hidden="true">*</b></span><input name="ceilingHeight" type="number" min="0" step="0.01" inputmode="decimal" placeholder="0"></label>
                <fieldset class="ss-card-binary"><legend>Норматив</legend>${choice('ceilingHeightConfirmed', 'true', 'Да')}${choice('ceilingHeightConfirmed', 'false', 'Нет')}</fieldset>
              </div>
              <fieldset class="ss-card-option ss-card-repair"><legend>Ремонт</legend><div>${choice('repair', 'none', 'Бетон')}${choice('repair', 'rough', 'Черновой')}${choice('repair', 'finished', 'Чистовой')}</div></fieldset>
            </div>
          </section>

          <section class="ss-card-section ss-card-decision" aria-labelledby="ss-card-readiness-title">
            <div class="ss-card-section-heading"><span>03</span><div><h3 id="ss-card-readiness-title">Решение специалиста</h3></div></div>
            <div class="ss-card-decision-result" data-ready="false">
              <strong data-readiness-title>Требуется решение специалиста</strong>
              <ul data-reasons aria-live="polite"></ul>
            </div>
          </section>
        </div>

        <footer class="ss-card-footer">
          <button class="ss-card-delete" type="button" data-action="delete" hidden>Удалить помещение</button>
          <div class="ss-card-footer-main">
            <button class="ss-card-button ss-card-button-ghost" type="button" data-action="close">Отмена</button>
            <button class="ss-card-button ss-card-button-secondary" type="button" data-action="save">Сохранить</button>
            <button class="ss-card-button ss-card-button-primary" type="button" data-action="take-to-work" aria-describedby="ss-card-take-help" disabled>Добавить в «Помещение в работе»</button>
          </div>
          <span class="ss-card-visually-hidden" id="ss-card-take-help" data-take-help>Заполните карточку и выполните условия отбора.</span>
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
    const manualRank = numberOrNull(input('clusterRankManual') && input('clusterRankManual').value);
    const manualAverage = numberOrNull(input('averageRentManual') && input('averageRentManual').value);
    const latitude = numberOrNull(input('latitudeManual') && input('latitudeManual').value);
    const longitude = numberOrNull(input('longitudeManual') && input('longitudeManual').value);
    const pricePerSqmOverride = numberOrNull(input('pricePerSqmOverride') && input('pricePerSqmOverride').value);
    const comparisonPercentOverride = numberOrNull(input('comparisonPercentOverride') && input('comparisonPercentOverride').value);
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
      hasSlogiCenter: manualCenter
    });
    const competitive = Object.assign({}, current.competitive, {
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
      repair: readRadio('repair')
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
    setControl('clusterRankManual', card.competitive.rank);
    setControl('averageRentManual', card.competitive.averageRentPerSqm);
    setControl('comparisonPercentOverride', card.competitive.comparisonPercentOverride);
    setControl('rentMonthly', card.rentMonthly);
    setControl('area', card.area);
    setControl('areaConfirmed', card.areaConfirmed);
    setControl('pricePerSqmOverride', card.pricePerSqmOverride);
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

  function setStatus(name, tone, title, description) {
    const node = state.dialog.querySelector(`[data-status="${name}"]`);
    node.dataset.tone = tone;
    node.querySelector('strong').textContent = title;
    node.querySelector('p').textContent = description;
  }

  function renderLocation(card) {
    if (card.cluster.status === 'inside') {
      setStatus('cluster', 'success', 'Да', card.cluster.name || card.cluster.id || 'Название не указано');
    } else if (card.cluster.status === 'address') {
      setStatus('cluster', 'warning', 'Предварительно', card.cluster.name || 'Название не указано');
    } else if (card.cluster.status === 'outside') {
      setStatus('cluster', 'danger', 'Нет', 'Вне кластеров');
    } else {
      setStatus('cluster', 'neutral', 'Нет данных', 'Кластер не указан');
    }

    if (card.cluster.hasSlogiCenter === true) {
      setStatus('center', 'danger', 'Да', card.cluster.centerDetails || 'Кластер занят');
    } else if (card.cluster.hasSlogiCenter === false) {
      setStatus('center', 'success', 'Нет', 'Кластер свободен');
    } else {
      setStatus('center', 'neutral', 'Нет данных', '—');
    }

    const rank = card.competitive.rank;
    if (card.competitive.isTop35 === true) {
      setStatus('ranking', 'success', `${formatNumber(rank, 0)} место`, 'ТОП-35');
    } else if (card.competitive.isTop35 === false) {
      setStatus('ranking', 'danger', `${formatNumber(rank, 0)} место`, 'Ниже ТОП-35');
    } else {
      setStatus('ranking', 'neutral', 'Нет данных', 'ТОП-35');
    }
  }

  function setToneField(name, tone) {
    const node = state.dialog.querySelector(`[data-tone-field="${name}"]`);
    if (node) node.dataset.tone = tone || 'neutral';
  }

  function renderEconomy(evaluation) {
    const computed = evaluation.computed || {};
    const rentPerSqm = numberOrNull(computed.rentPerSqm);
    const deviation = numberOrNull(computed.deviationPercent);
    const calculatedRent = state.dialog.querySelector('[data-value="calculated-rent-per-sqm"]');
    const calculatedDelta = state.dialog.querySelector('[data-value="calculated-rent-delta"]');
    calculatedRent.textContent = rentPerSqm == null ? '—' : `${formatMoney(rentPerSqm)} / м²`;
    calculatedDelta.textContent = deviation == null ? '—' : `${deviation > 0 ? '+' : ''}${formatNumber(deviation, 1)}%`;
    const priceTone = deviation == null ? 'neutral' : deviation > 0 ? 'danger' : 'success';
    setToneField('rent', state.draft.rentMonthly > 0 ? 'success' : 'warning');
    setToneField('area', state.draft.areaConfirmed == null ? 'warning' : state.draft.areaConfirmed === true ? 'success' : 'danger');
    setToneField('price', priceTone);
    setToneField('average', state.draft.competitive.averageRentPerSqm > 0 ? 'success' : 'warning');
    setToneField('comparison', priceTone);
    setToneField('address', state.draft.address ? 'success' : 'warning');
    setToneField('listing-url', state.draft.listingUrl ? 'success' : 'neutral');
    setToneField('ceiling', state.draft.ceilingHeightConfirmed == null ? 'warning' : state.draft.ceilingHeightConfirmed ? 'success' : 'danger');
  }

  function renderReadiness(evaluation) {
    const title = state.dialog.querySelector('[data-readiness-title]');
    const list = state.dialog.querySelector('[data-reasons]');
    const takeButton = state.dialog.querySelector('[data-action="take-to-work"]');
    const checks = evaluation.checks || {};
    const rows = [
      ['Кластер свободен', Boolean(checks.clusterInside && checks.clusterFree)],
      ['ТОП-35', Boolean(checks.clusterTop35)],
      ['Обязательные параметры заполнены', Boolean(checks.requiredComplete)]
    ];
    title.textContent = evaluation.canTakeToWork ? 'Можно добавить в работу' : 'Требуется решение специалиста';
    title.closest('.ss-card-decision-result').dataset.ready = evaluation.canTakeToWork ? 'true' : 'false';
    list.innerHTML = rows.map(([label, passed]) => `<li data-tone="${passed ? 'success' : 'danger'}"><span>${escapeHtml(label)}</span><strong>${passed ? 'Да' : 'Нет'}</strong></li>`).join('');
    takeButton.disabled = !evaluation.canTakeToWork || Boolean(state.busy);
    takeButton.setAttribute('aria-disabled', String(takeButton.disabled));
    const help = state.dialog.querySelector('[data-take-help]');
    help.textContent = evaluation.canTakeToWork ? 'Все условия выполнены.' : 'Проверьте три условия решения специалиста.';
  }

  function renderResolution() {
    const node = state.dialog.querySelector('[data-resolution]');
    node.dataset.state = state.resolution;
    node.textContent = state.resolutionMessage || '';
    node.hidden = !node.textContent;
  }

  function render() {
    if (!state.dialog || !state.draft) return;
    state.evaluation = evaluate(state.draft);
    const sourceLabel = state.dialog.querySelector('[data-source-label]');
    sourceLabel.textContent = state.draft.source === 'parsed' ? 'Получено из парсинга' : 'Добавлено вручную';
    state.dialog.querySelector('[data-header-address]').textContent = state.draft.address || 'Адрес не указан';
    state.dialog.querySelector('[data-header-area]').textContent = state.draft.area == null ? 'Площадь не указана' : `${formatNumber(state.draft.area, 1)} м²`;
    state.dialog.querySelector('[data-header-rent]').textContent = state.draft.rentMonthly == null ? 'Аренда не указана' : `${formatMoney(state.draft.rentMonthly)} / мес`;
    const listingUrl = safeHttpUrl(state.draft.listingUrl);
    [state.dialog.querySelector('[data-listing-link]'), state.dialog.querySelector('[data-listing-field-link]')].forEach((link) => {
      link.hidden = !listingUrl;
      if (listingUrl) link.href = listingUrl;
      else link.removeAttribute('href');
    });
    renderLocation(state.draft);
    renderEconomy(state.evaluation);
    renderReadiness(state.evaluation);
    renderResolution();
    if (state.draft.hasWindows !== true && state.draft.hasWindows !== 'yes') setControl('windowsOpen', null);
    const deleteButton = state.dialog.querySelector('[data-action="delete"]');
    deleteButton.hidden = !(state.draft.id && typeof state.callbacks.onDelete === 'function');
    state.dialog.querySelectorAll('button').forEach((button) => {
      if (button.dataset.action === 'take-to-work') return;
      button.disabled = Boolean(state.busy);
    });
    const resolveButton = state.dialog.querySelector('[data-action="resolve-address"]');
    resolveButton.textContent = state.busy === 'resolve' ? 'Определяем…' : 'Определить автоматически';
  }

  function syncFromForm(event) {
    const target = event && event.target;
    state.draft = collectDraft({
      cluster: Boolean(target && target.closest && target.closest('[data-manual-cluster]')),
      competitive: Boolean(target && target.closest && target.closest('[data-manual-competitive]')),
      coordinates: Boolean(target && target.closest && target.closest('[data-manual-coordinates]')),
      areaConfirmation: Boolean(target && target.closest && target.closest('[data-manual-area-confirmation]'))
    });
    render();
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
      state.resolutionMessage = state.draft.cluster.status === 'outside'
        ? 'Адрес определён. Помещение находится вне действующих кластеров.'
        : state.draft.cluster.status === 'inside'
          ? `Адрес определён. Кластер: ${state.draft.cluster.name || state.draft.cluster.id}.`
          : 'Адрес определён, но кластер установить не удалось.';
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
    if (name === 'onTakeToWork' && !state.evaluation.canTakeToWork) return;
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

  function bindEvents() {
    state.form.addEventListener('input', (event) => {
      if (event.target.name === 'address') {
        event.target.setCustomValidity('');
        state.draft = collectDraft();
        state.draft.geo = { lat: null, lng: null, resolutionSource: null };
        state.draft.cluster = { id: '', name: '', status: 'not_computed', matched: null, resolutionSource: null, hasSlogiCenter: null, centerDetails: '' };
        state.draft.competitive = { rating: null, rank: null, isTop30: null, isTop35: null, resolutionSource: null, averageRentPerSqm: null, comparisonPercentOverride: null };
        state.resolution = 'idle';
        state.resolutionMessage = 'Адрес изменён — определите кластер повторно.';
        fillForm(state.draft);
        render();
        return;
      }
      syncFromForm(event);
    });
    state.form.addEventListener('change', syncFromForm);
    state.form.addEventListener('submit', (event) => event.preventDefault());
    state.dialog.addEventListener('click', (event) => {
      const button = event.target.closest('[data-action]');
      if (!button) return;
      const action = button.dataset.action;
      if (action === 'close') close('cancel');
      else if (action === 'resolve-address') resolveAddress();
      else if (action === 'save') runCallback('onSave', EVENTS.save, true);
      else if (action === 'take-to-work') runCallback('onTakeToWork', EVENTS.takeToWork, true);
      else if (action === 'delete') runCallback('onDelete', EVENTS.delete, true);
    });
    state.dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      if (!state.busy) close('escape');
    });
    state.dialog.addEventListener('keydown', (event) => {
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
    const isOptions = own(first, 'initial') || own(first, 'onResolveAddress') || own(first, 'onSave') || own(first, 'onTakeToWork') || own(first, 'onDelete');
    return isOptions
      ? { initial: first.initial || {}, callbacks: first }
      : { initial: first, callbacks: maybeCallbacks && typeof maybeCallbacks === 'object' ? maybeCallbacks : {} };
  }

  function open(initialOrOptions, maybeCallbacks) {
    const options = parseOpenArguments(initialOrOptions, maybeCallbacks);
    const dialog = ensureDialog();
    state.opener = options.callbacks.opener || document.activeElement;
    state.callbacks = options.callbacks;
    state.draft = normalize(options.initial);
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
    window.setTimeout(() => input('address') && input('address').focus(), 0);
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
