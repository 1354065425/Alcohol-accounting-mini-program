function pad(value) { return String(value).padStart(2, '0'); }
function today() { const date=new Date(); return date.getFullYear()+'-'+pad(date.getMonth()+1)+'-'+pad(date.getDate()); }
function month() { return today().slice(0,7); }
function money(value) { return (Math.round(Number(value||0)*100)/100).toFixed(2); }
function cents(value) {
  const input=String(value).trim();
  if (!/^\d+(\.\d{1,2})?$/.test(input)) throw new Error('金额最多保留两位小数');
  const result=Math.round(Number(input)*100);
  if (!Number.isSafeInteger(result)||result>99999999900) throw new Error('金额超出可记录范围');
  return result;
}
function sum(entries, type) { return money(entries.filter(item=>!type||item.type===type).reduce((total,item)=>total+Math.round(Number(item.amount)*100),0)/100); }
function displayTime(value) { const date=new Date(value); return Number.isNaN(date.getTime())?'':date.getFullYear()+'-'+pad(date.getMonth()+1)+'-'+pad(date.getDate())+' '+pad(date.getHours())+':'+pad(date.getMinutes()); }
function uid(prefix) { return (prefix||'record')+'-'+Date.now()+'-'+Math.random().toString(36).slice(2,9); }
module.exports={pad,today,month,money,cents,sum,displayTime,uid};
