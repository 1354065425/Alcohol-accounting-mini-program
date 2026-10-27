const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const store=require('../utils/store');
const fileApi=require('../utils/files');
function memory(){
  const data={},copy=value=>value===undefined?'':JSON.parse(JSON.stringify(value));
  global.wx={getStorageSync:key=>copy(data[key]),setStorageSync:(key,value)=>{data[key]=copy(value);},removeStorageSync:key=>delete data[key]};
  return data;
}
function settingsPage(extraWx,filesOverride){
  const data=memory();let page,confirm=false,modals=[],toasts=[],updates=[];
  Object.assign(global.wx,{showModal:options=>{modals.push(options);if(options.success)options.success({confirm});},showToast:options=>toasts.push(options.title),getAccountInfoSync:()=>({miniProgram:{version:'1.0.0'}})},extraWx||{});
  const modules={'../../utils/store':store,'../../utils/format':require('../utils/format'),'../../utils/files':Object.assign({},fileApi,filesOverride||{})};
  vm.runInNewContext(fs.readFileSync(require.resolve('../pages/settings/settings.js'),'utf8'),{require:name=>modules[name],wx:global.wx,Page:value=>{page=value;},Date,Number,JSON});
  page.data=JSON.parse(JSON.stringify(page.data));page.setData=value=>{updates.push(value);Object.assign(page.data,value);};
  return {page,data,modals,toasts,updates,confirm:value=>{confirm=value;}};
}
function exportHarness(){
  let shareMode='success',prepareFailure=false,shareCount=0,sequence=0;
  const prepared=[],disposed=[];
  const env=settingsPage({},{
    prepareExport:async(text,extension)=>{
      if(prepareFailure)throw Object.assign(new Error('文件生成失败'),{rawMessage:'writeFile:fail disk full'});
      const file={filePath:'/local/export-'+(++sequence)+'.'+extension,fileName:'backup-'+sequence+'.'+extension,extension};
      prepared.push({file,text});return file;
    },
    sharePreparedFile:file=>{
      shareCount++;
      if(shareMode==='cancel')return Promise.resolve({shared:false,cancelled:true});
      if(shareMode==='unsupported')return Promise.resolve({shared:false,unsupported:true});
      if(shareMode==='fail')return Promise.reject(Object.assign(new Error('文件发送失败'),{rawMessage:'shareFileMessage:fail can only be invoked by user TAP gesture'}));
      return Promise.resolve({shared:true});
    },
    disposePreparedFile:file=>{disposed.push(file);return Promise.resolve();}
  });
  store.initBook();
  return Object.assign(env,{prepared,disposed,setShareMode:value=>{shareMode=value;},setPrepareFailure:value=>{prepareFailure=value;},getShareCount:()=>shareCount});
}
test('settings restore cancellation leaves the book untouched and confirmation restores a validated backup',()=>{
  const env=settingsPage();store.initBook();let book=store.readBook();book.settings.shopName='旧店名';store.writeBook(book);
  const backup=store.createBackup();book=store.readBook();book.settings.shopName='新店名';store.writeBook(book);
  const before=JSON.stringify(store.readBook());
  env.page.prepareRestore(JSON.stringify(backup));assert.equal(JSON.stringify(store.readBook()),before);
  env.confirm(true);env.data.zjgEntryDraftsV1={sale:{amount:'10'}};env.page.prepareRestore(JSON.stringify(backup));
  assert.equal(store.readBook().settings.shopName,'旧店名');assert.equal(env.data.zjgEntryDraftsV1,undefined);
});
test('invalid backup cannot replace data and local restore points remain visible with a damaged main book',()=>{
  const env=settingsPage();store.initBook();let book=store.readBook();store.writeBook(book);
  const before=JSON.stringify(store.readBook());
  env.confirm(true);env.page.prepareRestore('not json');assert.equal(JSON.stringify(store.readBook()),before);
  env.data.zjgBookV2={schemaVersion:2,entries:'broken'};
  env.page.refresh();assert.ok(env.page.data.error);assert.ok(env.page.data.snapshots.length>0);
});
test('settings input validates threshold and preserves the existing book on errors',()=>{
  const env=settingsPage();store.initBook();env.page.refresh();
  env.page.setData({shopName:'',threshold:'3'});env.page.saveSettings();assert.equal(store.readBook().settings.shopName,'臻酒阁');
  env.page.setData({shopName:'我的店',threshold:'1.5'});env.page.saveSettings();assert.equal(store.readBook().settings.lowStockThreshold,3);
  env.page.setData({shopName:'我的店',threshold:'5'});env.page.saveSettings();assert.equal(store.readBook().settings.shopName,'我的店');assert.equal(store.readBook().settings.lowStockThreshold,5);
});
test('export prepares a file without automatically sharing or claiming a successful backup',async()=>{
  const env=exportHarness(),before=JSON.stringify(store.readBook());
  await env.page.exportBackup();
  assert.equal(env.getShareCount(),0);assert.equal(env.page.data.exportSheet,true);assert.equal(env.page.data.exportFormat,'JSON');
  assert.equal(env.page.data.busy,false);assert.equal(env.data.zjgLastFileExportAt,undefined);
  assert.equal(JSON.parse(env.prepared[0].text).app,'zhenjiuge');assert.equal(JSON.stringify(store.readBook()),before);
});
test('the explicit send handler invokes sharing synchronously and prevents duplicate taps',async()=>{
  const env=exportHarness();await env.page.exportBackup();
  const task=env.page.sendExportFile();assert.equal(env.getShareCount(),1);assert.equal(env.page.data.sharing,true);
  env.page.sendExportFile();assert.equal(env.getShareCount(),1);
  await task;assert.ok(env.data.zjgLastFileExportAt);assert.equal(env.page.data.exportShared,true);assert.equal(env.page.data.sharing,false);
  assert.equal(env.disposed.length,0);env.page.closeExport();assert.equal(env.disposed.length,1);
});
test('cancelled or failed native sharing retains the file, preserves raw diagnostics and permits retry',async()=>{
  const env=exportHarness();await env.page.exportBackup();const file=env.page._preparedFile;
  env.setShareMode('cancel');await env.page.sendExportFile();
  assert.equal(env.data.zjgLastFileExportAt,undefined);assert.equal(env.disposed.length,0);assert.equal(env.page._preparedFile,file);assert.match(env.page.data.exportStatus,/已取消/);
  env.setShareMode('fail');await env.page.sendExportFile();
  assert.equal(env.disposed.length,0);assert.equal(env.page._preparedFile,file);assert.match(env.page.data.exportRawError,/user TAP gesture/);
  assert.equal(env.page.data.exportError,'文件发送失败');assert.equal(env.modals.length,0);
  env.setShareMode('success');await env.page.sendExportFile();assert.ok(env.data.zjgLastFileExportAt);assert.equal(env.getShareCount(),3);
});
test('TXT compatibility export keeps the exact original backup content and releases only the replaced file',async()=>{
  const env=exportHarness();await env.page.exportBackup();const original=env.page._preparedFile;
  await env.page.switchExportFormat();
  assert.equal(env.page.data.exportFormat,'TXT');assert.equal(env.prepared[0].text,env.prepared[1].text);
  assert.equal(env.disposed[0],original);assert.equal(env.disposed.length,1);assert.equal(env.getShareCount(),0);
  assert.equal(JSON.parse(env.prepared[1].text).app,'zhenjiuge');
});
test('a replacement preparation failure leaves the previous prepared backup available',async()=>{
  const env=exportHarness();await env.page.exportBackup();const original=env.page._preparedFile;
  env.setPrepareFailure(true);await env.page.switchExportFormat();
  assert.equal(env.page._preparedFile,original);assert.equal(env.disposed.length,0);assert.match(env.page.data.exportError,/原来的文件仍可发送/);
  assert.equal(env.page.data.busy,false);assert.equal(env.page.data.exportFormat,'JSON');
});
test('CSV sharing does not mark a complete backup, and unsupported sharing has a text fallback',async()=>{
  const env=exportHarness();await env.page.exportCsv();await env.page.sendExportFile();
  assert.equal(env.data.zjgLastFileExportAt,undefined);assert.equal(env.page.data.exportKind,'csv');env.page.closeExport();
  await env.page.exportBackup();env.setShareMode('unsupported');await env.page.sendExportFile();
  assert.equal(env.data.zjgLastFileExportAt,undefined);assert.match(env.page.data.exportError,/不支持/);
  env.page.copyExportText();assert.equal(env.page.data.textMode,'export');assert.equal(env.page.data.exportSheet,false);assert.equal(JSON.parse(env.page.backupText).app,'zhenjiuge');
});
test('leaving during native sharing waits until the result before releasing the active file',async()=>{
  let resolveShare;const disposed=[];
  const env=settingsPage({},{
    prepareExport:async()=>({filePath:'/local/pending.json',fileName:'pending.json',extension:'json'}),
    sharePreparedFile:()=>new Promise(resolve=>{resolveShare=resolve;}),
    disposePreparedFile:file=>{disposed.push(file);return Promise.resolve();}
  });
  store.initBook();await env.page.exportBackup();const task=env.page.sendExportFile();
  env.page.onUnload();const updateCount=env.updates.length;assert.equal(disposed.length,0);
  resolveShare({shared:true});await task;assert.equal(disposed.length,1);assert.equal(env.updates.length,updateCount);
});
test('leaving during file preparation releases only the completed orphan and never updates the unloaded view',async()=>{
  let finishPrepare;const disposed=[];
  const env=settingsPage({},{
    prepareExport:()=>new Promise(resolve=>{finishPrepare=resolve;}),
    disposePreparedFile:file=>{disposed.push(file);return Promise.resolve();}
  });
  store.initBook();const task=env.page.exportBackup();env.page.onUnload();const updateCount=env.updates.length;
  finishPrepare({filePath:'/local/orphan.json',fileName:'orphan.json',extension:'json'});
  await task;assert.equal(disposed.length,1);assert.equal(env.updates.length,updateCount);assert.equal(env.page.data.exportSheet,false);
});
test('initial preparation failure offers a single clean text-backup fallback without losing the ledger',async()=>{
  const env=exportHarness();env.setPrepareFailure(true);env.confirm(true);const before=JSON.stringify(store.readBook());
  await env.page.exportBackup();assert.equal(env.modals.length,1);assert.equal(env.modals[0].content,'文件生成失败');
  assert.equal(env.page.data.textMode,'export');assert.equal(JSON.parse(env.page.backupText).app,'zhenjiuge');
  assert.equal(JSON.stringify(store.readBook()),before);assert.equal(env.page.data.busy,false);
});

test('a file import completing after leaving settings cannot open a restore dialog or update its old view',async()=>{
  let finishSelection;
  const env=settingsPage({}, {chooseBackupFile:()=>new Promise(resolve=>{finishSelection=resolve;})});
  store.initBook();const backup=JSON.stringify(store.createBackup()),before=JSON.stringify(store.readBook());
  const task=env.page.importFile();env.page.onUnload();const updateCount=env.updates.length;
  finishSelection(backup);await task;
  assert.equal(env.modals.length,0);assert.equal(env.updates.length,updateCount);assert.equal(JSON.stringify(store.readBook()),before);
});
