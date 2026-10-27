const { readBook } = require('../../utils/store');
const { saveProduct } = require('../../utils/bookkeeping');
const { findByRouteId } = require('../../utils/navigation');
const emptyDraft = () => ({ id:'',name:'',brand:'',bottle:'500ml',category:'白酒',count:'0',cost:'0.00',salePrice:'',lowStockThreshold:'3',adjustmentNote:'' });
function money(value) { return Number(value || 0).toFixed(2); }
function thresholdFor(item,settings) { return Number(item.lowStockThreshold===undefined||item.lowStockThreshold===null||item.lowStockThreshold===''?(settings.lowStockThreshold===undefined?3:settings.lowStockThreshold):item.lowStockThreshold); }
Page({
  data: { stock:[],filteredCount:0,pageNumber:1,pageCount:1,pageSize:50,hasPrevious:false,hasNext:false,totalBottles:0,totalCost:'0.00',inStockKinds:0,lowStockCount:0,query:'',manageMode:false,lowOnly:false,sortIndex:0,sortOptions:['按名称排序','库存从多到少','库存从少到多'],editing:false,draft:emptyDraft(),saving:false,error:'' },
  onShow() { this.refresh(); },
  onPullDownRefresh() { this.refresh();if(wx.stopPullDownRefresh)wx.stopPullDownRefresh(); },
  refresh(resetPage) {
    try {
      const book = readBook();
      const all = book.stock.map(item => {
        const threshold = thresholdFor(item,book.settings);
        return { ...item,shortName:item.name.slice(0,2),costLabel:money(item.cost),salePriceLabel:Number(item.salePrice)>0?money(item.salePrice):'',threshold,isLow:Number(item.count)<=threshold,isZero:Number(item.count)===0 };
      });
      const inStock = all.filter(item => Number(item.count)>0);
      const query = this.data.query.trim().toLocaleLowerCase();
      let stock = all.filter(item => this.data.manageMode || Number(item.count)>0)
        .filter(item => !query || [item.name,item.brand,item.bottle,item.category].join(' ').toLocaleLowerCase().includes(query))
        .filter(item => !this.data.lowOnly || (!item.isZero && item.isLow));
      stock.sort((a,b) => this.data.sortIndex===1 ? Number(b.count)-Number(a.count)||a.name.localeCompare(b.name,'zh-CN') : this.data.sortIndex===2 ? Number(a.count)-Number(b.count)||a.name.localeCompare(b.name,'zh-CN') : a.name.localeCompare(b.name,'zh-CN'));
      this.filteredStock=stock;
      this.renderPage(resetPage===true?1:this.data.pageNumber,{totalBottles:inStock.reduce((sum,item)=>sum+Number(item.count),0),totalCost:money(inStock.reduce((sum,item)=>sum+Number(item.count)*Number(item.cost),0)),inStockKinds:inStock.length,lowStockCount:inStock.filter(item=>item.isLow).length,error:''});
    } catch(error) { this.setData({error:error.message||'库存读取失败，请重试'}); }
  },
  renderPage(requestedPage,patch) {
    const items=this.filteredStock||[],pageSize=this.data.pageSize,pageCount=Math.max(1,Math.ceil(items.length/pageSize));
    const pageNumber=Math.max(1,Math.min(Number(requestedPage)||1,pageCount));
    this.setData({...patch,stock:items.slice((pageNumber-1)*pageSize,pageNumber*pageSize),filteredCount:items.length,pageNumber,pageCount,hasPrevious:pageNumber>1,hasNext:pageNumber<pageCount});
  },
  previousPage() { if(!this.data.hasPrevious)return;this.renderPage(this.data.pageNumber-1);if(wx.pageScrollTo)wx.pageScrollTo({scrollTop:0,duration:0}); },
  nextPage() { if(!this.data.hasNext)return;this.renderPage(this.data.pageNumber+1);if(wx.pageScrollTo)wx.pageScrollTo({scrollTop:0,duration:0}); },
  inputSearch(e) { this.setData({query:e.detail.value});this.refresh(true); },
  clearSearch() { this.setData({query:''});this.refresh(true); },
  toggleManage() { this.setData({manageMode:!this.data.manageMode});this.refresh(true); },
  toggleLow() { this.setData({lowOnly:!this.data.lowOnly});this.refresh(true); },
  sortChanged(e) { this.setData({sortIndex:Number(e.detail.value)});this.refresh(true); },
  addPurchase(e) {
    const id=e.currentTarget&&e.currentTarget.dataset?e.currentTarget.dataset.id:'';
    wx.navigateTo({url:'/pages/entry/entry?type=expense'+(id?'&productId='+encodeURIComponent(id):'')});
  },
  openMovements(e) {
    try {
      const dataset=e&&e.currentTarget&&e.currentTarget.dataset;
      const product=findByRouteId(readBook().stock,dataset&&dataset.id);
      if(!product)throw new Error('酒品不存在，请刷新库存后重试');
      wx.navigateTo({url:'/pages/movements/movements?productId='+encodeURIComponent(product.id)});
    } catch(error) { wx.showToast({title:error.message||'无法打开变动记录',icon:'none'}); }
  },
  openAdd() {
    try {
      const book=readBook();this.editRevision=book.revision;this.editOriginal=null;
      this.setData({editing:true,draft:{...emptyDraft(),lowStockThreshold:String(book.settings.lowStockThreshold===undefined?3:book.settings.lowStockThreshold)},saving:false});
    } catch(error) { wx.showToast({title:error.message||'无法新增酒品',icon:'none'}); }
  },
  openEdit(e) {
    try {
      const book=readBook(),item=book.stock.find(value=>value.id===e.currentTarget.dataset.id);
      if (!item) throw new Error('酒品不存在，请刷新后重试');
      this.editRevision=book.revision;this.editOriginal=item;
      this.setData({editing:true,draft:{id:item.id,name:item.name,brand:item.brand||'',bottle:item.bottle||'',category:item.category||'白酒',count:String(item.count),cost:money(item.cost),salePrice:Number(item.salePrice)>0?money(item.salePrice):'',lowStockThreshold:String(thresholdFor(item,book.settings)),adjustmentNote:''},saving:false});
    } catch(error) { wx.showToast({title:error.message||'无法编辑酒品',icon:'none'}); }
  },
  closeEdit() { if(!this.data.saving)this.setData({editing:false}); },
  noop() {},
  inputEdit(e) {
    const field=e.currentTarget.dataset.field;
    if(Object.prototype.hasOwnProperty.call(emptyDraft(),field))this.setData({['draft.'+field]:e.detail.value});
  },
  saveEdit() {
    if(this.data.saving)return;
    const draft=this.data.draft;
    const name=draft.name.trim(),count=Number(draft.count),cost=Number(draft.cost),salePrice=draft.salePrice===''?0:Number(draft.salePrice),threshold=Number(draft.lowStockThreshold);
    if(!name||name.length>80)return wx.showToast({title:'酒名请填写1至80个字',icon:'none'});
    if(!/^\d+$/.test(String(draft.count))||!Number.isSafeInteger(count)||count>999999999)return wx.showToast({title:'库存请填写有效整数',icon:'none'});
    if(draft.cost===''||!Number.isFinite(cost)||cost<0||cost>999999999||Math.abs(cost*100-Math.round(cost*100))>0.0001)return wx.showToast({title:'成本须为非负金额，最多两位小数',icon:'none'});
    if(!Number.isFinite(salePrice)||salePrice<0||salePrice>999999999||Math.abs(salePrice*100-Math.round(salePrice*100))>0.0001)return wx.showToast({title:'售价须为非负金额，最多两位小数',icon:'none'});
    if(!Number.isSafeInteger(count*Math.round(cost*100)))return wx.showToast({title:'库存总成本过大，请核对数量与单价',icon:'none'});
    if(!/^\d+$/.test(String(draft.lowStockThreshold))||!Number.isSafeInteger(threshold)||threshold>999999)return wx.showToast({title:'预警数量请填0至999999',icon:'none'});
    const original=this.editOriginal;
    const adjusted=original?(count!==Number(original.count)||Number(cost.toFixed(2))!==Number(Number(original.cost).toFixed(2))):(count>0||cost>0);
    if(adjusted&&!draft.adjustmentNote.trim())return wx.showToast({title:'请填写库存调整原因',icon:'none'});
    this.setData({saving:true});
    try {
      const book=readBook();
      if(book.revision!==this.editRevision)throw new Error('数据已更新，请重新打开编辑');
      if(book.stock.some(item=>item.id!==draft.id&&item.name.trim().toLocaleLowerCase()===name.toLocaleLowerCase()))throw new Error('这个酒名已存在，请直接修改原酒品');
      saveProduct({...(original||{}),id:draft.id||undefined,name,brand:draft.brand.trim(),bottle:draft.bottle.trim(),category:draft.category.trim()||'其他',count,cost:Number(cost.toFixed(2)),salePrice:Number(salePrice.toFixed(2)),lowStockThreshold:threshold,adjustmentNote:draft.adjustmentNote.trim()});
      this.setData({saving:false,editing:false});this.refresh();wx.showToast({title:original?'酒品已修改':'酒品已添加',icon:'success'});
    } catch(error) { this.setData({saving:false});wx.showToast({title:error.message||'保存失败，请重试',icon:'none',duration:3000}); }
  }
});
