const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

class FixedDate extends Date {
  constructor(...args) { super(...(args.length ? args : ['2026-10-26T12:00:00+08:00'])); }
}
function mount(pageName, book) {
  let page, timer;
  const routes = [],packetSizes=[];
  const clone = value => JSON.parse(JSON.stringify(value));
  const wx = { navigateTo: value => routes.push(value.url), stopPullDownRefresh() {} };
  const source = fs.readFileSync(path.join(__dirname, '..', 'pages', pageName, `${pageName}.js`), 'utf8');
  vm.runInNewContext(source, {
    Date: FixedDate, wx, Page: config => { page = config; },
    require: name => { assert.equal(name, '../../utils/store'); return { readBook: () => clone(book) }; },
    setTimeout: callback => { timer = callback; return 1; }, clearTimeout: () => { timer = null; }
  });
  page.data = clone(page.data);
  page.setData = values => {packetSizes.push(Buffer.byteLength(JSON.stringify(values),'utf8'));Object.assign(page.data, values);};
  return { page, routes,packetSizes, flush: () => { if (timer) timer(); } };
}
function makeBook() {
  return { entries: [
    { id:'a',date:'2026-10-26',type:'income',name:'甲酒',productId:'p1',amount:100.10,quantity:2,category:'售酒',counterparty:'张先生',note:'自提',paymentMethod:'微信' },
    { id:'b',date:'2026-10-26',type:'expense',name:'甲酒',productId:'p1',amount:60.20,quantity:3,category:'购酒' },
    { id:'c',date:'2026-10-01',type:'expense',name:'仓储',amount:20.30,quantity:0,category:'经营支出',note:'库房' },
    { id:'d',date:'2026-09-30',type:'income',name:'乙酒',amount:99,quantity:1,category:'售酒' },
    { id:'e',date:'2026-10-25',type:'income',name:'甲酒旧名称',productId:'p1',amount:50.20,quantity:1,category:'售酒',counterparty:'李女士' }
  ], stock: [{ id:'p1',name:'甲酒',count:2,cost:50.25 }] };
}

test('ledger date range is inclusive and money totals use integer cents', () => {
  const {page} = mount('ledger', makeBook());page.onLoad({});page.onShow();
  page.selectStart({detail:{value:'2026-10-01'}});page.selectEnd({detail:{value:'2026-10-26'}});
  assert.equal(page.data.filteredCount, 4);
  assert.equal(page.data.income, '150.30');assert.equal(page.data.expense, '80.50');assert.equal(page.data.balance, '69.80');
  assert.equal(page.data.groups[0].date, '2026-10-26');
});

test('ledger combines keyword and type and clearing keyword retains dates', () => {
  const {page} = mount('ledger', makeBook());page.onLoad({date:'2026-10-26'});page.onShow();
  page.inputKeyword({detail:{value:'张先生'}});page.searchNow();
  assert.equal(page.data.filteredCount,1);assert.equal(page.data.entries[0].id,'a');
  page.clearKeyword();assert.equal(page.data.filteredCount,2);assert.equal(page.data.startDate,'2026-10-26');
  page.changeType({currentTarget:{dataset:{type:'expense'}}});
  assert.equal(page.data.filteredCount,1);assert.equal(page.data.expense,'60.20');
});

test('ledger retains filters on return from editing and reflects moved date', () => {
  const book=makeBook(),{page}=mount('ledger',book);page.onLoad({date:'2026-10-26'});page.onShow();
  book.entries[0].date='2026-10-24';page.onShow();
  assert.equal(page.data.startDate,'2026-10-26');assert.equal(page.data.filteredCount,1);
  page.selectDate({detail:{value:'2026-10-23'}});assert.equal(page.data.filteredCount,0);assert.equal(page.data.income,'0.00');
  page.showToday();assert.equal(page.data.startDate,'2026-10-26');
  page.setData({startDate:'2026-10-25',endDate:'2026-10-25'});page.onShow();assert.equal(page.data.startDate,'2026-10-26');
  page.showAll();assert.equal(page.data.filteredCount,5);
});

test('ledger validates crossed date bounds and current-month route excludes future days', () => {
  const {page}=mount('ledger',makeBook());page.onLoad({month:'2026-10',type:'expense'});page.onShow();
  assert.equal(page.data.endDate,'2026-10-26');assert.equal(page.data.type,'expense');
  page.selectStart({detail:{value:'2026-10-27'}});assert.equal(page.data.endDate,'2026-10-27');
  page.selectEnd({detail:{value:'2026-10-01'}});assert.equal(page.data.startDate,'2026-10-01');
});

test('ledger uses bounded 100-row pages without changing total summaries', () => {
  const entries=Array.from({length:205},(_,i)=>({id:String(i),date:'2026-10-26',type:'income',name:'甲酒',amount:1,quantity:1}));
  const {page}=mount('ledger',{entries,stock:[]});page.onLoad({});page.onShow();
  const firstPageIds=new Set(page.data.entries.map(item=>item.id));
  assert.equal(page.data.visibleCount,100);assert.equal(page.data.filteredCount,205);assert.equal(page.data.income,'205.00');assert.equal(page.data.pageIndex,1);assert.equal(page.data.pageCount,3);assert.equal(page.data.hasPrevious,false);
  page.nextPage();assert.equal(page.data.visibleCount,100);assert.equal(page.data.pageIndex,2);assert.equal(page.data.rangeStart,101);assert.equal(page.data.rangeEnd,200);assert.equal(page.data.income,'205.00');
  assert.ok(page.data.entries.every(item=>!firstPageIds.has(item.id)));
  page.nextPage();assert.equal(page.data.visibleCount,5);assert.equal(page.data.pageIndex,3);assert.equal(page.data.hasNext,false);assert.equal(page.data.rangeEnd,205);
  page.nextPage();assert.equal(page.data.pageIndex,3);
  page.previousPage();assert.equal(page.data.pageIndex,2);assert.equal(page.data.visibleCount,100);
  page.changeType({currentTarget:{dataset:{type:'income'}}});assert.equal(page.data.pageIndex,1);assert.equal(page.data.visibleCount,100);
});

test('ledger preserves current page after editing and clamps it if the last page disappears', () => {
  const book={entries:Array.from({length:205},(_,i)=>({id:String(i),date:'2026-10-26',type:'income',name:'甲酒',amount:1,quantity:1})),stock:[]};
  const {page}=mount('ledger',book);page.onLoad({date:'2026-10-26'});page.onShow();page.nextPage();page.nextPage();
  page.onShow();assert.equal(page.data.pageIndex,3);assert.equal(page.data.visibleCount,5);
  book.entries=book.entries.slice(0,195);page.onShow();
  assert.equal(page.data.pageIndex,2);assert.equal(page.data.pageCount,2);assert.equal(page.data.visibleCount,95);assert.equal(page.data.startDate,'2026-10-26');assert.equal(page.data.income,'195.00');
});

test('ledger display packets stay below one megabyte with maximum-length fields and never copy hidden fields', () => {
  const entries=Array.from({length:150},(_,i)=>({
    id:String(i).padEnd(160,'酒'),date:'2026-10-26',type:'income',name:'酒'.repeat(160),amount:999999999,quantity:1000000000,
    category:'酒'.repeat(80),counterparty:'酒'.repeat(160),paymentMethod:'酒'.repeat(40),note:'酒'.repeat(1000),extension:'酒'.repeat(100)
  }));
  assert.ok(Buffer.byteLength(JSON.stringify(entries),'utf8')<900*1024);
  const {page,packetSizes}=mount('ledger',{entries,stock:[]});page.onLoad({});page.onShow();page.nextPage();page.previousPage();
  assert.equal(page.data.entries.length,100);assert.ok(page.data.entries.every(item=>item.detail.length<=160));
  assert.ok(page.data.entries.every(item=>!Object.hasOwn(item,'note')&&!Object.hasOwn(item,'extension')));
  assert.ok(packetSizes.every(size=>size<1024*1024));
});

test('report separates purchase and operating expenses and groups sales by stable product ID', () => {
  const {page}=mount('report',makeBook());page.onShow();
  assert.equal(page.data.income,'150.30');assert.equal(page.data.expense,'80.50');assert.equal(page.data.purchase,'60.20');assert.equal(page.data.operating,'20.30');
  assert.equal(page.data.balance,'69.80');assert.equal(page.data.soldBottles,3);assert.equal(page.data.transactionCount,4);
  assert.equal(page.data.categories.length,1);assert.equal(page.data.categories[0].name,'甲酒');assert.equal(page.data.categories[0].amount,'150.30');
  assert.equal(page.data.operatingEntries[0].name,'仓储');assert.equal(page.data.stockValue,'100.50');
});

test('report chart uses selected month, allows historical month navigation and blocks future months', () => {
  const {page}=mount('report',makeBook());page.onShow();
  assert.equal(page.data.chartBars.length,7);assert.equal(page.data.chartBars[0].date,'2026-10-20');
  assert.equal(page.data.chartBars[6].income,'100.10');assert.equal(page.data.chartBars[6].incomeHeight,140);
  page.selectChart({currentTarget:{dataset:{mode:'month'}}});assert.equal(page.data.chartBars.length,26);
  page.moveMonth({currentTarget:{dataset:{delta:1}}});assert.equal(page.data.month,'2026-10');
  page.moveMonth({currentTarget:{dataset:{delta:-1}}});assert.equal(page.data.month,'2026-09');assert.equal(page.data.chartBars.length,30);assert.equal(page.data.income,'99.00');
});

test('report handles empty months and routes to filtered ledger and data management', () => {
  const {page,routes}=mount('report',makeBook());page.onShow();page.selectMonth({detail:{value:'2026-08'}});
  assert.equal(page.data.transactionCount,0);assert.equal(page.data.chartHasData,false);assert.equal(page.data.categories.length,0);assert.equal(page.data.balance,'0.00');
  page.viewDay({currentTarget:{dataset:{date:'2026-08-03'}}});page.viewExpenses();page.openSettings();
  assert.equal(routes[0],'/pages/ledger/ledger?date=2026-08-03');
  assert.equal(routes[1],'/pages/ledger/ledger?month=2026-08&type=expense');
  assert.equal(routes[2],'/pages/settings/settings');
});
