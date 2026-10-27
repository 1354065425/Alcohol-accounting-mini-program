const test = require('node:test');
const assert = require('node:assert/strict');
const store = require('../utils/store');
const core = require('../utils/bookkeeping');
const copy = value => JSON.parse(JSON.stringify(value));
let memory, failKey, failPrefix;

function setup(initial) {
  memory = new Map(Object.entries(copy(initial || {})));
  failKey = '';
  failPrefix = '';
  global.wx = {
    getStorageSync: key => memory.has(key) ? copy(memory.get(key)) : '',
    setStorageSync: (key, value) => { if (key === failKey || (failPrefix && key.startsWith(failPrefix))) throw new Error('disk full'); memory.set(key, copy(value)); },
    removeStorageSync: key => memory.delete(key)
  };
}

function product(name, count, cost) {
  return core.saveProduct({ name, count: count || 0, cost: cost || 0, category: '白酒', brand: '测试品牌', bottle: '500ml' }).stock.find(item => item.name === name);
}

function entry(item, type, quantity, amount, extra) {
  return { type, productId: item ? item.id : null, name: item ? item.name : '房租', quantity, amount, date: '2026-10-26', note: '', ...(extra || {}) };
}

test('fresh installs start empty and old storage migrates without changing source keys', () => {
  setup();
  let book = store.initBook();
  assert.equal(book.entries.length, 0); assert.equal(book.stock.length, 0); assert.ok(book.catalog.length > 100);
  assert.equal(book.settings.shopName, '臻酒阁'); assert.equal(book.settings.lowStockThreshold, 3);
  const old = { cellarEntries: [{ id: 'sale', type: 'income', name: '五粮液·普五', amount: 100, quantity: 1, date: '2026-10-25', category: '售酒' }], cellarStock: [{ id: 'wuliangye', name: '普五·第八代', count: 7, cost: 80 }], cellarLiquorCatalog: ['自定义老酒'] };
  setup(old); book = store.initBook();
  assert.deepEqual(book.entries, old.cellarEntries); assert.deepEqual(book.stock, old.cellarStock);
  assert.ok(book.catalog.includes('自定义老酒'));
  assert.deepEqual(memory.get('cellarEntries'), old.cellarEntries);
  assert.equal(core.productForEntry(book.entries[0], book.stock).id, 'wuliangye');
  assert.deepEqual(store.initBook(), book);
});

test('malformed old or current data stops safely without discarding records', () => {
  setup({ cellarEntries: { wrong: true } });
  assert.throws(() => store.initBook(), /旧版数据格式/); assert.equal(memory.has(store.BOOK_KEY), false);
  setup({ [store.BOOK_KEY]: { schemaVersion: 999, entries: ['kept'] } });
  assert.throws(() => store.readBook(), /版本不支持/); assert.deepEqual(memory.get(store.BOOK_KEY).entries, ['kept']);
});

test('entry edits apply net quantity, preserve IDs and do not duplicate deductions', () => {
  setup(); const a = product('甲酒', 10, 100), b = product('乙酒', 8, 80);
  let book = core.saveEntry(entry(a, 'income', 2, 300)); const original = book.entries[0];
  assert.equal(book.stock.find(item => item.id === a.id).count, 8);
  book = core.saveEntry({ ...original, amount: 350 }, original.id, { originalEntry: original });
  assert.equal(book.entries.length, 1); assert.equal(book.stock.find(item => item.id === a.id).count, 8);
  book = core.saveEntry({ ...book.entries[0], quantity: 3 }, original.id);
  assert.equal(book.stock.find(item => item.id === a.id).count, 7);
  book = core.saveEntry({ ...book.entries[0], name: b.name, productId: b.id }, original.id);
  assert.equal(book.stock.find(item => item.id === a.id).count, 10);
  assert.equal(book.stock.find(item => item.id === b.id).count, 5);
  book = core.deleteEntry(original.id);
  assert.equal(book.entries.length, 0); assert.equal(book.stock.find(item => item.id === b.id).count, 8);
});

test('purchases, expenses, type switches and weighted costs use valid cents', () => {
  setup(); const a = product('分币酒', 1, 0.1);
  let book = core.saveEntry(entry(a, 'expense', 2, 0.2));
  assert.equal(book.stock[0].count, 3); assert.equal(book.stock[0].cost, 0.1);
  let record = book.entries[0];
  book = core.saveEntry({ ...record, amount: 0.3 }, record.id);
  assert.equal(book.stock[0].count, 3); assert.equal(book.stock[0].cost, 0.1);
  book = core.saveEntry({ ...book.entries[0], type: 'income', quantity: 1, amount: 1 }, record.id);
  assert.equal(book.stock[0].count, 0);
  book = core.saveEntry(entry(null, 'expense', 0, 500));
  assert.equal(book.stock[0].count, 0); assert.equal(book.entries[0].productId, null);
});

test('negative stock, invalid money, fractional quantity, missing or stale records never commit', () => {
  setup(); const a = product('甲酒', 2, 100); let before = store.readBook();
  assert.throws(() => core.saveEntry(entry(a, 'income', 3, 100)), /库存不足/);
  assert.deepEqual(store.readBook(), before);
  assert.throws(() => core.saveEntry(entry(a, 'income', 1.5, 100)), /非负整数/);
  assert.throws(() => core.saveEntry(entry(a, 'income', 1, 0.001)), /有效金额/);
  let book = core.saveEntry(entry(a, 'expense', 3, 300)); const record = book.entries[0];
  core.adjustStock(a.id, 1, 100, '盘点少货'); before = store.readBook();
  assert.throws(() => core.deleteEntry(record.id), /库存不足/); assert.deepEqual(store.readBook(), before);
  assert.throws(() => core.saveEntry(entry(a, 'income', 1, 100), 'missing'), /不存在/);
  assert.throws(() => core.saveEntry({ ...record, amount: 500 }, record.id, { originalEntry: { ...record, note: 'changed' } }), /已变化/);
  assert.throws(() => core.saveEntry(entry(a, 'income', 1, 100), null, { expectedRevision: 0 }), /已变化/);
  assert.throws(() => product('异常估值', 1000000000, 999999999), /库存金额过大/);
});

test('stock corrections are audited and renaming updates linked records without changing money', () => {
  setup(); const a = product('输错的酒', 10, 20); let book = core.saveEntry(entry(a, 'income', 1, 30));
  const priorAdjustments = book.adjustments.length;
  book = core.saveProduct({ ...book.stock[0], name: '正确酒名' });
  assert.equal(book.entries[0].name, '正确酒名'); assert.equal(book.entries[0].amount, 30);
  assert.equal(book.adjustments.length, priorAdjustments); assert.equal(book.catalog.includes('输错的酒'), false);
  assert.throws(() => core.saveProduct({ ...book.stock[0], count: 8 }), /调整原因/);
  book = core.adjustStock(a.id, 7, 22, '实物盘点');
  assert.equal(book.adjustments[0].beforeCount, 9); assert.equal(book.adjustments[0].afterCount, 7);
  assert.equal(book.adjustments[0].delta, -2); assert.equal(book.adjustments[0].note, '实物盘点');
  product('另一个酒', 0, 0);
  assert.throws(() => core.saveProduct({ ...book.stock[0], name: '另一个酒' }), /已经存在/);
});

test('writes are atomic, revision checked, and only five independent recovery points are kept', () => {
  setup(); let book = store.initBook(); const originalRevision = book.revision;
  for (let i = 0; i < 8; i++) { book.settings.shopName = `店名${i}`; book = store.writeBook(book, { expectedRevision: book.revision }); }
  assert.equal(book.revision, originalRevision + 8); assert.equal(store.getSnapshots().length, 5);
  assert.equal(Array.from(memory.keys()).filter(key => key.startsWith('zjgSnapshot:')).length, 5);
  assert.throws(() => store.writeBook(book, { expectedRevision: originalRevision }), /已变化/);
  const before = store.readBook(); failKey = store.BOOK_KEY;
  assert.throws(() => store.writeBook({ ...book, settings: { ...book.settings, shopName: '不会保存' } }), /保存失败/);
  assert.deepEqual(store.readBook(), before); failKey = '';
});

test('backup restores preserve data and reject invalid dates, money, IDs and schema', () => {
  setup(); const a = product('备份酒', 6, 18); core.saveEntry(entry(a, 'income', 1, 40));
  const backup = store.createBackup();
  store.clearData('all'); let book = store.restoreBackup(JSON.stringify(backup));
  assert.equal(book.entries.length, 1); assert.equal(book.stock[0].count, 5);
  assert.ok(store.getSnapshots().some(item => item.reason.includes('导入备份前')));
  const invalid = copy(backup); invalid.book.entries[0].date = '2026-02-30'; assert.throws(() => store.restoreBackup(invalid), /日期/);
  invalid.book.entries[0].date = '2026-10-26'; invalid.book.entries[0].amount = -2; assert.throws(() => store.restoreBackup(invalid), /金额/);
  invalid.book.entries[0].amount = 2; invalid.book.entries.push(copy(invalid.book.entries[0])); assert.throws(() => store.restoreBackup(invalid), /编号重复/);
  assert.throws(() => store.restoreBackup('{bad json'), /JSON/);
  assert.throws(() => store.restoreBackup({ ...backup, app: 'other' }), /臻酒阁/);
  assert.equal(store.readBook().entries.length, 1);
});

test('clear modes preserve liquor names and can be recovered without demo data returning', () => {
  setup(); const a = product('自定义酒', 10, 20); core.saveEntry(entry(a, 'income', 1, 30));
  let book = store.clearData('entries'); assert.equal(book.entries.length, 0); assert.equal(book.stock[0].count, 9);
  book = store.clearData('all'); assert.equal(book.stock[0].count, 0); assert.equal(book.stock[0].cost, 0);
  assert.ok(book.catalog.includes('自定义酒')); assert.equal(store.initBook().entries.length, 0);
  const point = store.getSnapshots().find(item => item.book.entries.length === 1);
  book = store.restoreSnapshot(point.id); assert.equal(book.entries.length, 1); assert.equal(book.stock[0].count, 9);
});

test('explicit recovery rescues damaged main data only after safely archiving the original', () => {
  setup(); const a = product('恢复酒', 8, 30); core.saveEntry(entry(a, 'income', 1, 50));
  const backup = store.createBackup();
  const damaged = { ...copy(backup.book), revision: 9, entries: '损坏数据请保留' };
  memory.set(store.BOOK_KEY, copy(damaged));
  assert.throws(() => store.readBook(), /数据条目/);
  assert.throws(() => store.writeBook(backup.book), /数据条目/);
  const recovered = store.restoreBackup(backup);
  assert.equal(recovered.stock[0].count, 7); assert.equal(recovered.entries.length, 1);
  const archiveKey = Array.from(memory.keys()).find(key => key.startsWith('zjgCorruptOriginal:'));
  assert.deepEqual(memory.get(archiveKey).data, damaged);
  const point = store.getSnapshots()[0];
  memory.set(store.BOOK_KEY, copy(damaged));
  assert.doesNotThrow(() => store.restoreSnapshot(point.id));
  assert.equal(store.readBook().schemaVersion, 2);
});

test('recovery refuses overwrite if damaged-original storage fails', () => {
  setup(); store.initBook(); const backup = store.createBackup();
  const damaged = { schemaVersion: 1, keep: '原账目' };
  memory.set(store.BOOK_KEY, copy(damaged)); failPrefix = 'zjgCorruptOriginal:';
  assert.throws(() => store.restoreBackup(backup), /当前数据未覆盖/);
  assert.deepEqual(memory.get(store.BOOK_KEY), damaged);
  failPrefix = ''; failKey = 'zjgCorruptOriginalsV2';
  assert.throws(() => store.restoreBackup(backup), /当前数据未覆盖/);
  assert.deepEqual(memory.get(store.BOOK_KEY), damaged);
  assert.equal(Array.from(memory.keys()).filter(key => key.startsWith('zjgCorruptOriginal:')).length, 0);
});

test('CSV handles Chinese text, separators, multiline notes and spreadsheet formula injection', () => {
  setup();
  const csv = store.exportCsv([{ date: '2026-10-26', type: 'expense', name: '=HYPERLINK("bad")', category: '测试', quantity: 0, amount: 20, counterparty: '+命令', paymentMethod: '现金', note: '一行,二行\n"引用"' }]);
  assert.ok(csv.startsWith('\uFEFF'));
  assert.ok(csv.includes("'=HYPERLINK")); assert.ok(csv.includes("'+命令"));
  assert.ok(csv.includes('一行,二行\n""引用""')); assert.ok(csv.includes('"20"'));
});
