const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const store=require('../utils/store');
const bookkeeping=require('../utils/bookkeeping');
const format=require('../utils/format');
const clone=value=>JSON.parse(JSON.stringify(value));
const draftKey='zjgEntryDraftsV1';

function harness(options={}){
  const storage=new Map(),modals=[],toasts=[],timers=[];
  let page,backCount=0,alertEnabled=false;
  const wx={
    getStorageSync:key=>storage.has(key)?clone(storage.get(key)):'',
    setStorageSync:(key,value)=>storage.set(key,clone(value)),
    removeStorageSync:key=>storage.delete(key),
    showModal:config=>modals.push(config),showToast:config=>toasts.push(config.title),
    setNavigationBarTitle(){},navigateBack:()=>{backCount++;},
    enableAlertBeforeUnload:()=>{alertEnabled=true;},disableAlertBeforeUnload:()=>{alertEnabled=false;}
  };
  global.wx=wx;
  const initial=store.initBook();
  const stock=options.stock||[{id:'a',name:'甲酒',count:10,cost:20,salePrice:30,brand:'甲',bottle:'500ml',category:'白酒'}];
  store.writeBook({...initial,stock,entries:options.entries||[],catalog:['甲酒','乙酒']});
  if(options.drafts)storage.set(draftKey,clone(options.drafts));
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../pages/entry/entry.js'),'utf8'),{
    wx,Page:config=>{page=config;},setTimeout:callback=>{timers.push(callback);return timers.length;},
    require:name=>({ '../../utils/store':store,'../../utils/bookkeeping':bookkeeping,'../../utils/format':format,'../../utils/navigation':require('../utils/navigation') }[name])
  });
  page.data=clone(page.data);page.setData=values=>Object.assign(page.data,values);
  page.onLoad(options.route||{type:'income'});
  return {page,storage,modals,toasts,read:()=>store.readBook(),answer:confirm=>{const modal=modals.shift();assert.ok(modal);modal.success({confirm});},flush:()=>timers.splice(0).forEach(callback=>callback()),get backCount(){return backCount;},get alertEnabled(){return alertEnabled;}};
}
function pick(page,name='甲酒'){page.chooseProduct({currentTarget:{dataset:{name}}});}
function setAmount(page,value){page.inputAmount({detail:{value}});}
function setQuantity(page,value){page.inputQuantity({detail:{value}});}
function setUnit(page,value){page.inputUnitPrice({detail:{value}});}
function kind(page,value){page.switchKind({currentTarget:{dataset:{kind:value}}});}
function existingSale(){return {id:'old',type:'income',name:'甲酒',productId:'a',category:'售酒',quantity:2,amount:60,date:format.today(),note:'旧备注',paymentMethod:'微信'};}

test('entry route accepts purchase kind and product ID with saved default payment',()=>{
  const h=harness({route:{kind:'purchase',productId:'a'}});
  assert.equal(h.page.data.kind,'purchase');assert.equal(h.page.data.selectedProduct.id,'a');assert.equal(h.page.data.paymentIndex,0);
});

test('total-price purchase preserves the exact total and tap event does not mean continue adding',()=>{
  const h=harness({route:{kind:'purchase'}});pick(h.page);setQuantity(h.page,'3');setAmount(h.page,'10.00');
  assert.equal(h.page.data.unitPrice,'3.33');assert.equal(h.page.data.priceSource,'total');
  h.page.save({type:'tap'});h.page.save({type:'tap'});
  const book=h.read();assert.equal(book.entries.length,1);assert.equal(book.entries[0].amount,10);assert.equal(book.entries[0].quantity,3);assert.equal(book.stock[0].count,13);
  assert.equal(h.page.data.amount,'10.00');assert.equal(h.page.data.saving,true);h.flush();assert.equal(h.backCount,1);
});

test('unit multiplication uses integer cents and a manually entered total takes precedence',()=>{
  const h=harness();pick(h.page);setQuantity(h.page,'3');setUnit(h.page,'0.10');assert.equal(h.page.data.amount,'0.30');
  setAmount(h.page,'1.00');assert.equal(h.page.data.unitPrice,'0.33');assert.equal(h.page.data.priceSource,'total');
  setQuantity(h.page,'5');assert.equal(h.page.data.amount,'1.00');assert.equal(h.page.data.unitPrice,'0.20');
  h.page.save();assert.equal(h.read().entries[0].amount,1);assert.equal(h.read().stock[0].count,5);
});

test('cleared or invalid unit price cannot silently save a stale total',()=>{
  const h=harness();pick(h.page);setQuantity(h.page,'2');setUnit(h.page,'10.00');assert.equal(h.page.data.amount,'20.00');
  setUnit(h.page,'');assert.equal(h.page.data.amount,'');h.page.save();assert.equal(h.read().entries.length,0);
  setUnit(h.page,'1.234');assert.equal(h.page.data.amount,'');h.page.save();assert.equal(h.read().entries.length,0);
  setUnit(h.page,'1.20');setQuantity(h.page,'1.5');assert.equal(h.page.data.amount,'');h.page.save();assert.equal(h.read().entries.length,0);
});

test('unit-price save derives the total from the active price, even after stale restored amounts',()=>{
  const h=harness();pick(h.page);h.page.setData({unitPrice:'0.29',quantity:3,priceSource:'unit',amount:'999.00'});h.page.save();
  assert.equal(h.read().entries[0].amount,0.87);assert.equal(h.read().stock[0].count,7);
});

test('switching entry kinds retains independent drafts and does not overwrite another kind',()=>{
  const h=harness();pick(h.page);setAmount(h.page,'40.00');kind(h.page,'expense');assert.equal(h.page.data.amount,'');
  setAmount(h.page,'12.00');h.page.inputField({currentTarget:{dataset:{field:'note'}},detail:{value:'配送'}});
  kind(h.page,'sale');assert.equal(h.page.data.amount,'40.00');assert.equal(h.page.data.productName,'甲酒');
  assert.equal(h.storage.get(draftKey).expense.amount,'12.00');assert.equal(h.storage.get(draftKey).expense.note,'配送');
  setAmount(h.page,'');assert.equal(h.storage.get(draftKey).sale.amount,'');
});

test('draft resume normalizes invalid dates and picker indices and recalculates active unit price',()=>{
  const h=harness({drafts:{sale:{amount:'999',unitPrice:'1.25',priceSource:'unit',quantity:4,productName:'甲酒',date:'2026-02-31',paymentIndex:99,expenseIndex:-1}}});
  assert.equal(h.modals.length,1);h.answer(true);
  assert.equal(h.page.data.amount,'5.00');assert.equal(h.page.data.date,format.today());assert.equal(h.page.data.paymentIndex,0);assert.equal(h.page.data.expenseIndex,0);
  assert.equal(h.page.data.productName,'甲酒');assert.equal(h.alertEnabled,true);
});

test('editing an existing sale changes one record without duplicating inventory effects or deleting a new-entry draft',()=>{
  const h=harness({entries:[existingSale()],route:{id:'old'},drafts:{sale:{amount:'999',productName:'甲酒'}}});
  assert.equal(h.modals.length,0);setAmount(h.page,'80.00');h.page.save();
  assert.equal(h.read().entries.length,1);assert.equal(h.read().entries[0].id,'old');assert.equal(h.read().entries[0].amount,80);assert.equal(h.read().stock[0].count,10);
  assert.equal(h.storage.get(draftKey).sale.amount,'999');
});

test('editing quantity adjusts only the difference, while stale original records are rejected',()=>{
  const h=harness({entries:[existingSale()],route:{id:'old'}});setQuantity(h.page,3);h.page.save();assert.equal(h.read().stock[0].count,9);
  const second=harness({entries:[existingSale()],route:{id:'old'}});
  bookkeeping.saveEntry({...existingSale(),amount:70},'old');setAmount(second.page,'90.00');second.page.save();
  assert.equal(second.read().entries[0].amount,70);assert.equal(second.read().stock[0].count,10);assert.equal(second.page.data.saving,false);assert.ok(second.toasts.some(value=>value.includes('已变化')));
});

test('save-and-continue clears price fields and a second tap cannot create a duplicate',()=>{
  const h=harness();pick(h.page);setAmount(h.page,'50.00');h.page.saveAndContinue();
  assert.equal(h.read().entries.length,1);assert.equal(h.page.data.amount,'');assert.equal(h.page.data.unitPrice,'');assert.equal(h.page.data.productName,'甲酒');assert.equal(h.page.data.saving,false);
  h.page.saveAndContinue();assert.equal(h.read().entries.length,1);assert.equal(h.backCount,0);
});

test('operating expense stores category, counterparty and payment without touching stock',()=>{
  const h=harness({route:{kind:'expense'}});setAmount(h.page,'18.80');h.page.selectExpense({detail:{value:3}});h.page.selectPayment({detail:{value:2}});
  h.page.inputField({currentTarget:{dataset:{field:'counterparty'}},detail:{value:' 配送公司 '}});h.page.save();
  const entry=h.read().entries[0];assert.equal(entry.category,'物流');assert.equal(entry.quantity,0);assert.equal(entry.productId,null);assert.equal(entry.counterparty,'配送公司');assert.equal(entry.paymentMethod,'现金');assert.equal(h.read().stock[0].count,10);
});

test('deletion is locked while confirming, cancellation unlocks and confirmed deletion restores stock',()=>{
  const h=harness({entries:[existingSale()],route:{id:'old'},drafts:{sale:{amount:'99'}}});
  h.page.deleteEntry();h.page.deleteEntry();assert.equal(h.modals.length,1);assert.equal(h.page.data.saving,true);
  h.answer(false);assert.equal(h.page.data.saving,false);assert.equal(h.read().entries.length,1);
  h.page.deleteEntry();h.answer(true);h.page.deleteEntry();
  assert.equal(h.read().entries.length,0);assert.equal(h.read().stock[0].count,12);assert.equal(h.storage.get(draftKey).sale.amount,'99');assert.equal(h.page.data.saving,true);assert.equal(h.modals.length,0);
});

test('encoded Chinese and reserved-character product IDs keep the selected liquor on purchase routes',()=>{
  for(const id of ['catalog-赖茅传承','catalog-青梅 酒&+%#','catalog-字面%2F酒']){
    for(const parameter of [id,encodeURIComponent(id)]){
      const h=harness({stock:[{id,name:'赖茅传承',count:3,cost:599}],route:{type:'expense',productId:parameter}});
      assert.equal(h.modals.length,0);
      assert.equal(h.page.data.kind,'purchase');
      assert.equal(h.page.data.selectedProduct.id,id);
      assert.equal(h.page.data.productName,'赖茅传承');
    }
  }
});

test('encoded record IDs open the correct historical entry without changing its original ID',()=>{
  const entry={...existingSale(),id:'流水-更正%+&号'};
  const h=harness({entries:[entry],route:{id:encodeURIComponent(entry.id)}});
  assert.equal(h.modals.length,0);assert.equal(h.page.data.editing,true);assert.equal(h.page.originalEntry.id,entry.id);
});

test('missing routed liquor is reported rather than silently choosing another product',()=>{
  const h=harness({route:{type:'expense',productId:'does-not-exist'}});
  assert.equal(h.modals.length,1);assert.match(h.modals[0].content,/酒品不存在/);assert.equal(h.page.data.selectedProduct,null);
});
