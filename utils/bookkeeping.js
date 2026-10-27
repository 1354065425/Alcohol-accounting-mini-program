const store = require('./store');
const DEFAULT_CATALOG = require('./catalog');
const legacyIds = { '茅台·飞天 53°':'maotai', '五粮液·普五':'wuliangye', '汾酒·青花20':'fenjiu', '泸州老窖·国窖1573':'guojiao' };
const clone = value => JSON.parse(JSON.stringify(value));
const id = prefix => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2,10)}`;
const timestamp = () => new Date().toISOString();
const dateString = () => { const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
const cents = value => Math.round(Number(value)*100);

function amount(value, label, allowZero) {
  const result=Number(value);
  if (!Number.isFinite(result)||result<(allowZero?0:0.01)||result>999999999||Math.abs(result*100-Math.round(result*100))>0.0001) throw new Error(`${label}须为最多两位小数的有效金额`);
  return cents(result)/100;
}

function quantity(value, label) {
  const result=Number(value);
  if (!Number.isSafeInteger(result)||result<0||result>1000000000) throw new Error(`${label}须为有效的非负整数`);
  return result;
}

function productForEntry(entry, stock) {
  if (!entry||!Number(entry.quantity)) return null;
  return stock.find(item=>entry.productId&&item.id===entry.productId)
    ||stock.find(item=>item.name===entry.name)
    ||stock.find(item=>legacyIds[entry.name]&&item.id===legacyIds[entry.name])
    ||{id:entry.productId||`catalog-${entry.name}`,name:entry.name,brand:'自定义酒品',bottle:'500ml',category:'其他',count:0,cost:0,salePrice:0,tag:'自定义',tone:'dark'};
}

function changeStock(stock, previous, next) {
  const result=stock.map(item=>({...item}));
  const deltas=new Map();
  [{entry:previous,direction:-1},{entry:next,direction:1}].forEach(({entry,direction})=>{
    const product=productForEntry(entry,result);
    if (!product) return;
    const qty=quantity(entry.quantity,'账目瓶数');
    if (!qty) throw new Error('瓶数必须大于零');
    let item=result.find(value=>value.id===product.id);
    if (!item) {item={...product,count:0,cost:0};result.push(item);}
    const delta=direction*(entry.type==='income'?-1:1)*qty;
    deltas.set(item.id,(deltas.get(item.id)||0)+delta);
  });
  result.forEach(item=>{
    const count=Number(item.count)+(deltas.get(item.id)||0);
    if (count<0) throw new Error(`${item.name}库存不足，无法修改或删除这笔记录`);
    item.count=quantity(count,'库存数量');
  });
  const product=productForEntry(next,result);
  if (product&&next.type==='expense') {
    const item=result.find(value=>value.id===product.id),before=stock.find(value=>value.id===product.id);
    // Edits to historical entries do not replay later sales or silently change today's unit cost.
    if (!previous) {
      const oldCount=before?Number(before.count):0,oldCost=before?cents(before.cost):0;
      const total=oldCount*oldCost+cents(next.amount);
      if (!Number.isSafeInteger(total)) throw new Error('库存金额过大，请核对数量和成本');
      item.cost=Math.round(total/item.count)/100;
    } else if (!before) item.cost=Math.round(cents(next.amount)/Number(next.quantity))/100;
  }
  return result;
}

function assertRevision(book, options) {
  if (options&&options.expectedRevision!==undefined&&options.expectedRevision!==book.revision) throw new Error('数据已变化，请刷新页面后重试');
}

function assertOriginal(original, options) {
  if (options&&options.originalEntry&&JSON.stringify(options.originalEntry)!==JSON.stringify(original)) throw new Error('这笔记录已变化，请退出后重新打开');
}

function saveEntry(input, originalId, options) {
  const book=store.readBook();assertRevision(book,options);
  const original=originalId?book.entries.find(item=>item.id===originalId):null;
  if (originalId&&!original) throw new Error('这笔记录已不存在，请重新打开');
  assertOriginal(original,options);
  if (!input||!['income','expense'].includes(input.type)) throw new Error('请选择有效的收支类型');
  const qty=quantity(input.quantity||0,'瓶数');
  if (input.type==='income'&&!qty) throw new Error('请选择售出酒品及瓶数');
  if (input.productId&&!qty) throw new Error('关联酒品后瓶数必须大于零');
  if (!store.validDate(input.date)) throw new Error('请选择正确的日期');
  const product=qty?productForEntry(input,book.stock):null;
  const entry={...clone(input),id:original?original.id:(input.id||id('entry')),type:input.type,name:product?product.name:String(input.name||input.note||'经营支出').trim(),productId:product?product.id:null,quantity:qty,amount:amount(input.amount,'账目金额',false),category:input.type==='income'?'售酒':(product?'购酒':(input.category||'经营支出')),note:String(input.note||'').trim(),counterparty:String(input.counterparty||'').trim(),paymentMethod:String(input.paymentMethod||book.settings.defaultPaymentMethod),createdAt:original?(original.createdAt||timestamp()):timestamp(),updatedAt:timestamp()};
  if (!original&&book.entries.some(item=>item.id===entry.id)) throw new Error('记录编号重复，请重新保存');
  const stock=changeStock(book.stock,original,entry);
  const entries=book.entries.slice();
  if (original) entries[entries.findIndex(item=>item.id===original.id)]=entry;else entries.unshift(entry);
  const catalog=product?Array.from(new Set([...book.catalog,product.name])):book.catalog;
  return store.writeBook({...book,entries,stock,catalog},{expectedRevision:book.revision,reason:original?'修改账目前':'新增账目前'});
}

function deleteEntry(entryId, options) {
  const book=store.readBook();assertRevision(book,options);
  const original=book.entries.find(item=>item.id===entryId);
  if (!original) throw new Error('这笔记录已不存在');
  assertOriginal(original,options);
  const stock=changeStock(book.stock,original,null);
  return store.writeBook({...book,entries:book.entries.filter(item=>item.id!==entryId),stock},{expectedRevision:book.revision,reason:'删除账目前'});
}

function saveProduct(input, options) {
  const book=store.readBook();assertRevision(book,options);
  if (!input||typeof input.name!=='string'||!input.name.trim()) throw new Error('请输入酒品名称');
  const name=input.name.trim();
  const original=input.id?book.stock.find(item=>item.id===input.id):null;
  if (book.stock.some(item=>item.name===name&&(!original||item.id!==original.id))) throw new Error('这个酒名已经存在');
  const product={...(original||{}),...clone(input),id:original?original.id:(input.id||id('product')),name,count:quantity(input.count===undefined?(original?original.count:0):input.count,'库存数量'),cost:amount(input.cost===undefined?(original?original.cost:0):input.cost,'每瓶成本',true),salePrice:amount(input.salePrice===undefined?(original?(original.salePrice||0):0):input.salePrice,'参考售价',true),brand:String(input.brand===undefined?(original?original.brand||'':''):input.brand).trim(),bottle:String(input.bottle===undefined?(original?original.bottle||'500ml':'500ml'):input.bottle).trim(),category:String(input.category===undefined?(original?original.category||'其他':'其他'):input.category).trim(),tag:String(input.tag||input.category||(original&&original.tag)||'自定义'),tone:input.tone||(original&&original.tone)||'wine',updatedAt:timestamp()};
  if (input.lowStockThreshold===null||input.lowStockThreshold==='') delete product.lowStockThreshold;
  else if (input.lowStockThreshold!==undefined) product.lowStockThreshold=quantity(input.lowStockThreshold,'低库存提醒值');
  delete product.adjustmentNote;delete product.shortName;
  const beforeCount=original?Number(original.count):0,beforeCost=original?Number(original.cost):0;
  const changes=beforeCount!==product.count||cents(beforeCost)!==cents(product.cost);
  const note=String(input.adjustmentNote||'').trim();
  if (original&&changes&&!note) throw new Error('请填写库存调整原因');
  const adjustments=book.adjustments.slice();
  if (changes) adjustments.unshift({id:id('adjustment'),productId:product.id,productName:name,beforeCount,afterCount:product.count,delta:product.count-beforeCount,beforeCost,afterCost:product.cost,note:note||'期初库存建档',date:dateString(),createdAt:timestamp()});
  const entries=original?book.entries.map(entry=>{const linked=productForEntry(entry,book.stock);return linked&&linked.id===original.id?{...entry,name,productId:product.id}:entry;}):book.entries;
  const stock=original?book.stock.map(item=>item.id===original.id?product:item):[...book.stock,product];
  let catalog=book.catalog.slice();
  if (original&&name!==original.name&&!DEFAULT_CATALOG.includes(original.name)) catalog=catalog.map(value=>value===original.name?name:value);
  catalog=Array.from(new Set([...catalog,name]));
  return store.writeBook({...book,stock,entries,catalog,adjustments},{expectedRevision:book.revision,reason:original?'修改酒品前':'新增酒品前'});
}

function adjustStock(productId, count, cost, note, options) {
  const book=store.readBook();assertRevision(book,options);
  const original=book.stock.find(item=>item.id===productId);
  if (!original) throw new Error('酒品不存在');
  return saveProduct({...original,count,cost,adjustmentNote:note},{expectedRevision:book.revision});
}

function saveBook(entries, stock, options) {
  const book=store.readBook();assertRevision(book,options);
  return store.writeBook({...book,entries,stock,catalog:Array.from(new Set([...book.catalog,...stock.map(item=>item.name)]))},{expectedRevision:book.revision,reason:'账本更新前'});
}

module.exports={productForEntry,changeStock,saveBook,saveEntry,deleteEntry,saveProduct,adjustStock};
