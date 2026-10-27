const DEFAULT_CATALOG = require('./catalog');
const BOOK_KEY = 'zjgBookV2';
const SNAPSHOT_INDEX_KEY = 'zjgSnapshotsV2';
const SNAPSHOT_PREFIX = 'zjgSnapshot:';
const CORRUPT_INDEX_KEY = 'zjgCorruptOriginalsV2';
const CORRUPT_PREFIX = 'zjgCorruptOriginal:';
const MAX_BOOK_BYTES = 900 * 1024;
const MAX_IMPORT_BYTES = 4 * 1024 * 1024;
const DEFAULT_SETTINGS = { shopName: '臻酒阁', lowStockThreshold: 3, defaultPaymentMethod: '微信' };
const LIMITS = { entries: 20000, stock: 5000, catalog: 10000, adjustments: 20000 };
const clone = value => JSON.parse(JSON.stringify(value));
const isObject = value => value && typeof value === 'object' && !Array.isArray(value);
const fail = message => { throw new Error(message); };
const now = () => new Date().toISOString();
const uid = prefix => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

function bytes(text) {
  let length = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 128) length++;
    else if (code < 2048) length += 2;
    else if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) { length += 4; i++; }
    else length += 3;
  }
  return length;
}

function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

function validTimestamp(value, label, required) {
  if (value === undefined && !required) return;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(value) || !validDate(value.slice(0, 10)) || !Number.isFinite(Date.parse(value))) fail(`${label}格式不正确`);
}

function text(value, label, required, max) {
  if (value === undefined || value === null) { if (required) fail(`${label}不能为空`); return; }
  if (typeof value !== 'string' || value.length > (max || 160) || (required && !value.trim())) fail(`${label}格式不正确`);
}

function integer(value, label, max) {
  if (!Number.isSafeInteger(value) || value < 0 || value > (max || 1000000000)) fail(`${label}须为有效的非负整数`);
}

function money(value, label, positive) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < (positive ? 0.01 : 0) || value > 999999999 || Math.abs(value * 100 - Math.round(value * 100)) > 0.0001) fail(`${label}须为最多两位小数的有效金额`);
}

function uniqueIds(items, label) {
  const seen = new Set();
  items.forEach(item => { if (!isObject(item)) fail(`${label}格式不正确`); text(item.id, `${label}编号`, true); if (seen.has(item.id)) fail(`${label}编号重复`); seen.add(item.id); });
}

function validateBook(value) {
  if (!isObject(value) || value.schemaVersion !== 2) fail('备份版本不支持，请使用臻酒阁导出的备份');
  integer(value.revision, '数据版本', Number.MAX_SAFE_INTEGER);
  validTimestamp(value.updatedAt, '更新时间', true);
  ['entries', 'stock', 'catalog', 'adjustments'].forEach(key => { if (!Array.isArray(value[key]) || value[key].length > LIMITS[key]) fail('数据条目超出限制或格式不正确'); });
  if (!isObject(value.settings)) fail('账本设置格式不正确');
  text(value.settings.shopName, '店名', true, 40);
  integer(value.settings.lowStockThreshold, '低库存提醒值', 999999);
  text(value.settings.defaultPaymentMethod, '默认收付款方式', true, 40);
  uniqueIds(value.entries, '账目');
  value.entries.forEach(entry => {
    if (!['income', 'expense'].includes(entry.type)) fail('账目收支类型不正确');
    text(entry.name, '账目名称', true);
    text(entry.productId, '酒品编号', false);
    text(entry.category, '账目分类', false, 80);
    text(entry.note, '备注', false, 1000);
    text(entry.counterparty, '往来单位', false, 160);
    text(entry.paymentMethod, '收付款方式', false, 40);
    money(entry.amount, '账目金额', true);
    integer(entry.quantity, '账目瓶数');
    if (entry.type === 'income' && entry.quantity === 0) fail('售酒瓶数必须大于零');
    if (!validDate(entry.date)) fail('账目日期不正确');
    validTimestamp(entry.createdAt, '账目创建时间', false);
    validTimestamp(entry.updatedAt, '账目更新时间', false);
  });
  uniqueIds(value.stock, '酒品');
  const names = new Set();
  let inventoryCents = 0;
  value.stock.forEach(item => {
    text(item.name, '酒品名称', true);
    if (names.has(item.name)) fail('酒品名称重复');
    names.add(item.name);
    integer(item.count, '库存数量'); money(item.cost, '库存成本', false);
    const valuation = item.count * Math.round(item.cost * 100);
    inventoryCents += valuation;
    if (!Number.isSafeInteger(valuation) || !Number.isSafeInteger(inventoryCents)) fail('库存金额过大，请核对数量和成本');
    text(item.brand, '品牌', false, 160); text(item.bottle, '规格', false, 80);
    text(item.category, '酒品分类', false, 80); text(item.tag, '酒品标签', false, 80);
    if (item.salePrice !== undefined) money(item.salePrice, '参考售价', false);
    if (item.lowStockThreshold !== undefined && item.lowStockThreshold !== null && item.lowStockThreshold !== '') integer(item.lowStockThreshold, '低库存提醒值', 999999);
  });
  const catalogNames = new Set();
  value.catalog.forEach(name => { text(name, '酒名', true); if (catalogNames.has(name)) fail('酒名列表存在重复项'); catalogNames.add(name); });
  uniqueIds(value.adjustments, '盘点记录');
  value.adjustments.forEach(item => {
    text(item.productId, '盘点酒品编号', true); text(item.productName, '盘点酒名', true);
    integer(item.beforeCount, '盘点前数量'); integer(item.afterCount, '盘点后数量');
    if (!Number.isSafeInteger(item.delta) || item.delta !== item.afterCount - item.beforeCount) fail('盘点数量差额不正确');
    money(item.beforeCost, '盘点前成本', false); money(item.afterCost, '盘点后成本', false);
    text(item.note, '盘点说明', false, 1000);
    if (!validDate(item.date)) fail('盘点日期不正确');
    validTimestamp(item.createdAt, '盘点创建时间', true);
  });
  if (bytes(JSON.stringify(value)) > MAX_BOOK_BYTES) fail('本机账本已接近存储上限，请先导出备份再清理历史数据');
  return clone(value);
}

function emptyBook() {
  return { schemaVersion: 2, revision: 0, entries: [], stock: [], catalog: Array.from(new Set(DEFAULT_CATALOG)), adjustments: [], settings: { ...DEFAULT_SETTINGS }, updatedAt: now() };
}

function legacyArray(key) {
  const value = wx.getStorageSync(key);
  if (value === '' || value === undefined || value === null) return [];
  if (!Array.isArray(value)) fail('检测到旧版数据格式异常，请先保留数据并联系开发者');
  return clone(value);
}

function initBook() {
  const current = wx.getStorageSync(BOOK_KEY);
  if (current !== '' && current !== undefined && current !== null) return validateBook(current);
  const book = emptyBook();
  book.entries = legacyArray('cellarEntries').map(item => ({ ...item, id: String(item.id), amount: Number(item.amount), quantity: Number(item.quantity || 0) }));
  book.stock = legacyArray('cellarStock').map(item => ({ ...item, id: String(item.id), count: Number(item.count), cost: Number(item.cost) }));
  const catalog = legacyArray('cellarLiquorCatalog');
  book.catalog = Array.from(new Set([...book.catalog, ...catalog, ...book.stock.map(item => item.name)]));
  book.revision = 1;
  validateBook(book);
  wx.setStorageSync(BOOK_KEY, book);
  return clone(book);
}

function readBook() { return initBook(); }

function snapshotIndex() {
  const list = wx.getStorageSync(SNAPSHOT_INDEX_KEY);
  return Array.isArray(list) ? list.filter(item => isObject(item) && typeof item.id === 'string').slice(0, 5) : [];
}

function getSnapshots() {
  return snapshotIndex().map(item => {
    const book = wx.getStorageSync(`${SNAPSHOT_PREFIX}${item.id}`);
    try { return { ...item, book: validateBook(book) }; } catch (error) { return null; }
  }).filter(Boolean);
}

function keepSnapshot(book, reason) {
  const metadata = { id: uid('snapshot'), createdAt: now(), reason: reason || '保存前自动备份' };
  let index = snapshotIndex();
  const key = `${SNAPSHOT_PREFIX}${metadata.id}`;
  // One book per storage key keeps recovery points below WeChat's per-key size limit.
  while (true) {
    try { wx.setStorageSync(key, clone(book)); break; }
    catch (error) {
      if (!index.length) fail('本机存储空间不足，请先将备份导出后再操作');
      const removed = index.pop();
      wx.removeStorageSync(`${SNAPSHOT_PREFIX}${removed.id}`);
      wx.setStorageSync(SNAPSHOT_INDEX_KEY, index);
    }
  }
  const next = [metadata, ...index];
  try { wx.setStorageSync(SNAPSHOT_INDEX_KEY, next.slice(0, 5)); }
  catch (error) { wx.removeStorageSync(key); fail('无法保存恢复点，请检查本机存储空间'); }
  next.slice(5).forEach(item => wx.removeStorageSync(`${SNAPSHOT_PREFIX}${item.id}`));
  return metadata.id;
}

function writeBook(next, options) {
  const settings = options || {};
  const current = readBook();
  if (settings.expectedRevision !== undefined && settings.expectedRevision !== current.revision) fail('数据已变化，请刷新页面后重试');
  const value = validateBook({ ...clone(next), schemaVersion: 2, revision: current.revision + 1, updatedAt: now() });
  keepSnapshot(current, settings.reason);
  try { wx.setStorageSync(BOOK_KEY, value); }
  catch (error) { fail('保存失败，请检查本机存储空间后重试'); }
  return clone(value);
}

function createBackup() { return { app: 'zhenjiuge', schemaVersion: 2, exportedAt: now(), book: readBook() }; }

function restoreValidatedBook(candidate, reason) {
  // Explicit recovery can replace a damaged main book, after preserving the original.
  // Normal writes still call readBook() and stop rather than silently resetting data.
  const raw = wx.getStorageSync(BOOK_KEY);
  if (raw === '' || raw === undefined || raw === null) return writeBook(candidate, { reason });
  let current;
  try { current = validateBook(raw); } catch (error) { current = null; }
  if (current) return writeBook(candidate, { expectedRevision: current.revision, reason });
  const metadata = { id: uid('damaged'), createdAt: now(), reason: '恢复前保存损坏原稿' };
  const key = `${CORRUPT_PREFIX}${metadata.id}`;
  try { wx.setStorageSync(key, { createdAt: metadata.createdAt, sourceKey: BOOK_KEY, data: clone(raw) }); }
  catch (error) { fail('无法安全保存损坏原稿，当前数据未覆盖。请释放存储空间后重试'); }
  try {
    const previous = wx.getStorageSync(CORRUPT_INDEX_KEY);
    wx.setStorageSync(CORRUPT_INDEX_KEY, [metadata, ...(Array.isArray(previous) ? previous : [])]);
  } catch (error) { wx.removeStorageSync(key); fail('无法记录损坏原稿，当前数据未覆盖'); }
  const rawRevision = isObject(raw) && Number.isSafeInteger(raw.revision) && raw.revision >= 0 && raw.revision < Number.MAX_SAFE_INTEGER - 1 ? raw.revision : 0;
  const value = validateBook({ ...clone(candidate), revision: rawRevision + 1, updatedAt: now() });
  try { wx.setStorageSync(BOOK_KEY, value); }
  catch (error) { fail('恢复写入失败，损坏原稿已另存，原账本未覆盖'); }
  return clone(value);
}

function restoreBackup(input) {
  let data = input;
  if (typeof input === 'string') {
    if (bytes(input) > MAX_IMPORT_BYTES) fail('备份文件过大');
    try { data = JSON.parse(input.replace(/^\uFEFF/, '')); } catch (error) { fail('备份文件不是有效的 JSON'); }
  }
  if (!isObject(data) || data.app !== 'zhenjiuge' || data.schemaVersion !== 2) fail('请选择臻酒阁导出的 JSON 备份文件');
  const candidate = validateBook(data.book);
  return restoreValidatedBook(candidate, '导入备份前的恢复点');
}

function restoreSnapshot(id) {
  const point = getSnapshots().find(item => item.id === id);
  if (!point) fail('这个恢复点已不存在');
  return restoreValidatedBook(point.book, '恢复历史数据前的恢复点');
}

function csvCell(value) {
  let textValue = value === undefined || value === null ? '' : String(value);
  if (typeof value !== 'number' && /^[\s]*[=+\-@]/.test(textValue)) textValue = `'${textValue}`;
  return `"${textValue.replace(/"/g, '""')}"`;
}

function exportCsv(entries) {
  const rows = Array.isArray(entries) ? entries : readBook().entries;
  const header = ['日期', '收支类型', '酒品或项目', '分类', '瓶数', '金额（元）', '往来单位', '收付款方式', '备注'];
  return '\uFEFF' + [header, ...rows.map(item => [item.date, item.type === 'income' ? '收入' : '支出', item.name, item.category || '', item.quantity, item.amount, item.counterparty || '', item.paymentMethod || '', item.note || ''])].map(row => row.map(csvCell).join(',')).join('\r\n');
}

function clearData(mode) {
  if (!['entries', 'all'].includes(mode)) fail('请选择正确的清理方式');
  const book = readBook();
  book.entries = [];
  if (mode === 'all') { book.stock = book.stock.map(item => ({ ...item, count: 0, cost: 0 })); book.adjustments = []; }
  return writeBook(book, { expectedRevision: book.revision, reason: '清理数据前的恢复点' });
}

module.exports = { initBook, readBook, writeBook, createBackup, restoreBackup, getSnapshots, restoreSnapshot, exportCsv, clearData, validateBook, validDate, DEFAULT_SETTINGS, BOOK_KEY };
