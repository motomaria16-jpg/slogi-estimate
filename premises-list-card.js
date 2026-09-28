(function premisesListCardModule(root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SlogiPremisesListCard = api;
})(typeof window !== 'undefined' ? window : globalThis, function premisesListCardFactory() {
  'use strict';

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>'"]/g, character => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    })[character]);
  }

  function number(value) {
    if (value == null || String(value).trim() === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function money(value) {
    const amount = number(value);
    return amount == null ? 'Аренда не указана' : `${Math.round(amount).toLocaleString('ru-RU')} ₽`;
  }

  function area(value) {
    const amount = number(value);
    return amount == null ? 'Площадь не указана' : `${amount.toLocaleString('ru-RU', { maximumFractionDigits: 1 })} м²`;
  }

  function floor(value, total) {
    const level = number(value);
    const count = number(total);
    return level == null ? 'Этаж не указан' : `Этаж ${level}${count == null ? '' : ` из ${count}`}`;
  }

  function ceiling(value) {
    const height = number(value);
    return height == null ? 'Высота не указана' : `Потолки ${height.toLocaleString('ru-RU', { maximumFractionDigits: 2 })} м`;
  }

  function attributes(values) {
    return Object.entries(values || {}).filter(([, value]) => value != null && value !== false).map(([name, value]) => {
      const safeName = String(name).replace(/[^a-zA-Z0-9_:\-.]/g, '');
      return safeName ? ` ${safeName}="${esc(value === true ? '' : value)}"` : '';
    }).join('');
  }

  function badgesHtml(badges) {
    return (Array.isArray(badges) ? badges : []).filter(item => item && item.text).map(item =>
      `<span class="premises-card__badge cian-badge${item.tone ? ` is-${esc(item.tone)} ${esc(item.tone)}` : ''}">${esc(item.text)}</span>`
    ).join('');
  }

  function render(options) {
    const value = options && typeof options === 'object' ? options : {};
    const title = value.title || value.address || 'Коммерческое помещение';
    const metrics = Array.isArray(value.metrics) && value.metrics.length ? value.metrics : [
      area(value.area), floor(value.floor, value.totalFloors), ceiling(value.ceilingHeight)
    ];
    const rentPerSqm = number(value.pricePerSqm);
    const articleClass = String(value.articleClass || '').trim();
    const openClass = String(value.openClass || '').trim();
    const actionsClass = String(value.actionsClass || '').trim();
    return `<article class="premises-card${value.selected ? ' selected' : ''}${articleClass ? ` ${esc(articleClass)}` : ''}"${attributes(value.articleAttributes)}>` +
      `<button class="premises-card__open cian-card-open${openClass ? ` ${esc(openClass)}` : ''}" type="button"${attributes(value.openAttributes)} aria-label="${esc(value.openLabel || `Открыть карточку ${title}`)}">` +
        '<div class="premises-card__main cian-card-main">' +
          `<div class="premises-card__badges cian-card-top">${badgesHtml(value.badges)}</div>` +
          `<h3>${esc(title)}</h3><p class="premises-card__address cian-address">${esc(value.address || 'Адрес не указан')}</p>` +
          `<div class="premises-card__metrics cian-card-metrics">${metrics.map(metric => `<span>${esc(metric)}</span>`).join('')}</div>` +
        '</div>' +
        `<div class="premises-card__price cian-card-price"><strong>${esc(money(value.rentMonthly))}</strong><span>${rentPerSqm == null ? 'Цена за м² не рассчитана' : `${esc(money(rentPerSqm))} / м²`}</span></div>` +
      '</button>' +
      (value.contextHtml ? `<div class="premises-card__context">${value.contextHtml}</div>` : '') +
      `<div class="premises-card__actions${actionsClass ? ` ${esc(actionsClass)}` : ''}" role="group" aria-label="${esc(value.actionsLabel || 'Действия с помещением')}">${value.actionsHtml || ''}</div>` +
    '</article>';
  }

  return Object.freeze({ render, esc, money, area, floor, ceiling });
});
