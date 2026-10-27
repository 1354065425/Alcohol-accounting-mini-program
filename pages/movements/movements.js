const { readBook } = require('../../utils/store');
const { productForEntry } = require('../../utils/bookkeeping');
const { findByRouteId } = require('../../utils/navigation');
function money(value) { return Number(value||0).toFixed(2); }
function notePreview(value) { const text=String(value||'');return text.length>160?text.slice(0,159)+'…':text; }
Page({
  data: { product:null,rows:[],filteredCount:0,pageNumber:1,pageCount:1,pageSize:100,hasPrevious:false,hasNext:false,filter:'all',filters:[{key:'all',label:'全部'},{key:'in',label:'入库'},{key:'out',label:'出库'},{key:'adjust',label:'盘点调整'}],error:'' },
  onLoad(options) { this.productId=options&&options.productId; },
  onShow() { this.refresh(); },
  selectFilter(e) { this.setData({filter:e.currentTarget.dataset.filter});this.refresh(true); },
  refresh(resetPage) {
    try {
      if (this.productId===undefined||this.productId===null||this.productId==='') throw new Error('缺少酒品参数，请返回库存页重新选择');
      const book=readBook(),product=findByRouteId(book.stock,this.productId);
      if(!product)throw new Error('酒品不存在，请返回库存页重新选择');
      this.productId=product.id;
      const transactions=book.entries.filter(entry=>{
        const linked=productForEntry(entry,book.stock);
        return linked&&linked.id===product.id;
      }).map(entry=>({id:'entry-'+entry.id,entryId:entry.id,date:entry.date,sortTime:entry.createdAt||entry.date,kind:entry.type==='income'?'out':'in',label:entry.type==='income'?'售酒出库':'进货入库',delta:(entry.type==='income'?-1:1)*Number(entry.quantity),deltaLabel:(entry.type==='income'?'−':'+')+Number(entry.quantity)+' 瓶',amountLabel:'流水金额 ¥'+money(entry.amount),note:notePreview(entry.note||entry.counterparty||'无备注'),isAdjustment:false}));
      const adjustments=(book.adjustments||[]).filter(item=>item.productId===product.id).map(item=>({id:'adjust-'+item.id,date:item.date||(item.createdAt||'').slice(0,10),sortTime:item.createdAt||item.date,kind:'adjust',label:'盘点调整',delta:Number(item.delta===undefined?Number(item.afterCount)-Number(item.beforeCount):item.delta),deltaLabel:(Number(item.afterCount)-Number(item.beforeCount)>0?'+':'')+(Number(item.afterCount)-Number(item.beforeCount))+' 瓶',amountLabel:'库存 '+Number(item.beforeCount)+' → '+Number(item.afterCount)+' 瓶',costLabel:'单瓶成本 ¥'+money(item.beforeCost)+' → ¥'+money(item.afterCost),note:notePreview(item.note||'手工调整'),isAdjustment:true}));
      const rows=[...transactions,...adjustments].filter(item=>this.data.filter==='all'||item.kind===this.data.filter).sort((a,b)=>String(b.date).localeCompare(String(a.date))||String(b.sortTime).localeCompare(String(a.sortTime)));
      this.filteredRows=rows;
      this.renderPage(resetPage===true?1:this.data.pageNumber,{product:{id:product.id,name:product.name,shortName:product.name.slice(0,2),count:product.count,costLabel:money(product.cost)},error:''});
    } catch(error) { this.filteredRows=[];this.setData({product:null,rows:[],filteredCount:0,pageNumber:1,pageCount:1,hasPrevious:false,hasNext:false,error:error.message||'变动记录读取失败'}); }
  },
  renderPage(requestedPage,patch) {
    const items=this.filteredRows||[],pageSize=this.data.pageSize,pageCount=Math.max(1,Math.ceil(items.length/pageSize));
    const pageNumber=Math.max(1,Math.min(Number(requestedPage)||1,pageCount));
    const rows=items.slice((pageNumber-1)*pageSize,pageNumber*pageSize).map(item=>{const {sortTime,...row}=item;return row;});
    this.setData({...patch,rows,filteredCount:items.length,pageNumber,pageCount,hasPrevious:pageNumber>1,hasNext:pageNumber<pageCount});
  },
  previousPage() { if(!this.data.hasPrevious)return;this.renderPage(this.data.pageNumber-1);if(wx.pageScrollTo)wx.pageScrollTo({scrollTop:0,duration:0}); },
  nextPage() { if(!this.data.hasNext)return;this.renderPage(this.data.pageNumber+1);if(wx.pageScrollTo)wx.pageScrollTo({scrollTop:0,duration:0}); },
  openEntry(e) { const id=e.currentTarget.dataset.id;if(id)wx.navigateTo({url:'/pages/entry/entry?id='+encodeURIComponent(id)}); }
});
