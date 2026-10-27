const {readBook}=require('../../utils/store');
const {today,month,money,sum}=require('../../utils/format');
Page({
  data:{entries:[],balance:'0.00',income:'0.00',expense:'0.00',todayIncome:'0.00',todayExpense:'0.00',todayCount:0,monthLabel:'',shopName:'臻酒阁',lowStockCount:0,stockBottles:0,backupReminder:false,empty:true,error:''},
  onShow(){this.refresh();},
  onPullDownRefresh(){this.refresh();wx.stopPullDownRefresh();},
  refresh(){
    try{
      const book=readBook(),current=month(),date=today(),entries=book.entries;
      const monthly=entries.filter(item=>item.date.slice(0,7)===current),daily=entries.filter(item=>item.date===date);
      const income=sum(monthly,'income'),expense=sum(monthly,'expense');
      const active=book.stock.filter(item=>Number(item.count)>0);
      const low=active.filter(item=>Number(item.count)<=Number(item.lowStockThreshold===undefined?book.settings.lowStockThreshold:item.lowStockThreshold));
      const last=wx.getStorageSync('zjgLastFileExportAt'),elapsed=last?Date.now()-new Date(last).getTime():Infinity;
      const recent=entries.slice().sort((a,b)=>b.date.localeCompare(a.date)||String(b.createdAt||b.id).localeCompare(String(a.createdAt||a.id))).slice(0,5);
      this.setData({entries:recent,balance:money(Number(income)-Number(expense)),income,expense,todayIncome:sum(daily,'income'),todayExpense:sum(daily,'expense'),todayCount:daily.length,
        monthLabel:current,shopName:book.settings.shopName,lowStockCount:low.length,stockBottles:active.reduce((total,item)=>total+Number(item.count),0),backupReminder:entries.length>0&&elapsed>7*86400000,empty:entries.length===0&&active.length===0,error:''});
    }catch(error){this.setData({error:error.message});}
  },
  addSale(){wx.navigateTo({url:'/pages/entry/entry?type=income'});},
  addPurchase(){wx.navigateTo({url:'/pages/entry/entry?type=expense'});},
  addExpense(){wx.navigateTo({url:'/pages/entry/entry?kind=expense'});},
  editEntry(e){wx.navigateTo({url:'/pages/entry/entry?id='+encodeURIComponent(e.currentTarget.dataset.id)});},
  openAll(){wx.navigateTo({url:'/pages/ledger/ledger'});},
  openToday(){wx.navigateTo({url:'/pages/ledger/ledger?date='+today()});},
  openSettings(){wx.navigateTo({url:'/pages/settings/settings'});},
  openStock(){wx.switchTab({url:'/pages/stock/stock'});}
});
