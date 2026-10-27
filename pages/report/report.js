const { readBook } = require('../../utils/store');
function dateString(date) { return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`; }
function cents(amount) { return Math.round(Number(amount || 0)*100); }
function money(value) { return (value/100).toFixed(2); }
Page({
  data: {
    month:'',currentMonth:'',monthLabel:'',income:'0.00',expense:'0.00',purchase:'0.00',operating:'0.00',
    balance:'0.00',balanceNegative:false,soldBottles:0,transactionCount:0,categories:[],operatingEntries:[],operatingCount:0,
    chartMode:'week',chartBars:[],chartCaption:'',chartMax:'0.00',chartHasData:false,nextDisabled:true,
    stockValue:'0.00',stockBottles:0,errorMessage:''
  },
  onShow() {
    const currentMonth=dateString(new Date()).slice(0,7);
    this.setData({currentMonth,month:this.data.month||currentMonth});this.refresh();
  },
  onPullDownRefresh() { this.refresh();if(wx.stopPullDownRefresh)wx.stopPullDownRefresh(); },
  refresh() {
    try {
      const book=readBook(),month=this.data.month;
      const entries=(book.entries||[]).filter(item=>item.date.slice(0,7)===month);
      const incomeEntries=entries.filter(item=>item.type==='income'),expenseEntries=entries.filter(item=>item.type==='expense');
      const income=incomeEntries.reduce((sum,item)=>sum+cents(item.amount),0);
      const expense=expenseEntries.reduce((sum,item)=>sum+cents(item.amount),0);
      const purchase=expenseEntries.filter(item=>Number(item.quantity)>0).reduce((sum,item)=>sum+cents(item.amount),0);
      const operatingEntries=expenseEntries.filter(item=>!Number(item.quantity)).sort((a,b)=>b.date.localeCompare(a.date));
      const stock=book.stock||[];
      const grouped=new Map();
      incomeEntries.forEach(item=>{
        const key=item.productId||item.name;
        const current=stock.find(product=>product.id===item.productId);
        const group=grouped.get(key)||{id:key,name:current?current.name:item.name,count:0,bottles:0,cents:0};
        group.count++;group.bottles+=Number(item.quantity)||0;group.cents+=cents(item.amount);grouped.set(key,group);
      });
      const rankings=Array.from(grouped.values()).sort((a,b)=>b.cents-a.cents);
      const peak=rankings.length?rankings[0].cents:1;
      const categories=rankings.slice(0,10).map((item,index)=>({...item,rank:index+1,amount:money(item.cents),percent:Math.round(item.cents/peak*100)}));
      this.monthEntries=entries;
      this.setData({
        errorMessage:'',monthLabel:month.replace('-','年')+'月',income:money(income),expense:money(expense),
        purchase:money(purchase),operating:money(expense-purchase),balance:money(Math.abs(income-expense)),balanceNegative:income<expense,
        soldBottles:incomeEntries.reduce((sum,item)=>sum+(Number(item.quantity)||0),0),transactionCount:entries.length,categories,
        operatingEntries:operatingEntries.slice(0,6).map(item=>({...item,displayAmount:Number(item.amount).toFixed(2)})),operatingCount:operatingEntries.length,
        stockValue:money(stock.reduce((sum,item)=>sum+cents(item.cost)*Number(item.count),0)),stockBottles:stock.reduce((sum,item)=>sum+Number(item.count),0),
        nextDisabled:month>=this.data.currentMonth
      });
      this.buildChart();
    } catch(error) { this.setData({errorMessage:error.message||'读取报表失败，请稍后重试'}); }
  },
  buildChart() {
    const {month,chartMode}=this.data;
    const parts=month.split('-').map(Number),monthEnd=new Date(parts[0],parts[1],0).getDate();
    const now=new Date(),end=month===this.data.currentMonth?now.getDate():monthEnd;
    const start=chartMode==='week'?Math.max(1,end-6):1;
    const days=[];
    for(let day=start;day<=end;day++){
      const date=`${month}-${String(day).padStart(2,'0')}`;
      days.push({date,label:chartMode==='week'?`${parts[1]}/${day}`:String(day),income:0,expense:0});
    }
    (this.monthEntries||[]).forEach(item=>{
      const day=days.find(value=>value.date===item.date);
      if(day)day[item.type==='income'?'income':'expense']+=cents(item.amount);
    });
    const max=Math.max(0,...days.map(item=>Math.max(item.income,item.expense)));
    const chartBars=days.map(item=>({
      date:item.date,label:item.label,income:money(item.income),expense:money(item.expense),
      incomeHeight:max&&item.income?Math.max(5,Math.round(item.income/max*140)):0,
      expenseHeight:max&&item.expense?Math.max(5,Math.round(item.expense/max*140)):0
    }));
    this.setData({chartBars,chartMax:money(max),chartHasData:max>0,chartCaption:chartMode==='week'?`${month}-${String(start).padStart(2,'0')} 至 ${month}-${String(end).padStart(2,'0')}`:`${month} 月内每日收支`});
  },
  selectMonth(e) { this.setData({month:e.detail.value});this.refresh(); },
  moveMonth(e) {
    const delta=Number(e.currentTarget.dataset.delta);
    const parts=this.data.month.split('-').map(Number),date=new Date(parts[0],parts[1]-1+delta,1),month=dateString(date).slice(0,7);
    if(month>this.data.currentMonth)return;
    this.setData({month});this.refresh();
  },
  selectChart(e) { this.setData({chartMode:e.currentTarget.dataset.mode});this.buildChart(); },
  viewDay(e) { wx.navigateTo({url:`/pages/ledger/ledger?date=${e.currentTarget.dataset.date}`}); },
  viewMonth() { wx.navigateTo({url:`/pages/ledger/ledger?month=${this.data.month}`}); },
  viewExpenses() { wx.navigateTo({url:`/pages/ledger/ledger?month=${this.data.month}&type=expense`}); },
  editEntry(e) { wx.navigateTo({url:`/pages/entry/entry?id=${encodeURIComponent(e.currentTarget.dataset.id)}`}); },
  openSettings() { wx.navigateTo({url:'/pages/settings/settings'}); }
});
