const {initBook}=require('./utils/store');
App({
  globalData:{currency:'¥',initError:''},
  onLaunch(){
    try{initBook();}catch(error){this.globalData.initError=error.message;}
    if(wx.getUpdateManager){
      const manager=wx.getUpdateManager();
      manager.onUpdateReady(()=>wx.showModal({title:'新版本已准备好',content:'重启小程序后即可使用新功能，未保存的表单请先保存。',confirmText:'重启更新',cancelText:'稍后',success:({confirm})=>{if(confirm)manager.applyUpdate();}}));
    }
  }
});
