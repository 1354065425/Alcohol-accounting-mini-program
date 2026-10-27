const {readBook,validDate}=require('../../utils/store');
const {productForEntry,saveEntry,deleteEntry,saveProduct}=require('../../utils/bookkeeping');
const {today,money,cents}=require('../../utils/format');
const {findByRouteId}=require('../../utils/navigation');
const draftKey='zjgEntryDraftsV1';
Page({
  data:{
    kind:'sale',type:'income',amount:'',quantity:1,unitPrice:'',priceSource:'total',date:'',today:'',note:'',counterparty:'',
    paymentMethods:['微信','支付宝','现金','银行卡','其他'],paymentIndex:0,
    expenseCategories:['经营支出','房租','水电','物流','人工','包装','推广','其他'],expenseIndex:0,
    productName:'',selectedProduct:null,available:0,editing:false,saving:false,draftState:'',
    productSheet:false,productSearch:'',productFilter:'all',productOptions:[],productCount:0,newProductName:''
  },
  onLoad(options){
    try{
      const book=readBook();
      let kind=['sale','purchase','expense'].includes(options.kind)?options.kind:options.type==='expense'?'purchase':'sale';
      const initial={today:today(),date:today(),paymentIndex:Math.max(0,this.data.paymentMethods.indexOf(book.settings.defaultPaymentMethod||'微信'))};
      let selectedName=null;
      if(options.id){
        const entry=findByRouteId(book.entries,options.id);
        if(!entry)throw new Error('记录不存在，请返回后刷新');
        this.originalEntry=entry;
        kind=entry.type==='income'?'sale':Number(entry.quantity)>0?'purchase':'expense';
        Object.assign(initial,{editing:true,amount:money(entry.amount),quantity:entry.quantity||1,date:entry.date,note:entry.note||'',counterparty:entry.counterparty||'',
          paymentIndex:Math.max(0,this.data.paymentMethods.indexOf(entry.paymentMethod||'微信')),
          expenseIndex:Math.max(0,this.data.expenseCategories.indexOf(entry.category)),unitPrice:entry.quantity?money(Number(entry.amount)/Number(entry.quantity)):''});
        const product=productForEntry(entry,book.stock);selectedName=product?product.name:null;
        wx.setNavigationBarTitle({title:'修改账目'});
      }else if(options.productId){
        const product=findByRouteId(book.stock,options.productId);
        if(!product)throw new Error('酒品不存在，请返回库存页重新选择');
        selectedName=product.name;
      }
      this.setData(Object.assign(initial,{kind,type:kind==='sale'?'income':'expense'}));
      this.refreshProducts(selectedName);
      if(!this.data.editing&&!options.productId)this.offerDraft();
    }catch(error){wx.showModal({title:'暂时无法打开记账',content:error.message,showCancel:false,success:()=>wx.navigateBack()});}
  },
  refreshProducts(selectedName){
    const book=readBook(),stock=book.stock;
    const names=Array.from(new Set(stock.map(item=>item.name).concat(book.catalog||[]).concat(selectedName?[selectedName]:[])));
    this.allProducts=names.map(name=>{
      const stored=stock.find(item=>item.name===name);
      return stored?Object.assign({},stored,{shortName:name.slice(0,2),stored:true}):
        {id:'catalog-'+name,name,count:0,cost:0,shortName:name.slice(0,2),stored:false,brand:'',bottle:'500ml'};
    });
    const selected=this.data.kind==='expense'?null:this.allProducts.find(item=>item.name===selectedName)||null;
    this.setData({productName:selected?selected.name:'',selectedProduct:selected,available:selected?Number(selected.count):0});
    this.filterProducts();
  },
  filterProducts(){
    const query=this.data.productSearch.trim().toLowerCase();
    const options=(this.allProducts||[]).filter(item=>(this.data.productFilter!=='stock'||Number(item.count)>0)&&(!query||(item.name+' '+(item.brand||'')).toLowerCase().includes(query)));
    this.setData({productOptions:options.slice(0,100),productCount:options.length});
  },
  openProducts(){this.refreshProducts(this.data.productName);this.setData({productSheet:true,productSearch:''});this.filterProducts();},
  closeProducts(){this.setData({productSheet:false});},
  noop(){},
  searchProducts(e){this.setData({productSearch:e.detail.value});this.filterProducts();},
  changeProductFilter(e){this.setData({productFilter:e.currentTarget.dataset.filter});this.filterProducts();},
  chooseProduct(e){
    const name=e.currentTarget.dataset.name;this.refreshProducts(name);this.setData({productSheet:false});
    const product=this.data.selectedProduct;
    if(!this.data.amount&&product){
      const suggested=this.data.kind==='sale'?product.salePrice:product.cost;
      if(Number(suggested)>0){this.setData({unitPrice:money(suggested),priceSource:'unit'});this.recalculate();}
    }
    this.markDirty();
  },
  inputProductName(e){this.setData({newProductName:e.detail.value});},
  addProduct(){
    const name=this.data.newProductName.trim();
    if(!name)return wx.showToast({title:'先输入酒品名称',icon:'none'});
    try{
      const book=readBook();
      if(!book.stock.some(item=>item.name===name))saveProduct({name,count:0,cost:0,brand:'自定义酒品',bottle:'500ml',category:'白酒',adjustmentNote:'新建酒品'});
      this.refreshProducts(name);this.setData({newProductName:'',productSheet:false});this.markDirty();
      wx.showToast({title:'已记住这个酒名',icon:'success'});
    }catch(error){wx.showToast({title:error.message,icon:'none'});}
  },
  switchKind(e){
    const kind=e.currentTarget.dataset.kind;
    if(!['sale','purchase','expense'].includes(kind)||kind===this.data.kind||this.data.saving)return;
    if(this.data.editing){
      const name=this.data.productName;
      this.setData({kind,type:kind==='sale'?'income':'expense'});
      this.refreshProducts(kind==='expense'?null:name||null);this.markDirty();return;
    }
    this.saveDraft();
    const book=readBook(),drafts=wx.getStorageSync(draftKey)||{},draft=drafts[kind];
    this.setData({kind,type:kind==='sale'?'income':'expense',amount:'',quantity:1,unitPrice:'',priceSource:'total',date:today(),note:'',counterparty:'',
      paymentIndex:Math.max(0,this.data.paymentMethods.indexOf(book.settings.defaultPaymentMethod||'微信')),expenseIndex:0,draftState:''});
    this.refreshProducts(null);
    if(draft)this.applyDraft(draft);else this.markDirty();
  },
  inputAmount(e){
    this.setData({amount:e.detail.value,priceSource:'total'});this.recalculate();this.markDirty();
  },
  inputUnitPrice(e){
    this.setData({unitPrice:e.detail.value,priceSource:'unit'});this.recalculate();this.markDirty();
  },
  inputQuantity(e){this.setData({quantity:e.detail.value});this.recalculate();this.markDirty();},
  decrease(){this.setData({quantity:Math.max(1,(Number(this.data.quantity)||1)-1)});this.recalculate();this.markDirty();},
  increase(){this.setData({quantity:(Number(this.data.quantity)||0)+1});this.recalculate();this.markDirty();},
  recalculate(){
    if(this.data.kind==='expense')return;
    const quantity=Number(this.data.quantity);
    if(!Number.isSafeInteger(quantity)||quantity<1){if(this.data.priceSource==='unit')this.setData({amount:''});return;}
    try{
      if(this.data.priceSource==='unit'){
        if(this.data.unitPrice===''){this.setData({amount:''});return;}
        const total=cents(this.data.unitPrice)*quantity;
        if(!Number.isSafeInteger(total)||total>99999999900)throw new Error('金额超出可记录范围');
        this.setData({amount:money(total/100)});
      }else this.setData({unitPrice:this.data.amount===''?'':money(cents(this.data.amount)/100/quantity)});
    }catch(error){this.setData(this.data.priceSource==='unit'?{amount:''}:{unitPrice:''});}
  },
  inputField(e){
    const field=e.currentTarget.dataset.field;
    if(['note','counterparty'].includes(field)){this.setData({[field]:e.detail.value});this.markDirty();}
  },
  selectDate(e){this.setData({date:e.detail.value});this.markDirty();},
  selectPayment(e){this.setData({paymentIndex:Number(e.detail.value)});this.markDirty();},
  selectExpense(e){this.setData({expenseIndex:Number(e.detail.value)});this.markDirty();},
  markDirty(){
    const hasContent=this.saveDraft();this.dirty=this.data.editing||hasContent;
    if(this.dirty&&wx.enableAlertBeforeUnload)wx.enableAlertBeforeUnload({message:'这笔账目尚未保存，确认离开？'});
    else if(!this.dirty&&wx.disableAlertBeforeUnload)wx.disableAlertBeforeUnload();
  },
  saveDraft(){
    if(this.data.editing)return true;
    const hasContent=Boolean(this.data.amount||this.data.unitPrice||this.data.note||this.data.counterparty||this.data.productName);
    try{
      const drafts=wx.getStorageSync(draftKey)||{};
      if(!hasContent){delete drafts[this.data.kind];wx.setStorageSync(draftKey,drafts);this.setData({draftState:''});return false;}
      drafts[this.data.kind]={kind:this.data.kind,amount:this.data.amount,quantity:this.data.quantity,unitPrice:this.data.unitPrice,priceSource:this.data.priceSource,
        date:this.data.date,note:this.data.note,counterparty:this.data.counterparty,paymentIndex:this.data.paymentIndex,expenseIndex:this.data.expenseIndex,
        productName:this.data.productName,savedAt:Date.now()};
      wx.setStorageSync(draftKey,drafts);this.setData({draftState:'草稿已在本机保存'});return true;
    }catch(error){this.setData({draftState:'草稿未保存，请及时记账'});return hasContent;}
  },
  applyDraft(draft){
    const name=typeof draft.productName==='string'?draft.productName:null;
    const paymentIndex=Number.isInteger(draft.paymentIndex)&&draft.paymentIndex>=0&&draft.paymentIndex<this.data.paymentMethods.length?draft.paymentIndex:0;
    const expenseIndex=Number.isInteger(draft.expenseIndex)&&draft.expenseIndex>=0&&draft.expenseIndex<this.data.expenseCategories.length?draft.expenseIndex:0;
    this.setData({amount:String(draft.amount||''),quantity:draft.quantity||1,unitPrice:String(draft.unitPrice||''),priceSource:draft.priceSource==='unit'?'unit':'total',
      date:validDate(draft.date)&&draft.date<=today()?draft.date:today(),note:typeof draft.note==='string'?draft.note:'',counterparty:typeof draft.counterparty==='string'?draft.counterparty:'',
      paymentIndex,expenseIndex});
    this.refreshProducts(name);this.recalculate();this.markDirty();this.setData({draftState:'已恢复上次的草稿'});
  },
  offerDraft(){
    const drafts=wx.getStorageSync(draftKey)||{},draft=drafts[this.data.kind];
    if(!draft)return;
    wx.showModal({title:'继续上次未完成的记录？',content:'发现一份未保存的记账草稿。',confirmText:'继续填写',cancelText:'重新填写',success:({confirm})=>{
      if(confirm){
        this.applyDraft(draft);
      }else this.clearDraft();
    }});
  },
  clearDraft(){
    if(!this.data.editing){try{const drafts=wx.getStorageSync(draftKey)||{};delete drafts[this.data.kind];wx.setStorageSync(draftKey,drafts);}catch(error){}}
    this.dirty=false;this.setData({draftState:''});if(wx.disableAlertBeforeUnload)wx.disableAlertBeforeUnload();
  },
  saveAndContinue(){this.save(true);},
  save(continueAdding){
    if(this.data.saving)return;
    const product=this.data.kind==='expense'?null:this.data.selectedProduct,quantity=Number(this.data.quantity);
    if(this.data.kind!=='expense'&&!product)return wx.showToast({title:'请选择或添加酒品',icon:'none'});
    if(product&&(!Number.isSafeInteger(quantity)||quantity<1||quantity>1000000000))return wx.showToast({title:'瓶数必须为有效正整数',icon:'none'});
    let amount;
    try{
      const total=product&&this.data.priceSource==='unit'?cents(this.data.unitPrice)*quantity:cents(this.data.amount);
      if(!Number.isSafeInteger(total)||total>99999999900)throw new Error('金额超出可记录范围');
      amount=total/100;if(amount<=0)throw new Error('金额须大于零');
    }
    catch(error){return wx.showToast({title:error.message,icon:'none'});}
    this.setData({saving:true});
    try{
      const category=this.data.kind==='sale'?'售酒':this.data.kind==='purchase'?'购酒':this.data.expenseCategories[this.data.expenseIndex];
      const entry=Object.assign({},this.originalEntry||{},{type:this.data.kind==='sale'?'income':'expense',name:product?product.name:category,
        productId:product?product.id:null,category,amount,date:this.data.date,quantity:product?quantity:0,note:this.data.note.trim(),
        counterparty:this.data.counterparty.trim(),paymentMethod:this.data.paymentMethods[this.data.paymentIndex],unitPrice:product?Number(money(amount/quantity)):0});
      saveEntry(entry,this.originalEntry&&this.originalEntry.id,{originalEntry:this.originalEntry});
      this.clearDraft();wx.showToast({title:this.data.editing?'修改成功':'记账成功',icon:'success'});
      if(continueAdding===true&&!this.data.editing){
        const name=this.data.productName;
        this.setData({saving:false,amount:'',unitPrice:'',quantity:1,note:'',counterparty:'',priceSource:'total'});this.refreshProducts(name);
      }else setTimeout(()=>wx.navigateBack(),400);
    }catch(error){this.setData({saving:false});wx.showToast({title:error.message||'保存失败，请重试',icon:'none',duration:3000});}
  },
  deleteEntry(){
    if(this.data.saving||!this.originalEntry)return;
    this.setData({saving:true});
    wx.showModal({title:'删除这笔账目？',content:'库存数量会同步调整，并保留本地恢复点。',confirmText:'确认删除',confirmColor:'#9c4434',success:({confirm})=>{
      if(!confirm){this.setData({saving:false});return;}
      try{deleteEntry(this.originalEntry.id,{originalEntry:this.originalEntry});this.clearDraft();wx.showToast({title:'已删除',icon:'success'});setTimeout(()=>wx.navigateBack(),400);}
      catch(error){this.setData({saving:false});wx.showToast({title:error.message,icon:'none',duration:3000});}
    },fail:()=>this.setData({saving:false})});
  }
});
