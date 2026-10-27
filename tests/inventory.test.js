const fs=require('fs');
const vm=require('vm');
const path=require('path');
const assert=require('assert/strict');
const root=path.join(__dirname,'..');
const clone=value=>JSON.parse(JSON.stringify(value));
let checks=0;
function mount(file,initial) {
  let book=clone(initial),page,readError=null,pullStops=0;
  const saved=[],toasts=[],routes=[],stockPayloads=[],rowPayloads=[];
  const store={readBook:()=>{if(readError)throw readError;return clone(book);}};
  const bookkeeping={
    productForEntry:(entry,stock)=>entry.quantity>0?stock.find(item=>item.id===entry.productId||item.name===entry.name):null,
    saveProduct:product=>{saved.push(clone(product));book.revision++;return clone(book);}
  };
  const wx={showToast:options=>toasts.push(options.title),navigateTo:options=>routes.push(options.url),stopPullDownRefresh:()=>pullStops++};
  vm.runInNewContext(fs.readFileSync(path.join(root,file),'utf8'),{Page:config=>page=config,require:module=>module.includes('navigation')?require('../utils/navigation'):module.includes('bookkeeping')?bookkeeping:store,wx},{filename:file});
  page.data=clone(page.data);
  page.setData=values=>{if(Array.isArray(values.stock))stockPayloads.push(values.stock.length);if(Array.isArray(values.rows))rowPayloads.push(values.rows.length);Object.keys(values).forEach(key=>{
    const parts=key.split('.');let target=page.data;
    parts.slice(0,-1).forEach(part=>{target=target[part];});target[parts[parts.length-1]]=values[key];
  });};
  return {page,saved,toasts,routes,stockPayloads,rowPayloads,get book(){return book;},get pullStops(){return pullStops;},setBook:value=>book=clone(value),setReadError:value=>readError=value};
}
function initial() {return {revision:2,stock:[
  {id:'a',name:'飞天茅台',brand:'贵州茅台',bottle:'500ml',count:4,cost:100,category:'白酒',lowStockThreshold:3},
  {id:'b',name:'青岛啤酒',brand:'青岛',bottle:'330ml',count:0,cost:5,category:'啤酒'},
  {id:'c',name:'古越龙山',brand:'绍兴',bottle:'500ml',count:2,cost:20,category:'黄酒',lowStockThreshold:2}],settings:{lowStockThreshold:3},entries:[],adjustments:[]};}
let app=mount('pages/stock/stock.js',initial());app.page.onShow();
assert.equal(app.page.data.stock.length,2);assert.equal(app.page.data.totalBottles,6);assert.equal(app.page.data.totalCost,'440.00');assert.equal(app.page.data.lowStockCount,1);assert.equal(app.book.stock.length,3);checks++;
app.page.onPullDownRefresh();assert.equal(app.pullStops,1);app.setReadError(new Error('读取失败'));app.page.onPullDownRefresh();assert.equal(app.pullStops,2);assert.equal(app.page.data.error,'读取失败');app.setReadError(null);app.page.refresh();checks++;
app.page.inputSearch({detail:{value:'绍兴'}});assert.equal(app.page.data.stock.length,1);assert.equal(app.page.data.stock[0].id,'c');checks++;
app.page.clearSearch();app.page.toggleLow();assert.equal(app.page.data.stock.length,1);assert.equal(app.page.data.stock[0].id,'c');checks++;
app.page.toggleLow();app.page.toggleManage();assert.equal(app.page.data.stock.length,3);checks++;
app.page.sortChanged({detail:{value:'1'}});assert.equal(app.page.data.stock[0].id,'a');app.page.sortChanged({detail:{value:'2'}});assert.equal(app.page.data.stock[0].id,'b');checks++;
app.page.openEdit({currentTarget:{dataset:{id:'a'}}});app.page.inputEdit({currentTarget:{dataset:{field:'count'}},detail:{value:'5'}});app.page.saveEdit();assert.equal(app.saved.length,0);assert.ok(app.toasts.includes('请填写库存调整原因'));checks++;
app.page.inputEdit({currentTarget:{dataset:{field:'adjustmentNote'}},detail:{value:'盘点补录'}});app.page.saveEdit();assert.equal(app.saved.length,1);assert.equal(app.saved[0].count,5);assert.equal(app.saved[0].adjustmentNote,'盘点补录');checks++;
app=mount('pages/stock/stock.js',initial());app.page.openEdit({currentTarget:{dataset:{id:'a'}}});app.page.inputEdit({currentTarget:{dataset:{field:'name'}},detail:{value:'青岛啤酒'}});app.page.saveEdit();assert.equal(app.saved.length,0);assert.ok(app.toasts.some(value=>value.includes('酒名已存在')));checks++;
app=mount('pages/stock/stock.js',initial());app.page.openEdit({currentTarget:{dataset:{id:'a'}}});app.page.inputEdit({currentTarget:{dataset:{field:'count'}},detail:{value:'-1'}});app.page.saveEdit();assert.equal(app.saved.length,0);checks++;
app=mount('pages/stock/stock.js',initial());app.page.openEdit({currentTarget:{dataset:{id:'a'}}});app.page.inputEdit({currentTarget:{dataset:{field:'cost'}},detail:{value:'-1'}});app.page.saveEdit();assert.equal(app.saved.length,0);checks++;
app=mount('pages/stock/stock.js',initial());app.page.openAdd();app.page.inputEdit({currentTarget:{dataset:{field:'name'}},detail:{value:'自定义果酒'}});app.page.saveEdit();assert.equal(app.saved.length,1);assert.equal(app.saved[0].name,'自定义果酒');assert.equal(app.saved[0].count,0);checks++;
app=mount('pages/stock/stock.js',initial());app.page.openEdit({currentTarget:{dataset:{id:'a'}}});app.setBook({...initial(),revision:3});app.page.saveEdit();assert.equal(app.saved.length,0);assert.ok(app.toasts.some(value=>value.includes('数据已更新')));checks++;
app=mount('pages/stock/stock.js',initial());app.page.addPurchase({currentTarget:{dataset:{id:'a'}}});assert.equal(app.routes[0],'/pages/entry/entry?type=expense&productId=a');checks++;
const history=initial();history.entries=[{id:'e1',productId:'a',name:'飞天茅台',type:'income',quantity:1,amount:150,date:'2026-10-25'},{id:'e2',productId:'a',name:'飞天茅台',type:'expense',quantity:3,amount:300,date:'2026-10-24'},{id:'e3',productId:'c',name:'古越龙山',type:'income',quantity:1,amount:35,date:'2026-10-26'}];history.adjustments=[{id:'j1',productId:'a',beforeCount:1,afterCount:2,beforeCost:90,afterCost:100,note:'盘点修正',date:'2026-10-26',createdAt:'2026-10-26T10:00:00Z'}];
app=mount('pages/movements/movements.js',history);app.page.onLoad({productId:'a'});app.page.onShow();assert.equal(app.page.data.rows.length,3);assert.equal(app.page.data.rows[0].label,'盘点调整');checks++;
app.page.selectFilter({currentTarget:{dataset:{filter:'in'}}});assert.equal(app.page.data.rows.length,1);assert.equal(app.page.data.rows[0].delta,3);app.page.selectFilter({currentTarget:{dataset:{filter:'out'}}});assert.equal(app.page.data.rows.length,1);assert.equal(app.page.data.rows[0].delta,-1);checks++;
app.page.selectFilter({currentTarget:{dataset:{filter:'adjust'}}});assert.equal(app.page.data.rows[0].note,'盘点修正');app.page.openEntry({currentTarget:{dataset:{id:'e1'}}});assert.equal(app.routes[0],'/pages/entry/entry?id=e1');checks++;
const rollover=initial();rollover.entries=[{id:'r1',productId:'a',name:'飞天茅台',type:'income',quantity:1,amount:150,date:'2026-10-26',createdAt:'2026-10-26T01:00:00Z'}];rollover.adjustments=[{id:'r2',productId:'a',beforeCount:1,afterCount:2,beforeCost:100,afterCost:100,date:'2026-10-26',createdAt:'2026-10-25T17:00:00Z'}];app=mount('pages/movements/movements.js',rollover);app.page.onLoad({productId:'a'});app.page.onShow();assert.equal(app.page.data.rows[0].entryId,'r1');checks++;
const largeBook=initial();largeBook.stock=Array.from({length:5000},(_,index)=>({id:'large-'+index,name:'酒品'+String(index).padStart(5,'0'),count:1,cost:10}));
app=mount('pages/stock/stock.js',largeBook);app.page.onShow();assert.equal(app.page.data.stock.length,50);assert.equal(app.page.data.filteredCount,5000);assert.equal(app.page.data.pageCount,100);assert.equal(app.page.data.totalBottles,5000);assert.equal(app.page.data.totalCost,'50000.00');assert.equal(app.page.filteredStock.length,5000);checks++;
app.page.nextPage();assert.equal(app.page.data.pageNumber,2);assert.equal(app.page.data.stock[0].id,'large-50');app.page.previousPage();assert.equal(app.page.data.pageNumber,1);checks++;
app.page.renderPage(100);assert.equal(app.page.data.pageNumber,100);assert.equal(app.page.data.hasNext,false);assert.equal(app.page.data.stock[49].id,'large-4999');app.page.inputSearch({detail:{value:'酒品00001'}});assert.equal(app.page.data.pageNumber,1);assert.equal(app.page.data.pageCount,1);assert.equal(app.page.data.filteredCount,1);assert.equal(app.page.data.totalBottles,5000);checks++;
app.page.clearSearch();app.page.renderPage(100);const reduced=clone(largeBook);reduced.stock.slice(-50).forEach(item=>item.count=0);app.setBook(reduced);app.page.refresh();assert.equal(app.page.data.pageNumber,99);assert.equal(app.page.data.pageCount,99);assert.equal(app.page.data.stock.length,50);assert.equal(app.page.data.filteredCount,4950);assert.equal(app.page.data.totalBottles,4950);checks++;
app.page.toggleManage();assert.equal(app.page.data.pageNumber,1);assert.equal(app.page.data.filteredCount,5000);app.page.renderPage(3);app.page.toggleLow();assert.equal(app.page.data.pageNumber,1);app.page.renderPage(3);app.page.sortChanged({detail:{value:'1'}});assert.equal(app.page.data.pageNumber,1);assert.ok(app.stockPayloads.length>8);assert.ok(app.stockPayloads.every(length=>length<=50));checks++;
const largeHistory=initial(),longNote='长备注'.repeat(180);
largeHistory.entries=Array.from({length:1001},(_,index)=>({id:'history-entry-'+index,productId:'a',name:'飞天茅台',type:index%2?'expense':'income',quantity:1,amount:100,date:'2026-10-26',createdAt:'2026-10-26T01:00:00Z',note:longNote,counterparty:'不需要传入展示模型的客户'}));
largeHistory.adjustments=Array.from({length:1002},(_,index)=>({id:'history-adjust-'+index,productId:'a',beforeCount:1,afterCount:2,beforeCost:100,afterCost:100,date:'2026-10-26',createdAt:'2026-10-26T02:00:00Z',note:longNote}));
app=mount('pages/movements/movements.js',largeHistory);app.page.onLoad({productId:'a'});app.page.onShow();assert.equal(app.page.data.filteredCount,2003);assert.equal(app.page.data.pageCount,21);assert.equal(app.page.data.rows.length,100);assert.equal(app.page.filteredRows.length,2003);assert.ok(app.page.data.rows.every(row=>row.note.length<=160));assert.ok(app.page.data.rows.every(row=>!Object.prototype.hasOwnProperty.call(row,'sortTime')));assert.ok(!Object.prototype.hasOwnProperty.call(app.page.data.product,'brand'));checks++;
const firstMovementId=app.page.data.rows[0].id;app.page.nextPage();assert.equal(app.page.data.pageNumber,2);assert.notEqual(app.page.data.rows[0].id,firstMovementId);app.page.onShow();assert.equal(app.page.data.pageNumber,2);app.page.previousPage();assert.equal(app.page.data.pageNumber,1);checks++;
app.page.renderPage(21);assert.equal(app.page.data.rows.length,3);app.page.selectFilter({currentTarget:{dataset:{filter:'out'}}});assert.equal(app.page.data.pageNumber,1);assert.equal(app.page.data.filteredCount,501);assert.equal(app.page.data.pageCount,6);app.page.renderPage(6);assert.equal(app.page.data.rows.length,1);assert.ok(app.page.data.rows[0].note.length<=160);checks++;
app.setBook({...largeHistory,entries:largeHistory.entries.slice(0,10)});app.page.onShow();assert.equal(app.page.data.pageNumber,1);assert.equal(app.page.data.filteredCount,5);assert.ok(app.rowPayloads.length>5);assert.ok(app.rowPayloads.every(length=>length<=100));checks++;
// Exercise the page against the actual storage/domain modules as well as UI stubs.
const storage=new Map(),liveToasts=[];
global.wx={getStorageSync:key=>storage.has(key)?clone(storage.get(key)):'',setStorageSync:(key,value)=>storage.set(key,clone(value)),removeStorageSync:key=>storage.delete(key),showToast:value=>liveToasts.push(value.title),navigateTo:()=>{}};
const realStore=require('../utils/store'),realDomain=require('../utils/bookkeeping');
realStore.initBook();
let liveBook=realDomain.saveProduct({name:'库存联调酒',count:5,cost:80,category:'白酒',adjustmentNote:'期初建档'});
const productId=liveBook.stock[0].id;
realDomain.saveEntry({type:'income',name:'库存联调酒',productId,quantity:1,amount:120,date:'2026-10-26'});
let livePage;
vm.runInNewContext(fs.readFileSync(path.join(root,'pages/stock/stock.js'),'utf8'),{Page:page=>livePage=page,wx:global.wx,require:module=>module.includes('navigation')?require('../utils/navigation'):module.includes('bookkeeping')?realDomain:realStore});
livePage.data=clone(livePage.data);livePage.setData=values=>Object.keys(values).forEach(key=>{const parts=key.split('.');let target=livePage.data;parts.slice(0,-1).forEach(part=>target=target[part]);target[parts[parts.length-1]]=values[key];});
livePage.onShow();assert.equal(livePage.data.totalBottles,4);
livePage.openEdit({currentTarget:{dataset:{id:productId}}});
livePage.inputEdit({currentTarget:{dataset:{field:'name'}},detail:{value:'更正后的联调酒'}});
livePage.inputEdit({currentTarget:{dataset:{field:'count'}},detail:{value:'3'}});
livePage.inputEdit({currentTarget:{dataset:{field:'cost'}},detail:{value:'90'}});
livePage.inputEdit({currentTarget:{dataset:{field:'adjustmentNote'}},detail:{value:'盘点更正'}});
livePage.saveEdit();liveBook=realStore.readBook();
assert.equal(liveBook.stock[0].name,'更正后的联调酒');assert.equal(liveBook.stock[0].count,3);assert.equal(liveBook.stock[0].cost,90);assert.equal(liveBook.entries[0].name,'更正后的联调酒');assert.equal(liveBook.adjustments[0].note,'盘点更正');assert.equal(liveBook.adjustments[0].delta,-1);checks++;
livePage.openAdd();livePage.inputEdit({currentTarget:{dataset:{field:'name'}},detail:{value:'零库存联调酒'}});livePage.saveEdit();assert.equal(livePage.data.stock.length,1);livePage.toggleManage();assert.equal(livePage.data.stock.length,2);checks++;
console.log('inventory: '+checks+' checks passed');
