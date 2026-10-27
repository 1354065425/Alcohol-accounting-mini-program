const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const store=require('../utils/store');
const core=require('../utils/bookkeeping');
const copy=value=>JSON.parse(JSON.stringify(value));

function appHarness(){
  const data=new Map(),routes=[],toasts=[];
  const wx={
    getStorageSync:key=>data.has(key)?copy(data.get(key)):'',
    setStorageSync:(key,value)=>data.set(key,copy(value)),
    removeStorageSync:key=>data.delete(key),
    navigateTo:options=>routes.push(options.url),
    showToast:options=>toasts.push(options.title)
  };
  global.wx=wx;store.initBook();
  function mount(file){
    let page;
    vm.runInNewContext(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),{
      Page:value=>{page=value;},wx,require:name=>require(path.resolve(path.dirname(path.join(__dirname,'..',file)),name))
    },{filename:file});
    page.data=copy(page.data);page.setData=values=>Object.assign(page.data,values);
    return page;
  }
  return {mount,routes,toasts};
}
function rawQuery(url){
  const query=url.slice(url.indexOf('?')+1);
  return Object.fromEntries(query.split('&').map(pair=>{
    const index=pair.indexOf('=');return [pair.slice(0,index),pair.slice(index+1)];
  }));
}

test('catalog Chinese ID round-trips through stock click, encoded URL and movement lifecycle',()=>{
  const app=appHarness();
  const name='赖茅传承';
  const book=core.saveEntry({type:'expense',name,quantity:3,amount:1797,date:'2026-10-26'});
  const product=book.stock.find(item=>item.name===name);
  assert.equal(product.id,'catalog-赖茅传承');
  const stock=app.mount('pages/stock/stock.js');stock.onShow();
  stock.openMovements({currentTarget:{dataset:{id:product.id}}});
  assert.match(app.routes[0],/%E8/);
  const options=rawQuery(app.routes[0]);
  assert.notEqual(options.productId,product.id);
  const movements=app.mount('pages/movements/movements.js');
  movements.onLoad(options);movements.onShow();
  assert.equal(movements.data.error,'');
  assert.equal(movements.data.product.id,product.id);
  assert.equal(movements.data.rows.length,1);
  assert.equal(movements.data.rows[0].delta,3);
});

test('movement route accepts already decoded Chinese product IDs',()=>{
  const app=appHarness();
  const book=core.saveEntry({type:'expense',name:'赖茅传承',quantity:1,amount:599,date:'2026-10-26'});
  const movements=app.mount('pages/movements/movements.js');
  movements.onLoad({productId:book.stock[0].id});movements.onShow();
  assert.equal(movements.data.error,'');assert.equal(movements.data.product.name,'赖茅传承');
});

test('missing stock click ID never navigates to an undefined product',()=>{
  const app=appHarness(),stock=app.mount('pages/stock/stock.js');
  stock.openMovements({currentTarget:{dataset:{}}});
  assert.equal(app.routes.length,0);assert.ok(app.toasts.length);
});

test('special characters survive an actual stock-to-movement route without changing stored IDs',()=>{
  const ids=['catalog-青梅酒 A&B+50%#?/%E4%B8%AD','catalog-赖茅（传承） 53°','literal-%E0%A4%A','0'];
  for(const [index,id] of ids.entries()){
    const app=appHarness();
    core.saveProduct({id,name:'路由测试酒'+index,count:2,cost:30,adjustmentNote:'期初库存'});
    const stock=app.mount('pages/stock/stock.js');stock.openMovements({currentTarget:{dataset:{id}}});
    assert.equal(app.routes.length,1);
    const movements=app.mount('pages/movements/movements.js');
    movements.onLoad(rawQuery(app.routes[0]));movements.onShow();
    assert.equal(movements.data.error,'');
    assert.equal(movements.data.product.id,id);
    assert.equal(movements.data.rows[0].label,'盘点调整');
    assert.equal(store.readBook().stock[0].id,id);
  }
});

test('route resolution prefers literal IDs and decodes only once',()=>{
  const {findByRouteId}=require('../utils/navigation');
  const literal={id:'a%2Fb'},decoded={id:'a/b'},doubleDecoded={id:'a%252Fb'},zero={id:'0'};
  assert.equal(findByRouteId([literal,decoded],'a%2Fb'),literal);
  assert.equal(findByRouteId([decoded],encodeURIComponent(decoded.id)),decoded);
  assert.equal(findByRouteId([literal],encodeURIComponent(literal.id)),literal);
  assert.equal(findByRouteId([doubleDecoded],encodeURIComponent(doubleDecoded.id)),doubleDecoded);
  assert.equal(findByRouteId([decoded],'a%252Fb'),null);
  assert.equal(findByRouteId([zero],0),zero);
  for(const value of [undefined,null,'',{},[],false,'%E0%A4%A'])assert.equal(findByRouteId([literal,decoded],value),null);
  const malformedLiteral={id:'%E0%A4%A'};assert.equal(findByRouteId([malformedLiteral],malformedLiteral.id),malformedLiteral);
});

test('missing or invalid movement IDs display a controlled error without stale records',()=>{
  const app=appHarness();
  const book=core.saveEntry({type:'expense',name:'赖茅传承',quantity:1,amount:599,date:'2026-10-26'});
  const page=app.mount('pages/movements/movements.js');page.onLoad({productId:book.stock[0].id});page.onShow();
  assert.equal(page.data.rows.length,1);
  for(const value of [undefined,'','%E0%A4%A','not-existing']){
    page.onLoad(value===undefined?undefined:{productId:value});page.onShow();
    assert.match(page.data.error,/缺少酒品参数|酒品不存在/);
    assert.equal(page.data.product,null);assert.equal(page.data.rows.length,0);
    assert.equal(page.data.filteredCount,0);
  }
});

test('stale stock buttons refuse navigation if their product was removed',()=>{
  const app=appHarness(),stock=app.mount('pages/stock/stock.js');
  stock.openMovements({currentTarget:{dataset:{id:'removed-product'}}});
  stock.openMovements(undefined);
  assert.equal(app.routes.length,0);assert.equal(app.toasts.length,2);
});
