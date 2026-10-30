(function repairDocumentsXlsxModule(root, factory) {
  'use strict';

  const repairEstimate = typeof module === 'object' && module.exports
    ? require('./repair-estimate.js')
    : null;
  const api = factory(() => repairEstimate || (root && root.SlogiRepairEstimate));

  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SlogiRepairDocumentsXlsx = api;
})(typeof window !== 'undefined' ? window : globalThis, function repairDocumentsXlsxFactory(getRepairEstimate) {
  'use strict';

  const MIME_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  const DOCUMENT_KINDS = Object.freeze([
    'customOrders',
    'repairRoadmap',
    'purchaseSpecification',
    'paymentSchedule',
    'fullEstimate'
  ]);
  const DOCUMENT_TITLES = Object.freeze({
    customOrders: 'Список заказных позиций',
    repairRoadmap: 'ДК ремонта',
    purchaseSpecification: 'Полная спецификация для закупок',
    paymentSchedule: 'График и форма платежей',
    fullEstimate: 'Полная смета ремонта'
  });
  const SUBSECTION_LABELS = Object.freeze({
    furniture: 'Мебель',
    equipment: 'Оснащение',
    finishing: 'Отделка',
    work: 'Работа'
  });

  const text = value => String(value == null ? '' : value).trim();
  const finite = value => {
    if (value == null || text(value) === '') return null;
    const parsed = Number(String(value).replace(/\s+/g, '').replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : null;
  };
  const escapeXml = value => String(value == null ? '' : value)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
  const columnName = index => {
    let result = '';
    for (let cursor = Number(index) + 1; cursor > 0; cursor = Math.floor((cursor - 1) / 26)) {
      result = String.fromCharCode(65 + ((cursor - 1) % 26)) + result;
    }
    return result;
  };
  const safeSheetName = value => {
    const cleaned = text(value).replace(/[\[\]:*?/\\]/g, ' ').replace(/\s+/g, ' ').slice(0, 31).trim();
    return cleaned || 'Документ';
  };
  const safeFileStem = value => {
    const cleaned = text(value)
      .replace(/[<>:"/\\|?*\u0000-\u001F]/g, ' ')
      .replace(/\s+/g, ' ')
      .replace(/[. ]+$/g, '')
      .slice(0, 140)
      .trim();
    return cleaned || 'Документ';
  };
  const suggestedName = (title, options = {}) => {
    const suffix = text(options.address || options.objectName);
    const explicit = text(options.fileName || options.filename).replace(/\.xlsx$/i, '');
    return `${safeFileStem(explicit || `${title}${suffix ? ` — ${suffix}` : ''}`)}.xlsx`;
  };

  function estimateApi() {
    const api = getRepairEstimate();
    if (!api) throw new Error('Модуль сметы ремонта не загружен.');
    return api;
  }

  function resolveEstimate(source) {
    const api = estimateApi();
    if (source && source.phase0) return api.estimateOf(source);
    if (source && source.estimate) return api.normalizeEstimate(source.estimate);
    if (source && source.repair && source.repair.estimate) return api.normalizeEstimate(source.repair.estimate);
    if (source && Array.isArray(source.sections)) return api.normalizeEstimate(source);
    return null;
  }

  function resolvePack(source) {
    const api = estimateApi();
    if (source && source.phase0) return api.documentsOf(source);
    if (source && source.documentPack) return api.normalizeDocumentPack(source.documentPack);
    if (source && source.repair && source.repair.documentPack) return api.normalizeDocumentPack(source.repair.documentPack);
    if (source && source.documents) return api.normalizeDocumentPack(source);
    return null;
  }

  function resolveDocument(source, kind) {
    const requestedKind = text(kind || (source && source.kind));
    if (!DOCUMENT_KINDS.includes(requestedKind)) throw new Error('Неизвестный вид документа для экспорта.');
    if (source && source.kind === requestedKind && Array.isArray(source.rows)) {
      return estimateApi().normalizeGeneratedDocument(source, requestedKind);
    }
    const pack = resolvePack(source);
    const document = pack && pack.documents && pack.documents[requestedKind];
    if (!document) throw new Error('Сначала сформируйте выбранный документ.');
    return document;
  }

  function estimateRows(source) {
    const api = estimateApi();
    const estimate = resolveEstimate(source);
    if (!estimate) {
      const document = resolveDocument(source, 'fullEstimate');
      return (document.rows || []).map(row => Object.assign({}, row));
    }
    const calculated = api.calculateEstimate(estimate);
    return calculated.sections.flatMap(section => section.subsections.flatMap(subsection => subsection.items.map(item => ({
      sectionName: section.name,
      subsectionName: subsection.name || SUBSECTION_LABELS[subsection.kind] || subsection.kind,
      subsectionKind: subsection.kind,
      name: item.name,
      price: item.price,
      quantity: item.quantity,
      unit: item.unit,
      amount: item.amount,
      link: item.link,
      customMade: Boolean(item.customMade)
    }))));
  }

  function orderedFurnitureRows(source) {
    const api = estimateApi();
    const estimate = resolveEstimate(source);
    if (estimate) return api.customFurniture(estimate);
    try {
      return resolveDocument(source, 'customOrders').rows || [];
    } catch (_error) {
      return estimateRows(source).filter(row => row.subsectionKind === 'furniture' && row.customMade);
    }
  }

  const valueOf = (row, getter) => typeof getter === 'function' ? getter(row) : row && row[getter];
  const stringCell = (reference, value, style = 1) => `<c r="${reference}" t="inlineStr" s="${style}"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
  const numberCell = (reference, value, style = 2) => {
    const parsed = finite(value);
    return parsed == null ? stringCell(reference, '', style) : `<c r="${reference}" s="${style}"><v>${parsed}</v></c>`;
  };

  function sheetXml(config) {
    const columns = config.columns;
    const rows = Array.isArray(config.rows) ? config.rows : [];
    const info = Array.isArray(config.info) ? config.info.filter(item => text(item && item.label) || text(item && item.value)) : [];
    const lastColumn = columnName(Math.max(columns.length - 1, 0));
    const xmlRows = [];
    const merges = [];
    let rowNumber = 1;

    merges.push(`A1:${lastColumn}1`);
    xmlRows.push(`<row r="1" ht="28" customHeight="1">${stringCell('A1', config.title, 3)}</row>`);
    rowNumber += 1;

    info.forEach(item => {
      merges.push(`A${rowNumber}:${lastColumn}${rowNumber}`);
      xmlRows.push(`<row r="${rowNumber}">${stringCell(`A${rowNumber}`, `${item.label}: ${item.value}`, 4)}</row>`);
      rowNumber += 1;
    });

    if (info.length) {
      xmlRows.push(`<row r="${rowNumber}"/>`);
      rowNumber += 1;
    }

    const headerRow = rowNumber;
    xmlRows.push(`<row r="${rowNumber}" ht="25" customHeight="1">${columns.map((column, index) => stringCell(`${columnName(index)}${rowNumber}`, column.label, 5)).join('')}</row>`);
    rowNumber += 1;

    rows.forEach(row => {
      const cells = columns.map((column, index) => {
        const reference = `${columnName(index)}${rowNumber}`;
        const value = valueOf(row, column.value);
        return column.type === 'number' ? numberCell(reference, value, 2) : stringCell(reference, value, 1);
      }).join('');
      xmlRows.push(`<row r="${rowNumber}">${cells}</row>`);
      rowNumber += 1;
    });

    if (config.total != null) {
      const totalColumn = Math.max(0, Number(config.totalColumn == null ? columns.length - 1 : config.totalColumn));
      if (totalColumn > 0) merges.push(`A${rowNumber}:${columnName(totalColumn - 1)}${rowNumber}`);
      xmlRows.push(`<row r="${rowNumber}" ht="24" customHeight="1">${stringCell(`A${rowNumber}`, 'ИТОГО', 6)}${numberCell(`${columnName(totalColumn)}${rowNumber}`, config.total, 7)}</row>`);
      rowNumber += 1;
    }

    const lastRow = Math.max(1, rowNumber - 1);
    const widths = columns.map((column, index) => `<col min="${index + 1}" max="${index + 1}" width="${Number(column.width) || 16}" customWidth="1"/>`).join('');
    const mergeXml = merges.length ? `<mergeCells count="${merges.length}">${merges.map(reference => `<mergeCell ref="${reference}"/>`).join('')}</mergeCells>` : '';
    const filterEnd = rows.length ? headerRow + rows.length : headerRow;
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
      `<dimension ref="A1:${lastColumn}${lastRow}"/>` +
      `<sheetViews><sheetView workbookViewId="0"><pane ySplit="${headerRow}" topLeftCell="A${headerRow + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` +
      `<sheetFormatPr defaultRowHeight="19"/><cols>${widths}</cols><sheetData>${xmlRows.join('')}</sheetData>` +
      `<autoFilter ref="A${headerRow}:${lastColumn}${filterEnd}"/>${mergeXml}` +
      `<pageMargins left="0.3" right="0.3" top="0.5" bottom="0.5" header="0.2" footer="0.2"/>` +
      `</worksheet>`;
  }

  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<numFmts count="1"><numFmt numFmtId="164" formatCode="# ##0.00"/></numFmts>` +
    `<fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="14"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>` +
    `<fills count="5"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF37545A"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE7EFEF"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE19B2D"/><bgColor indexed="64"/></patternFill></fill></fills>` +
    `<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FFD8CBC0"/></left><right style="thin"><color rgb="FFD8CBC0"/></right><top style="thin"><color rgb="FFD8CBC0"/></top><bottom style="thin"><color rgb="FFD8CBC0"/></bottom><diagonal/></border></borders>` +
    `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
    `<cellXfs count="8">` +
    `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>` +
    `<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>` +
    `<xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right" vertical="top"/></xf>` +
    `<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>` +
    `<xf numFmtId="0" fontId="0" fillId="3" borderId="1" xfId="0" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>` +
    `<xf numFmtId="0" fontId="2" fillId="3" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>` +
    `<xf numFmtId="0" fontId="2" fillId="4" borderId="1" xfId="0"/>` +
    `<xf numFmtId="164" fontId="2" fillId="4" borderId="1" xfId="0" applyNumberFormat="1"/>` +
    `</cellXfs><cellStyles count="1"><cellStyle name="Обычный" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

  const crcTable = (() => {
    const table = new Uint32Array(256);
    for (let index = 0; index < 256; index += 1) {
      let value = index;
      for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? 0xEDB88320 ^ (value >>> 1) : value >>> 1;
      table[index] = value >>> 0;
    }
    return table;
  })();
  const crc32 = bytes => {
    let value = 0xFFFFFFFF;
    for (const byte of bytes) value = crcTable[(value ^ byte) & 0xFF] ^ (value >>> 8);
    return (value ^ 0xFFFFFFFF) >>> 0;
  };
  const u16 = value => {
    const bytes = new Uint8Array(2);
    new DataView(bytes.buffer).setUint16(0, value, true);
    return bytes;
  };
  const u32 = value => {
    const bytes = new Uint8Array(4);
    new DataView(bytes.buffer).setUint32(0, value >>> 0, true);
    return bytes;
  };
  const concat = parts => {
    const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
    let offset = 0;
    parts.forEach(part => { result.set(part, offset); offset += part.length; });
    return result;
  };
  const dosDateTime = date => {
    const source = date || new Date();
    const year = Math.max(1980, source.getFullYear());
    return {
      time: (source.getHours() << 11) | (source.getMinutes() << 5) | (source.getSeconds() >> 1),
      date: ((year - 1980) << 9) | ((source.getMonth() + 1) << 5) | source.getDate()
    };
  };

  function createZip(entries) {
    const encoder = new TextEncoder();
    const localParts = [];
    const centralParts = [];
    const timestamp = dosDateTime(new Date());
    let offset = 0;
    entries.forEach(entry => {
      const name = encoder.encode(entry.name);
      const data = typeof entry.data === 'string' ? encoder.encode(entry.data) : new Uint8Array(entry.data);
      const checksum = crc32(data);
      const flag = 0x0800;
      const local = concat([u32(0x04034b50), u16(20), u16(flag), u16(0), u16(timestamp.time), u16(timestamp.date), u32(checksum), u32(data.length), u32(data.length), u16(name.length), u16(0), name, data]);
      const central = concat([u32(0x02014b50), u16(20), u16(20), u16(flag), u16(0), u16(timestamp.time), u16(timestamp.date), u32(checksum), u32(data.length), u32(data.length), u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), name]);
      localParts.push(local);
      centralParts.push(central);
      offset += local.length;
    });
    const central = concat(centralParts);
    const end = concat([u32(0x06054b50), u16(0), u16(0), u16(entries.length), u16(entries.length), u32(central.length), u32(offset), u16(0)]);
    return concat(localParts.concat([central, end]));
  }

  function workbookBlob(config) {
    const sheetName = safeSheetName(config.sheetName || config.title);
    const worksheet = sheetXml(config);
    const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`;
    const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
    const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${escapeXml(sheetName)}" sheetId="1" r:id="rId1"/></sheets></workbook>`;
    const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
    const bytes = createZip([
      { name: '[Content_Types].xml', data: contentTypes },
      { name: '_rels/.rels', data: rootRels },
      { name: 'xl/workbook.xml', data: workbook },
      { name: 'xl/_rels/workbook.xml.rels', data: workbookRels },
      { name: 'xl/worksheets/sheet1.xml', data: worksheet },
      { name: 'xl/styles.xml', data: stylesXml }
    ]);
    return new Blob([bytes], { type: MIME_TYPE });
  }

  const estimateColumns = Object.freeze([
    { label: 'Раздел', value: row => row.sectionName || (Array.isArray(row.sections) ? row.sections.join(', ') : row.section || ''), width: 24 },
    { label: 'Подраздел', value: row => row.subsectionName || SUBSECTION_LABELS[row.subsectionKind] || row.subsectionKind || '', width: 18 },
    { label: 'Название', value: 'name', width: 44 },
    { label: 'Цена', value: 'price', type: 'number', width: 15 },
    { label: 'Количество', value: 'quantity', type: 'number', width: 13 },
    { label: 'Ед.', value: row => row.unit || 'шт.', width: 9 },
    { label: 'Стоимость', value: row => finite(row.amount) == null ? (finite(row.price) || 0) * (finite(row.quantity) || 0) : row.amount, type: 'number', width: 17 },
    { label: 'Ссылка', value: 'link', width: 42 },
    { label: 'На заказ', value: row => row.customMade ? 'Да' : 'Нет', width: 12 }
  ]);

  const documentColumns = Object.freeze({
    customOrders: estimateColumns,
    repairRoadmap: [
      { label: 'Дата', value: 'date', width: 15 },
      { label: 'Этап', value: 'name', width: 46 },
      { label: 'Статус', value: 'status', width: 18 },
      { label: 'Контрольная точка', value: row => row.controlPoint === false ? 'Нет' : 'Да', width: 20 }
    ],
    purchaseSpecification: estimateColumns,
    paymentSchedule: [
      { label: 'Дата', value: 'date', width: 15 },
      { label: 'Платёж', value: 'name', width: 42 },
      { label: 'Доля, %', value: 'percent', type: 'number', width: 13 },
      { label: 'Сумма', value: 'amount', type: 'number', width: 17 },
      { label: 'Форма оплаты', value: 'paymentForm', width: 24 },
      { label: 'Статус', value: 'status', width: 17 }
    ],
    fullEstimate: estimateColumns
  });

  function metadataInfo(meta = {}) {
    const entries = [
      ['Площадь, м²', meta.area],
      ['Высота потолков, м', meta.ceilingHeight],
      ['Количество кабинетов', meta.cabinetsCount],
      ['Количество санузлов', meta.restroomsCount],
      ['Начало ремонта', meta.startDate],
      ['Окончание ремонта', meta.endDate],
      ['Форма оплаты', meta.paymentForm]
    ];
    return entries.filter(([, value]) => value != null && text(value) !== '').map(([label, value]) => ({ label, value }));
  }

  function result(blob, fileName) {
    return Object.freeze({ blob, fileName, filename: fileName, mimeType: MIME_TYPE });
  }

  function exportFullEstimate(source, options = {}) {
    const rows = estimateRows(source);
    let meta = {};
    try { meta = resolveDocument(source, 'fullEstimate').meta || {}; } catch (_error) {
      const estimate = resolveEstimate(source) || {};
      meta = { area: estimate.area, ceilingHeight: estimate.ceilingHeight, cabinetsCount: estimate.cabinetsCount, restroomsCount: estimate.restroomsCount };
    }
    const total = rows.reduce((sum, row) => sum + (finite(row.amount) == null ? (finite(row.price) || 0) * (finite(row.quantity) || 0) : finite(row.amount)), 0);
    const title = text(options.title) || DOCUMENT_TITLES.fullEstimate;
    const blob = workbookBlob({ title, sheetName: options.sheetName || 'Полная смета', rows, columns: estimateColumns, info: metadataInfo(meta), total: Number(total.toFixed(2)), totalColumn: 6 });
    return result(blob, suggestedName(title, options));
  }

  function exportCustomFurniture(source, options = {}) {
    const rows = orderedFurnitureRows(source);
    const total = rows.reduce((sum, row) => sum + (finite(row.amount) == null ? (finite(row.price) || 0) * (finite(row.quantity) || 0) : finite(row.amount)), 0);
    const title = text(options.title) || DOCUMENT_TITLES.customOrders;
    const blob = workbookBlob({ title, sheetName: options.sheetName || 'Заказная мебель', rows, columns: estimateColumns, total: Number(total.toFixed(2)), totalColumn: 6 });
    return result(blob, suggestedName(title, options));
  }

  function exportDocument(source, kind, options) {
    let requestedKind = kind;
    let settings = options || {};
    if (kind && typeof kind === 'object') {
      settings = kind;
      requestedKind = source && source.kind;
    }
    requestedKind = text(requestedKind || (source && source.kind));
    const document = resolveDocument(source, requestedKind);
    // Экспорт конкретного документа должен учитывать ручные правки его строк,
    // а не заново вычислять данные из исходной сметы.
    if (requestedKind === 'fullEstimate') return exportFullEstimate(document, settings);
    if (requestedKind === 'customOrders') return exportCustomFurniture(document, settings);
    const title = text(settings.title) || document.title || DOCUMENT_TITLES[requestedKind];
    const total = requestedKind === 'paymentSchedule'
      ? document.rows.reduce((sum, row) => sum + (finite(row.amount) || 0), 0)
      : null;
    const blob = workbookBlob({
      title,
      sheetName: settings.sheetName || title,
      rows: document.rows,
      columns: documentColumns[requestedKind],
      info: metadataInfo(document.meta),
      total: total == null ? null : Number(total.toFixed(2)),
      totalColumn: requestedKind === 'paymentSchedule' ? 3 : undefined
    });
    return result(blob, suggestedName(title, settings));
  }

  return Object.freeze({
    MIME_TYPE,
    DOCUMENT_KINDS,
    DOCUMENT_TITLES,
    exportFullEstimate,
    exportCustomFurniture,
    exportDocument,
    createFullEstimate: exportFullEstimate,
    createCustomFurniture: exportCustomFurniture,
    createDocument: exportDocument,
    utils: Object.freeze({ escapeXml, safeFileStem, safeSheetName, createZip })
  });
});
