const store=require('../../utils/store');
const {displayTime}=require('../../utils/format');
const {prepareExport,sharePreparedFile,disposePreparedFile,chooseBackupFile}=require('../../utils/files');
Page({
  data:{shopName:'',threshold:'3',paymentMethods:['微信','支付宝','现金','银行卡','其他'],paymentIndex:0,entryCount:0,productCount:0,updatedAt:'',snapshots:[],lastExport:'尚未导出',busy:false,error:'',version:'1.0.0',textMode:'',backupPreview:'',importLength:0,exportSheet:false,exportKind:'backup',exportFileName:'',exportFormat:'JSON',exportStatus:'',exportError:'',exportRawError:'',exportDetails:false,exportShared:false,sharing:false},
  onUnload(){
    this._unloaded=true;
    this._exportGeneration=(this._exportGeneration||0)+1;
    if(!this._sharingInFlight)this.releaseExport();
  },
  onShow(){this.refresh();},
  refresh(){
    try{
      const book=store.readBook(),settings=book.settings;
      const snapshots=store.getSnapshots().map(item=>({id:item.id,time:displayTime(item.createdAt),reason:item.reason||'自动恢复点',entries:item.book.entries.length,products:item.book.stock.length}));
      let version='1.0.0';try{version=wx.getAccountInfoSync().miniProgram.version||version;}catch(error){}
      this.setData({shopName:settings.shopName,threshold:String(settings.lowStockThreshold),paymentIndex:Math.max(0,this.data.paymentMethods.indexOf(settings.defaultPaymentMethod)),entryCount:book.entries.length,productCount:book.stock.length,updatedAt:displayTime(book.updatedAt),snapshots,lastExport:displayTime(wx.getStorageSync('zjgLastFileExportAt'))||'尚未导出',version,error:''});
    }catch(error){
      let snapshots=[];
      try{snapshots=store.getSnapshots().map(item=>({id:item.id,time:displayTime(item.createdAt),reason:item.reason||'自动恢复点',entries:item.book.entries.length,products:item.book.stock.length}));}catch(snapshotError){}
      this.setData({error:error.message,snapshots});
    }
  },
  inputSetting(e){const field=e.currentTarget.dataset.field;if(['shopName','threshold'].includes(field))this.setData({[field]:e.detail.value});},
  changePayment(e){this.setData({paymentIndex:Number(e.detail.value)});},
  saveSettings(){
    const name=this.data.shopName.trim(),threshold=Number(this.data.threshold);
    if(!name||name.length>40)return wx.showToast({title:'店名须为1至40字',icon:'none'});
    if(this.data.threshold===''||!Number.isSafeInteger(threshold)||threshold<0||threshold>999999)return wx.showToast({title:'预警值须为非负整数',icon:'none'});
    try{const book=store.readBook();book.settings=Object.assign({},book.settings,{shopName:name,lowStockThreshold:threshold,defaultPaymentMethod:this.data.paymentMethods[this.data.paymentIndex]});store.writeBook(book,{expectedRevision:book.revision,reason:'修改设置前的恢复点'});wx.showToast({title:'设置已保存',icon:'success'});this.refresh();}
    catch(error){wx.showToast({title:error.message,icon:'none'});}
  },
  exportBackup(){
    if(this.data.busy||this.data.sharing)return;
    try{return this.prepareFileExport(JSON.stringify(store.createBackup()),'json','backup');}
    catch(error){wx.showModal({title:'备份无法生成',content:error.message,showCancel:false});}
  },
  exportCsv(){
    if(this.data.busy||this.data.sharing)return;
    try{return this.prepareFileExport(store.exportCsv(),'csv','csv');}
    catch(error){wx.showModal({title:'表格无法生成',content:error.message,showCancel:false});}
  },
  async prepareFileExport(text,extension,kind){
    if(this.data.busy||this.data.sharing)return;
    const generation=(this._exportGeneration||0)+1;this._exportGeneration=generation;
    this.setData({busy:true});
    try{
      const prepared=await prepareExport(text,extension);
      if(this._unloaded||this._exportGeneration!==generation){disposePreparedFile(prepared);return;}
      const previous=this._preparedFile;
      this._preparedFile=prepared;this._exportText=text;this._exportKind=kind;
      if(previous)disposePreparedFile(previous);
      this.setData({exportSheet:true,exportKind:kind,exportFileName:prepared.fileName,exportFormat:extension.toUpperCase(),exportStatus:'文件已生成，请点击下方按钮发送并保存。',exportError:'',exportRawError:'',exportDetails:false,exportShared:false});
    }catch(error){
      if(this._unloaded)return;
      if(this._preparedFile){
        this.setData({exportError:'新文件生成失败，原来的文件仍可发送。',exportRawError:error.rawMessage||error.message||'',exportStatus:'原文件已保留'});
      }else{
        wx.showModal({title:'文件生成未完成',content:error.message||'请检查微信存储空间。',confirmText:kind==='backup'?'文本备份':'复制内容',cancelText:'取消',success:({confirm})=>{
          if(!confirm||this._unloaded)return;
          if(kind==='backup')this.openTextExport(text);
          else wx.setClipboardData({data:text,fail:()=>wx.showToast({title:'复制失败，请重试',icon:'none'})});
        }});
      }
    }finally{if(!this._unloaded&&this._exportGeneration===generation)this.setData({busy:false});}
  },
  sendExportFile(){
    if(this.data.busy||this.data.sharing||!this._preparedFile)return;
    const prepared=this._preparedFile,kind=this._exportKind;
    this._sharingInFlight=true;
    this.setData({sharing:true,exportError:'',exportRawError:'',exportDetails:false,exportStatus:'正在打开微信文件发送…'});
    // Keep the native share call directly on this button's tap stack.
    return sharePreparedFile(prepared).then(result=>{
      if(result.shared&&kind==='backup'){
        const exportedAt=new Date().toISOString();
        try{wx.setStorageSync('zjgLastFileExportAt',exportedAt);}catch(error){}
        if(!this._unloaded)this.setData({lastExport:displayTime(exportedAt)});
      }
      if(this._unloaded)return;
      if(result.shared)this.setData({exportShared:true,exportStatus:'文件已分享，请妥善保管。也可以再次发送。'});
      else if(result.cancelled)this.setData({exportStatus:'已取消发送，文件已保留，可再次点击发送。'});
      else this.setData({exportStatus:'文件已生成',exportError:'当前微信环境不支持发送文件，可复制内容保存。'});
    }).catch(error=>{
      if(!this._unloaded)this.setData({exportStatus:'文件已生成，发送未完成',exportError:error.message||'请重试发送，或选择兼容格式。',exportRawError:String(error.rawMessage||error.message||'').slice(0,300),exportShared:false});
    }).finally(()=>{
      this._sharingInFlight=false;
      if(this._unloaded)this.releaseExport();else this.setData({sharing:false});
    });
  },
  switchExportFormat(){
    if(this.data.busy||this.data.sharing||this._exportKind!=='backup')return;
    return this.prepareFileExport(this._exportText,this.data.exportFormat==='TXT'?'json':'txt','backup');
  },
  copyExportText(){
    if(this.data.busy||this.data.sharing)return;
    const text=this._exportText||'',kind=this._exportKind;
    if(kind==='backup'){this.closeExport();this.openTextExport(text);}
    else wx.setClipboardData({data:text,fail:()=>wx.showToast({title:'复制失败，请重试',icon:'none'})});
  },
  toggleExportDetails(){this.setData({exportDetails:!this.data.exportDetails});},
  copyExportError(){wx.setClipboardData({data:this.data.exportRawError||this.data.exportError,fail:()=>wx.showToast({title:'复制失败，请重试',icon:'none'})});},
  releaseExport(){
    const prepared=this._preparedFile;this._preparedFile=null;this._exportText='';this._exportKind='';
    if(prepared)disposePreparedFile(prepared);
  },
  closeExport(){
    if(this.data.busy||this.data.sharing)return;
    this.releaseExport();
    this.setData({exportSheet:false,exportFileName:'',exportStatus:'',exportError:'',exportRawError:'',exportDetails:false,exportShared:false});
  },
  textBackup(){try{this.openTextExport(JSON.stringify(store.createBackup()));}catch(error){wx.showToast({title:error.message,icon:'none'});}},
  openTextExport(text){this.backupText=text;this.setData({textMode:'export',backupPreview:text.slice(0,1200)+(text.length>1200?'\n…下方按钮会复制全部内容':'')});},
  copyBackup(){
    wx.setClipboardData({data:this.backupText||'',success:()=>{wx.showToast({title:'已复制，请保存到安全位置',icon:'none'});},fail:()=>wx.showToast({title:'复制失败，请改用文件备份',icon:'none'})});
  },
  async importFile(){
    if(this.data.busy||this.data.sharing)return;this.setData({busy:true});
    try{const text=await chooseBackupFile();if(!this._unloaded)this.prepareRestore(text);}
    catch(error){if(!this._unloaded)wx.showToast({title:error.message,icon:'none',duration:3000});}
    finally{if(!this._unloaded)this.setData({busy:false});}
  },
  openTextImport(){this.importText='';this.setData({textMode:'import',importLength:0});},
  inputImport(e){this.importText=e.detail.value;this.setData({importLength:e.detail.value.length});},
  importTextBackup(){this.prepareRestore(this.importText||'');},
  prepareRestore(text){
    if(this._unloaded)return;
    try{
      let data;try{data=JSON.parse(text.replace(/^\uFEFF/,''));}catch(error){throw new Error('请粘贴完整的臻酒阁JSON备份内容');}
      if(data.app!=='zhenjiuge'||data.schemaVersion!==2)throw new Error('文件不是臻酒阁备份');
      const candidate=store.validateBook(data.book);
      wx.showModal({title:'恢复这份备份？',content:'备份含 '+candidate.entries.length+' 笔账目、'+candidate.stock.length+' 款酒品，将替换当前账本。恢复前会保存本地恢复点。',confirmText:'确认恢复',confirmColor:'#9c4434',success:({confirm})=>{
        if(!confirm||this._unloaded)return;
        try{store.restoreBackup(data);this.clearDrafts();this.closeText();this.refresh();wx.showToast({title:'备份已恢复',icon:'success'});}
        catch(error){wx.showModal({title:'恢复未完成',content:error.message,showCancel:false});}
      }});
    }catch(error){wx.showModal({title:'备份无法使用',content:error.message,showCancel:false});}
  },
  restorePoint(e){
    const point=this.data.snapshots.find(item=>item.id===e.currentTarget.dataset.id);if(!point)return;
    wx.showModal({title:'恢复到这个时间点？',content:point.time+'，包含 '+point.entries+' 笔账目。当前账本会另外保留为恢复点。',confirmText:'确认恢复',success:({confirm})=>{
      if(!confirm)return;
      try{store.restoreSnapshot(point.id);this.clearDrafts();this.refresh();wx.showToast({title:'已恢复',icon:'success'});}
      catch(error){wx.showToast({title:error.message,icon:'none'});}
    }});
  },
  clearData(){
    wx.showActionSheet({itemList:['只清空账目，保留库存','清空账目并将库存清零'],success:({tapIndex})=>{
      wx.showModal({title:'确认清理本机账本？',content:tapIndex===1?'所有账目将清空，库存数量和成本清零，酒名保留。清理前保留一个本地恢复点。':'所有月份的账目将清空，库存保留。清理前保留一个本地恢复点。',confirmText:'确认清理',confirmColor:'#9c4434',success:({confirm})=>{
        if(!confirm)return;
        try{store.clearData(tapIndex===1?'all':'entries');this.clearDrafts();this.refresh();wx.showToast({title:'数据已清理',icon:'success'});}
        catch(error){wx.showToast({title:error.message,icon:'none'});}
      }});
    }});
  },
  clearDrafts(){try{wx.removeStorageSync('zjgEntryDraftsV1');}catch(error){}},
  closeText(){this.backupText='';this.importText='';this.setData({textMode:'',backupPreview:'',importLength:0});},
  noop(){},
  openHelp(){wx.navigateTo({url:'/pages/help/help'});}
});
