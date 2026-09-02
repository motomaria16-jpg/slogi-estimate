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
    const explicitTop30 = boolOrNull(nested(rawCompetitive, 'isTop30', raw.isTop30));
    const sourceValue = text(raw.source).toLowerCase();

    return {
      id: text(raw.id),
      source: sourceValue === 'parsed' || sourceValue === 'cian' ? 'parsed' : 'manual',
      sourceProvider: text(nested(raw, 'sourceProvider', raw.source_provider)),
      address: text(raw.address),
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
        isTop30: explicitTop30 == null && rank != null ? rank >= 1 && rank <= 30 : explicitTop30,
        resolutionSource: ['manual', 'automatic'].includes(text(nested(rawCompetitive, 'resolutionSource', raw.competitiveResolutionSource)).toLowerCase())
          ? text(nested(rawCompetitive, 'resolutionSource', raw.competitiveResolutionSource)).toLowerCase()
          : null,
        averageRentPerSqm: numberOrNull(nested(rawCompetitive, 'averageRentPerSqm', raw.averageRentPerSqm))
      },
      rentMonthly: numberOrNull(nested(raw, 'rentMonthly', rawRent.amount)),
      area: numberOrNull(raw.area),
      areaConfirmed: boolOrNull(raw.areaConfirmed),
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
        normalized.areaConfirmed = original.areaConfirmed;
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
        if (original.competitive.isTop30 != null) normalized.competitive.isTop30 = original.competitive.isTop30;
        return normalized;
      } catch (_error) {
        return normalizeFallback(input);
      }
    }
    return normalizeFallback(input);
  }

  function computedFallback(card) {
    const rentPerSqm = card.area > 0 && card.rentMonthly != null ? card.rentMonthly / card.area : null;
    const averageRentPerSqm = card.competitive.averageRentPerSqm;
    const deviationPercent = rentPerSqm != null && averageRentPerSqm > 0
      ? ((rentPerSqm - averageRentPerSqm) / averageRentPerSqm) * 100
      : null;
    return { rentPerSqm, averageRentPerSqm, deviationPercent };
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
    if (card.competitive.isTop30 == null) reasons.push('Нет результата проверки по конкурентному анализу.');
    else if (!card.competitive.isTop30) reasons.push('Кластер помещения не входит в ТОП-30.');
    if (!(card.rentMonthly > 0)) missing.push('Укажите стоимость аренды.');
    if (!(card.area > 0)) missing.push('Укажите площадь помещения.');
    if (card.areaConfirmed !== true) missing.push(card.areaConfirmed === false ? 'Площадь должна подходить: выберите «Да».' : 'Укажите, подходит ли площадь.');
    if (card.separateEntrance == null) missing.push('Укажите наличие отдельного входа.');
    if (card.hasWindows == null) missing.push('Укажите наличие окон.');
    if (card.hasWindows === true && card.windowsOpen == null) missing.push('Укажите, открываются ли окна.');
    if (!(card.ceilingHeight > 0)) missing.push('Укажите высоту потолков.');
    if (card.ceilingHeightConfirmed !== true) missing.push(card.ceilingHeightConfirmed === false ? 'Высота потолков должна подходить: выберите «Да».' : 'Укажите, подходит ли высота потолков.');
    if (!card.repair) missing.push('Укажите состояние ремонта.');
    if (!(card.competitive.averageRentPerSqm > 0)) missing.push('В конкурентном анализе нет средней стоимости аренды по кластеру.');
    const allReasons = reasons.concat(missing);
    return {
      canTakeToWork: allReasons.length === 0,
      reasons: allReasons,
      missing,
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
    cluster_not_top30: 'Кластер помещения не входит в ТОП-30.',
    already_in_work: 'Помещение уже находится в работе.',
    required_fields_incomplete: 'Не все обязательные параметры заполнены.'
  });

  const FIELD_LABELS = Object.freeze({
    address: 'Укажите адрес помещения.',
    rentMonthly: 'Укажите стоимость аренды.',
    area: 'Укажите площадь помещения.',
    areaConfirmed: 'Площадь должна подходить: выберите «Да».',
    pricePerSqm: 'Укажите площадь и аренду для расчёта цены за 1 м².',
    separateEntrance: 'Укажите наличие отдельного входа.',
    hasWindows: 'Укажите наличие окон.',
    windowsOpen: 'Укажите, открываются ли окна.',
    ceilingHeight: 'Укажите высоту потолков.',
    ceilingHeightConfirmed: 'Высота потолков должна подходить: выберите «Да».',
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
            <div class="ss-card-kicker" data-source-label>Единая карточка помещения</div>
            <h2 id="ss-card-title">Карточка помещения</h2>
            <p id="ss-card-subtitle">Основной объект для отбора, КП, сметы и ремонта</p>
          </div>
          <button class="ss-card-close" type="button" data-action="close" aria-label="Закрыть карточку">×</button>
        </header>

        <div class="ss-card-body">
          <div class="ss-card-alert" data-alert role="alert" hidden></div>

          <section class="ss-card-section" aria-labelledby="ss-card-location-title">
            <div class="ss-card-section-heading"><span>01</span><div><h3 id="ss-card-location-title">Расположение и потенциал</h3><p>Адрес связывает помещение с кластером и конкурентным анализом.</p></div></div>
            <div class="ss-card-address-row">
              <label class="ss-card-field ss-card-field-wide"><span>Адрес помещения <b aria-hidden="true">*</b></span><input name="address" type="text" autocomplete="street-address" placeholder="Город, улица, дом" required><small>Введите полный адрес, затем определите кластер.</small></label>
              <button class="ss-card-button ss-card-button-secondary" type="button" data-action="resolve-address">Определить</button>
            </div>
            <div class="ss-card-resolution" data-resolution role="status" aria-live="polite"></div>
            <div class="ss-card-status-grid">
              <article class="ss-card-status-card" data-status="cluster"><span>Кластер</span><strong>Не определён</strong><p>Укажите адрес помещения.</p></article>
              <article class="ss-card-status-card" data-status="center"><span>Центр Слоги</span><strong>Нет данных</strong><p>Проверка выполнится после определения кластера.</p></article>
              <article class="ss-card-status-card" data-status="ranking"><span>Конкурентный анализ</span><strong>Нет данных</strong><p>Для работы требуется ТОП-30 кластеров.</p></article>
            </div>
            <details class="ss-card-manual" data-manual-location>
              <summary><span>Ввести данные вручную</span><small data-manual-summary>Если автоматическая проверка не дала результата</small></summary>
              <p class="ss-card-manual-note">Ручные значения сохранятся в карточке. При переводе помещения в работу система всё равно повторно проверит адрес и кластер.</p>
              <div class="ss-card-manual-grid">
                <label class="ss-card-field" data-manual-cluster><span>Название кластера</span><input name="clusterNameManual" type="text" placeholder="Например, Лефортово"></label>
                <fieldset class="ss-card-option" data-manual-cluster><legend>Помещение входит в кластер</legend><div>${choice('clusterStatusManual', 'inside', 'Да')}${choice('clusterStatusManual', 'outside', 'Нет')}</div></fieldset>
                <fieldset class="ss-card-option" data-manual-cluster><legend>В кластере есть центр Слоги</legend><div>${choice('hasSlogiCenterManual', 'true', 'Да')}${choice('hasSlogiCenterManual', 'false', 'Нет')}</div></fieldset>
                <label class="ss-card-field" data-manual-competitive><span>Место кластера в рейтинге</span><input name="clusterRankManual" type="number" min="1" step="1" inputmode="numeric" placeholder="1–30"></label>
                <label class="ss-card-field" data-manual-competitive><span>Средняя аренда в кластере, ₽/м²</span><input name="averageRentManual" type="number" min="0" step="1" inputmode="decimal" placeholder="0"></label>
              </div>
            </details>
          </section>

          <section class="ss-card-section" aria-labelledby="ss-card-economy-title">
            <div class="ss-card-section-heading"><span>02</span><div><h3 id="ss-card-economy-title">Экономика помещения</h3><p>Цена за 1 м² и сравнение со средним рассчитываются автоматически.</p></div></div>
            <div class="ss-card-fields-grid">
              <label class="ss-card-field"><span>Стоимость аренды в месяц, ₽ <b aria-hidden="true">*</b></span><input name="rentMonthly" type="number" min="0" step="1" inputmode="decimal" placeholder="0"></label>
              <div class="ss-card-combined-field">
                <label class="ss-card-field"><span>Площадь, м² <b aria-hidden="true">*</b></span><input name="area" type="number" min="0" step="0.01" inputmode="decimal" placeholder="0"></label>
                <fieldset class="ss-card-binary"><legend>Площадь подходит</legend>${choice('areaConfirmed', 'true', 'Да')}${choice('areaConfirmed', 'false', 'Нет')}</fieldset>
              </div>
            </div>
            <div class="ss-card-economy-grid" aria-live="polite">
              <article><span>Цена за 1 м²</span><strong data-value="rent-per-sqm">—</strong><p>Рассчитывается из аренды и площади</p></article>
              <article><span>Средняя в кластере</span><strong data-value="average-rent">—</strong><p>Из конкурентного анализа</p></article>
              <article class="ss-card-delta" data-delta><span>Сравнение со средней</span><strong data-value="rent-delta">—</strong><p>Нет данных для сравнения</p></article>
            </div>
          </section>

          <section class="ss-card-section" aria-labelledby="ss-card-technical-title">
            <div class="ss-card-section-heading"><span>03</span><div><h3 id="ss-card-technical-title">Технические условия</h3><p>Заполните каждый параметр до передачи помещения в работу.</p></div></div>
            <div class="ss-card-technical-grid">
              <fieldset class="ss-card-option"><legend>Отдельный вход</legend><div>${choice('separateEntrance', 'true', 'Да')}${choice('separateEntrance', 'false', 'Нет')}</div></fieldset>
              <fieldset class="ss-card-option"><legend>Окна</legend><div>${choice('hasWindows', 'true', 'Да')}${choice('hasWindows', 'false', 'Нет')}</div></fieldset>
              <fieldset class="ss-card-option" data-windows-open hidden><legend>Окна открываются</legend><div>${choice('windowsOpen', 'true', 'Да')}${choice('windowsOpen', 'false', 'Нет')}</div></fieldset>
              <div class="ss-card-combined-field">
                <label class="ss-card-field"><span>Высота потолков, м <b aria-hidden="true">*</b></span><input name="ceilingHeight" type="number" min="0" step="0.01" inputmode="decimal" placeholder="0"></label>
                <fieldset class="ss-card-binary"><legend>Высота подходит</legend>${choice('ceilingHeightConfirmed', 'true', 'Да')}${choice('ceilingHeightConfirmed', 'false', 'Нет')}</fieldset>
              </div>
              <fieldset class="ss-card-option ss-card-repair"><legend>Ремонт</legend><div>${choice('repair', 'none', 'Нет ремонта')}${choice('repair', 'rough', 'Черновой')}${choice('repair', 'finished', 'Чистовой')}</div></fieldset>
            </div>
          </section>

          <section class="ss-card-readiness" aria-labelledby="ss-card-readiness-title">
            <div><span>Готовность</span><h3 id="ss-card-readiness-title" data-readiness-title>Нельзя взять в работу</h3></div>
            <ul data-reasons aria-live="polite"></ul>
          </section>
        </div>

        <footer class="ss-card-footer">
          <button class="ss-card-delete" type="button" data-action="delete" hidden>Удалить помещение</button>
          <div class="ss-card-footer-main">
            <button class="ss-card-button ss-card-button-ghost" type="button" data-action="close">Отмена</button>
            <button class="ss-card-button ss-card-button-secondary" type="button" data-action="save">Сохранить</button>
            <button class="ss-card-button ss-card-button-primary" type="button" data-action="take-to-work" aria-describedby="ss-card-take-help" disabled>Взять в работу</button>
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
      Array.from(control).forEach((item) => { item.checked = String(value) === item.value; });
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
      resolutionSource: groups.competitive ? 'manual' : current.competitive.resolutionSource,
      averageRentPerSqm: manualAverage
    });
    return normalizeFallback(Object.assign({}, current, {
      address: text(input('address') && input('address').value),
      cluster,
      competitive,
      rentMonthly: numberOrNull(input('rentMonthly') && input('rentMonthly').value),
      area: numberOrNull(input('area') && input('area').value),
      areaConfirmed: boolOrNull(readRadio('areaConfirmed')),
      separateEntrance: boolOrNull(readRadio('separateEntrance')),
      hasWindows: boolOrNull(readRadio('hasWindows')),
      windowsOpen: readRadio('hasWindows') === 'true' ? boolOrNull(readRadio('windowsOpen')) : null,
      ceilingHeight: numberOrNull(input('ceilingHeight') && input('ceilingHeight').value),
      ceilingHeightConfirmed: boolOrNull(readRadio('ceilingHeightConfirmed')),
      repair: readRadio('repair')
    }));
  }

  function fillForm(card) {
    setControl('address', card.address);
    setControl('clusterNameManual', card.cluster.name);
    setControl('clusterStatusManual', card.cluster.status === 'inside' || card.cluster.status === 'outside' ? card.cluster.status : null);
    setControl('hasSlogiCenterManual', card.cluster.hasSlogiCenter);
    setControl('clusterRankManual', card.competitive.rank);
    setControl('averageRentManual', card.competitive.averageRentPerSqm);
    setControl('rentMonthly', card.rentMonthly);
    setControl('area', card.area);
    setControl('areaConfirmed', card.areaConfirmed);
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
    const clusterSource = card.cluster.resolutionSource === 'manual' ? ' Введено вручную.' : '';
    const competitiveSource = card.competitive.resolutionSource === 'manual' ? ' Введено вручную.' : '';
    if (card.cluster.status === 'inside') {
      setStatus('cluster', 'success', card.cluster.name || card.cluster.id || 'Кластер определён', `Помещение входит в границы кластера.${clusterSource}`);
    } else if (card.cluster.status === 'address') {
      setStatus('cluster', 'warning', card.cluster.name || 'Район указан в адресе', 'Это предварительная подсказка. Подтвердите кластер точным определением координат.');
    } else if (card.cluster.status === 'outside') {
      setStatus('cluster', 'warning', 'Вне кластеров', 'Помещение не попало ни в один кластер.');
    } else {
      setStatus('cluster', 'neutral', 'Не определён', 'Укажите адрес и запустите определение.');
    }

    if (card.cluster.hasSlogiCenter === true) {
      setStatus('center', 'danger', 'Кластер занят', card.cluster.centerDetails || `В кластере уже есть открытый центр Слоги.${clusterSource}`);
    } else if (card.cluster.hasSlogiCenter === false) {
      setStatus('center', 'success', 'Кластер свободен', `Открытого центра Слоги в кластере нет.${clusterSource}`);
    } else {
      setStatus('center', 'neutral', 'Нет данных', 'Наличие центра ещё не определено.');
    }

    const rank = card.competitive.rank;
    const ratingSuffix = card.competitive.rating == null ? '' : ` · рейтинг ${formatNumber(card.competitive.rating, 1)}`;
    if (card.competitive.isTop30 === true) {
      setStatus('ranking', 'success', rank == null ? 'Входит в ТОП-30' : `${formatNumber(rank, 0)} место`, `Кластер входит в ТОП-30${ratingSuffix}.${competitiveSource}`);
    } else if (card.competitive.isTop30 === false) {
      setStatus('ranking', 'danger', rank == null ? 'Не входит в ТОП-30' : `${formatNumber(rank, 0)} место`, `Кластер не проходит условие ТОП-30${ratingSuffix}.${competitiveSource}`);
    } else {
      setStatus('ranking', 'neutral', 'Нет данных', 'Загрузите конкурентный анализ для проверки.');
    }
  }

  function renderEconomy(evaluation) {
    const computed = evaluation.computed || {};
    const rentPerSqm = numberOrNull(computed.rentPerSqm);
    const average = numberOrNull(computed.averageRentPerSqm);
    const deviation = numberOrNull(computed.deviationPercent);
    state.dialog.querySelector('[data-value="rent-per-sqm"]').textContent = rentPerSqm == null ? '—' : `${formatMoney(rentPerSqm)} / м²`;
    state.dialog.querySelector('[data-value="average-rent"]').textContent = average == null ? '—' : `${formatMoney(average)} / м²`;
    const delta = state.dialog.querySelector('[data-delta]');
    const deltaValue = delta.querySelector('[data-value="rent-delta"]');
    const deltaCopy = delta.querySelector('p');
    delta.dataset.tone = 'neutral';
    if (deviation == null) {
      deltaValue.textContent = '—';
      deltaCopy.textContent = 'Нет данных для сравнения';
    } else if (Math.abs(deviation) < 0.05) {
      deltaValue.textContent = 'На уровне средней';
      deltaCopy.textContent = 'Отклонение менее 0,1%';
    } else {
      const above = deviation > 0;
      delta.dataset.tone = above ? 'danger' : 'success';
      deltaValue.textContent = `${formatNumber(Math.abs(deviation), 1)}% ${above ? 'выше' : 'ниже'}`;
      deltaCopy.textContent = above ? 'Текущее помещение дороже среднего' : 'Текущее помещение дешевле среднего';
    }
  }

  function renderReadiness(evaluation) {
    const title = state.dialog.querySelector('[data-readiness-title]');
    const list = state.dialog.querySelector('[data-reasons]');
    const takeButton = state.dialog.querySelector('[data-action="take-to-work"]');
    const reasons = Array.from(new Set((evaluation.reasons || []).concat(evaluation.missing || []))).filter(Boolean);
    title.textContent = evaluation.canTakeToWork ? 'Помещение готово к работе' : 'Нельзя взять в работу';
    title.closest('.ss-card-readiness').dataset.ready = evaluation.canTakeToWork ? 'true' : 'false';
    list.innerHTML = evaluation.canTakeToWork
      ? '<li>Кластер свободен, входит в ТОП-30, обязательные параметры заполнены.</li>'
      : reasons.map((reason) => `<li>${escapeHtml(reason)}</li>`).join('');
    takeButton.disabled = !evaluation.canTakeToWork || Boolean(state.busy);
    takeButton.setAttribute('aria-disabled', String(takeButton.disabled));
    const help = state.dialog.querySelector('[data-take-help]');
    help.textContent = evaluation.canTakeToWork ? 'Все условия выполнены.' : (reasons.join(' ') || 'Условия перехода не выполнены.');
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
    sourceLabel.textContent = state.draft.source === 'parsed' ? 'Получено из парсинга · единая карточка' : 'Добавлено вручную · единая карточка';
    renderLocation(state.draft);
    renderEconomy(state.evaluation);
    renderReadiness(state.evaluation);
    renderResolution();
    const manualLocation = state.dialog.querySelector('[data-manual-location]');
    const manualMissing = state.draft.cluster.status !== 'inside'
      || state.draft.cluster.hasSlogiCenter == null
      || state.draft.competitive.rank == null
      || !(state.draft.competitive.averageRentPerSqm > 0);
    if (manualMissing) manualLocation.open = true;
    manualLocation.querySelector('[data-manual-summary]').textContent = manualMissing
      ? 'Заполните значения, которые не определились автоматически'
      : 'Автоматические данные получены — при необходимости их можно уточнить';
    const windowsOpen = state.dialog.querySelector('[data-windows-open]');
    windowsOpen.hidden = state.draft.hasWindows !== true;
    if (windowsOpen.hidden) setControl('windowsOpen', null);
    const deleteButton = state.dialog.querySelector('[data-action="delete"]');
    deleteButton.hidden = !(state.draft.id && typeof state.callbacks.onDelete === 'function');
    state.dialog.querySelectorAll('button').forEach((button) => {
      if (button.dataset.action === 'take-to-work') return;
      button.disabled = Boolean(state.busy);
    });
    const resolveButton = state.dialog.querySelector('[data-action="resolve-address"]');
    resolveButton.textContent = state.busy === 'resolve' ? 'Определяем…' : 'Определить';
  }

  function syncFromForm(event) {
    const target = event && event.target;
    state.draft = collectDraft({
      cluster: Boolean(target && target.closest && target.closest('[data-manual-cluster]')),
      competitive: Boolean(target && target.closest && target.closest('[data-manual-competitive]'))
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
        state.draft.cluster = { id: '', name: '', status: 'not_computed', matched: null, resolutionSource: null, hasSlogiCenter: null, centerDetails: '' };
        state.draft.competitive = { rating: null, rank: null, isTop30: null, resolutionSource: null, averageRentPerSqm: null };
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
    state.opener = document.activeElement;
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
