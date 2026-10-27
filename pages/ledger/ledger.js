const { readBook } = require('../../utils/store');
function dateString(date) { return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`; }
function cents(amount) { return Math.round(Number(amount || 0) * 100); }
function money(value) { return (value / 100).toFixed(2); }
const PAGE_SIZE=100;
Page({
  data: {
    entries:[],groups:[],startDate:'',endDate:'',today:'',keyword:'',type:'all',activePeriod:'all',
    income:'0.00',expense:'0.00',balance:'0.00',balanceNegative:false,filteredCount:0,visibleCount:0,
    pageIndex:1,pageCount:1,rangeStart:0,rangeEnd:0,hasPrevious:false,hasNext:false,rangeLabel:'全部日期',errorMessage:''
  },
  onLoad(options) {
    this.currentPage=1;
    const patch={};
    if (options.date) { patch.startDate=options.date;patch.endDate=options.date;patch.activePeriod='day'; }
    if (options.month && /^\d{4}-\d{2}$/.test(options.month)) {
      const parts=options.month.split('-').map(Number);
      const today=dateString(new Date());
      patch.startDate=options.month+'-01';patch.endDate=options.month===today.slice(0,7)?today:dateString(new Date(parts[0],parts[1],0));patch.activePeriod='month';
    }
    if (options.type==='income'||options.type==='expense') patch.type=options.type;
    this.setData(patch);
  },
  onShow() {
    const today=dateString(new Date());
    if(this.data.activePeriod==='today'&&this.data.startDate!==today)this.currentPage=1;
    this.setData(this.data.activePeriod==='today'?{today,startDate:today,endDate:today}:{today});
    this.refresh();
  },
  onPullDownRefresh() { this.refresh();if(wx.stopPullDownRefresh)wx.stopPullDownRefresh(); },
  onUnload() { if(this.searchTimer)clearTimeout(this.searchTimer); },
  refresh() {
    try { this.allEntries=readBook().entries || [];this.setData({errorMessage:''});this.applyFilters(); }
    catch(error) { this.setData({errorMessage:error.message||'读取数据失败，请稍后重试'}); }
  },
  applyFilters() {
    const {startDate,endDate,type,keyword}=this.data;
    const query=keyword.trim().toLowerCase();
    const entries=(this.allEntries||[]).filter(item=>{
      if(startDate&&item.date<startDate)return false;
      if(endDate&&item.date>endDate)return false;
      if(type!=='all'&&item.type!==type)return false;
      return !query||[item.name,item.note,item.counterparty,item.paymentMethod,item.category].join(' ').toLowerCase().includes(query);
    }).sort((a,b)=>b.date.localeCompare(a.date)||String(b.createdAt||b.id).localeCompare(String(a.createdAt||a.id)));
    const income=entries.filter(item=>item.type==='income').reduce((sum,item)=>sum+cents(item.amount),0);
    const expense=entries.filter(item=>item.type==='expense').reduce((sum,item)=>sum+cents(item.amount),0);
    const pageCount=Math.max(1,Math.ceil(entries.length/PAGE_SIZE));
    const pageIndex=Math.min(pageCount,Math.max(1,this.currentPage||1));
    this.currentPage=pageIndex;
    const offset=(pageIndex-1)*PAGE_SIZE;
    // Send only the bounded display model, not full notes or arbitrary backup fields.
    const visible=entries.slice(offset,offset+PAGE_SIZE).map(item=>({
      id:item.id,date:item.date,type:item.type,name:item.name,category:item.category||'',quantity:Number(item.quantity)||0,
      displayAmount:Number(item.amount).toFixed(2),detail:[item.counterparty,item.paymentMethod,item.note].filter(Boolean).join(' · ').slice(0,160)
    }));
    const groups=[];
    visible.forEach(item=>{
      let group=groups[groups.length-1];
      if(!group||group.date!==item.date){group={date:item.date,entries:[]};groups.push(group);}
      group.entries.push(item);
    });
    const rangeLabel=startDate&&endDate?(startDate===endDate?startDate:`${startDate} 至 ${endDate}`):(startDate?`${startDate} 起`:(endDate?`截至 ${endDate}`:'全部日期'));
    this.setData({entries:visible,groups,income:money(income),expense:money(expense),balance:money(Math.abs(income-expense)),balanceNegative:income<expense,filteredCount:entries.length,visibleCount:visible.length,
      pageIndex,pageCount,rangeStart:entries.length?offset+1:0,rangeEnd:offset+visible.length,hasPrevious:pageIndex>1,hasNext:pageIndex<pageCount,rangeLabel});
  },
  changeFilters(patch) { this.currentPage=1;this.setData(patch);this.applyFilters(); },
  selectStart(e) {
    const startDate=e.detail.value;
    this.changeFilters({startDate,endDate:this.data.endDate&&this.data.endDate<startDate?startDate:this.data.endDate,activePeriod:'custom'});
  },
  selectEnd(e) {
    const endDate=e.detail.value;
    this.changeFilters({endDate,startDate:this.data.startDate&&this.data.startDate>endDate?endDate:this.data.startDate,activePeriod:'custom'});
  },
  selectDate(e) { this.changeFilters({startDate:e.detail.value,endDate:e.detail.value,activePeriod:'day'}); },
  showToday() { this.changeFilters({startDate:this.data.today,endDate:this.data.today,activePeriod:'today'}); },
  showMonth() { this.changeFilters({startDate:this.data.today.slice(0,7)+'-01',endDate:this.data.today,activePeriod:'month'}); },
  showAll() { this.changeFilters({startDate:'',endDate:'',activePeriod:'all'}); },
  changeType(e) { this.changeFilters({type:e.currentTarget.dataset.type}); },
  inputKeyword(e) {
    this.setData({keyword:e.detail.value});
    if(this.searchTimer)clearTimeout(this.searchTimer);
    this.searchTimer=setTimeout(()=>{this.currentPage=1;this.applyFilters();},180);
  },
  searchNow() { if(this.searchTimer)clearTimeout(this.searchTimer);this.currentPage=1;this.applyFilters(); },
  clearKeyword() { if(this.searchTimer)clearTimeout(this.searchTimer);this.changeFilters({keyword:''}); },
  resetFilters() { if(this.searchTimer)clearTimeout(this.searchTimer);this.changeFilters({startDate:'',endDate:'',keyword:'',type:'all',activePeriod:'all'}); },
  previousPage() { if(this.data.hasPrevious)this.movePage(-1); },
  nextPage() { if(this.data.hasNext)this.movePage(1); },
  movePage(delta) {
    this.currentPage=this.data.pageIndex+delta;this.applyFilters();
    if(wx.pageScrollTo)wx.pageScrollTo({scrollTop:0,duration:180});
  },
  editEntry(e) { wx.navigateTo({url:`/pages/entry/entry?id=${encodeURIComponent(e.currentTarget.dataset.id)}`}); },
  addEntry() { wx.navigateTo({url:'/pages/entry/entry?type=income'}); }
});
