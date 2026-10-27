const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const MAX=4*1024*1024;
const modulePath=path.join(__dirname,'../utils/files.js');
function setup(initialFiles){
  const contents=new Map(Object.entries(initialFiles||{})),events=[];
  const state={tap:false,shareMode:'ok',writeMode:'ok',choosePath:'',chooseSize:undefined,privacy:true,chooseCalls:0,readCalls:0,shareCalls:0};
  const fs={
    readdir(options){events.push('readdir');options.success({files:Array.from(contents.keys()).filter(name=>name.startsWith('/local/')).map(name=>name.slice('/local/'.length))});},
    writeFile(options){
      events.push('write');contents.set(options.filePath,options.data);
      if(state.writeMode==='throw')throw new Error('write native throw');
      if(state.writeMode==='fail')return options.fail({errMsg:'writeFile:fail disk full'});
      options.success();
    },
    unlink(options){events.push('unlink:'+options.filePath);contents.delete(options.filePath);options.success();},
    readFile(options){
      events.push('read');state.readCalls++;
      if(!contents.has(options.filePath))return options.fail({errMsg:'readFile:fail not found'});
      options.success({data:contents.get(options.filePath)});
    }
  };
  global.wx={
    env:{USER_DATA_PATH:'/local'},
    getFileSystemManager:()=>fs,
    shareFileMessage(options){
      events.push('share');state.shareCalls++;
      if(!state.tap)return options.fail({errMsg:'shareFileMessage:fail can only be invoked by user TAP gesture'});
      if(state.shareMode==='throw')throw new Error('native invocation failed '+'.'.repeat(400));
      if(state.shareMode==='cancel')return options.fail({errMsg:'shareFileMessage:fail cancel'});
      if(state.shareMode==='fail')return options.fail({errMsg:'shareFileMessage:fail native transfer denied'});
      if(state.shareMode==='pending'){state.pendingShare=options;return;}
      options.success();
    },
    requirePrivacyAuthorize(options){events.push('privacy');state.privacy?options.success():options.fail({errMsg:'requirePrivacyAuthorize:fail privacy denied'});},
    chooseMessageFile(options){events.push('choose');state.chooseCalls++;state.extensions=options.extension;options.success({tempFiles:[{path:state.choosePath,size:state.chooseSize}]});}
  };
  delete require.cache[require.resolve(modulePath)];
  const api=require(modulePath);
  const tap=callback=>{state.tap=true;try{return callback();}finally{state.tap=false;}};
  return {api,fs,contents,events,state,tap};
}
test('preparing a backup does not share, and explicit sharing invokes the native API on the tap stack',async()=>{
  const h=setup(),prepared=await h.api.prepareExport('{"备份":"完整内容"}','json');
  assert.equal(h.state.shareCalls,0);
  assert.match(prepared.fileName,/^zjg-export-[A-Za-z0-9._-]+\.json$/);
  assert.equal(h.contents.get(prepared.filePath),'{"备份":"完整内容"}');
  await assert.rejects(h.api.sharePreparedFile(prepared),error=>error.code==='SHARE_FAILED'&&error.rawMessage.includes('TAP gesture'));
  const before=h.events.length;
  const sharing=h.tap(()=>h.api.sharePreparedFile(prepared));
  assert.equal(h.events[before],'share');
  assert.deepEqual(h.events.slice(before),['share']);
  assert.deepEqual(await sharing,{shared:true});
  assert.ok(h.contents.has(prepared.filePath));
});
test('failure, cancellation and success retain the prepared file until explicit idempotent disposal',async()=>{
  const h=setup({'/local/user-account.json':'do not delete'});
  const prepared=await h.api.prepareExport('book','json');
  h.state.shareMode='fail';
  await assert.rejects(h.tap(()=>h.api.sharePreparedFile(prepared)),error=>error.code==='SHARE_FAILED'&&error.rawMessage==='shareFileMessage:fail native transfer denied');
  assert.ok(h.contents.has(prepared.filePath));
  h.state.shareMode='cancel';
  assert.deepEqual(await h.tap(()=>h.api.sharePreparedFile(prepared)),{shared:false,cancelled:true});
  assert.ok(h.contents.has(prepared.filePath));
  h.state.shareMode='ok';
  assert.deepEqual(await h.tap(()=>h.api.sharePreparedFile(prepared)),{shared:true});
  assert.ok(h.contents.has(prepared.filePath));
  await h.api.disposePreparedFile(prepared);
  const count=h.events.filter(value=>value.startsWith('unlink:')).length;
  await h.api.disposePreparedFile(prepared);
  assert.equal(h.events.filter(value=>value.startsWith('unlink:')).length,count);
  assert.ok(!h.contents.has(prepared.filePath));
  assert.equal(h.contents.get('/local/user-account.json'),'do not delete');
});
test('native synchronous throws preserve the file and expose bounded local diagnostics',async()=>{
  const h=setup(),prepared=await h.api.prepareExport('{}','json');
  h.state.shareMode='throw';
  await assert.rejects(h.tap(()=>h.api.sharePreparedFile(prepared)),error=>error.code==='SHARE_FAILED'&&error.rawMessage.length===300&&error.rawMessage.startsWith('native invocation failed'));
  assert.ok(h.contents.has(prepared.filePath));
});
test('unsupported sharing returns an explicit fallback status without losing the prepared file',async()=>{
  const h=setup(),prepared=await h.api.prepareExport('{}','json');
  delete global.wx.shareFileMessage;
  assert.deepEqual(await h.api.sharePreparedFile(prepared),{shared:false,unsupported:true});
  assert.ok(h.contents.has(prepared.filePath));
  await h.api.disposePreparedFile(prepared);
});
test('failed replacement generation cleans only its partial file and keeps the old valid backup',async()=>{
  const h=setup(),previous=await h.api.prepareExport('original','json');
  h.state.writeMode='fail';
  await assert.rejects(h.api.prepareExport('replacement','json'),error=>error.code==='FILE_WRITE_FAILED'&&error.rawMessage==='writeFile:fail disk full');
  assert.equal(h.contents.size,1);
  assert.equal(h.contents.get(previous.filePath),'original');
  h.state.writeMode='throw';
  await assert.rejects(h.api.prepareExport('replacement','txt'),error=>error.code==='FILE_WRITE_FAILED');
  assert.equal(h.contents.size,1);
  assert.equal(h.contents.get(previous.filePath),'original');
});
test('preparation prunes only abandoned own-prefix exports and never another active export',async()=>{
  const h=setup({'/local/zjg-export-abandoned-1.json':'old','/local/user.json':'mine','/local/other-backup.txt':'mine too'});
  const first=await h.api.prepareExport('first','json');
  const second=await h.api.prepareExport('second','txt');
  assert.ok(!h.contents.has('/local/zjg-export-abandoned-1.json'));
  assert.ok(h.contents.has('/local/user.json'));
  assert.ok(h.contents.has('/local/other-backup.txt'));
  assert.equal(h.contents.get(first.filePath),'first');
  assert.equal(h.contents.get(second.filePath),'second');
  assert.notEqual(first.fileName,second.fileName);
});
test('TXT compatibility exports contain identical backup data and preserve the real file extension',async()=>{
  const h=setup(),book='{"app":"zhenjiuge","book":{"name":"臻酒阁"}}';
  const json=await h.api.prepareExport(book,'json');
  const txt=await h.api.prepareExport(book,'txt');
  assert.equal(h.contents.get(json.filePath),h.contents.get(txt.filePath));
  assert.match(txt.filePath,/\.txt$/);assert.equal(txt.extension,'txt');
  assert.equal(JSON.parse(h.contents.get(txt.filePath)).app,'zhenjiuge');
});
test('export validation rejects invalid extension, oversized UTF-8 content and missing native storage',async()=>{
  const h=setup();
  await assert.rejects(h.api.prepareExport('{}','../json'),error=>error.code==='FILE_TYPE');
  await assert.rejects(h.api.prepareExport({},'json'),error=>error.code==='FILE_CONTENT');
  await assert.rejects(h.api.prepareExport('中'.repeat(Math.floor(MAX/3)+1),'json'),error=>error.code==='FILE_TOO_LARGE');
  assert.equal(h.events.length,0);
  delete global.wx.getFileSystemManager;
  await assert.rejects(h.api.prepareExport('{}','json'),error=>error.code==='FILE_UNSUPPORTED');
});
test('unprepared or disposed descriptors cannot trigger sharing or arbitrary file deletion',async()=>{
  const h=setup({'/local/account.json':'private'});
  const forged={filePath:'/local/account.json',fileName:'account.json'};
  await assert.rejects(h.tap(()=>h.api.sharePreparedFile(forged)),error=>error.code==='FILE_NOT_PREPARED');
  await h.api.disposePreparedFile(forged);
  assert.equal(h.state.shareCalls,0);assert.equal(h.contents.get(forged.filePath),'private');
  const prepared=await h.api.prepareExport('{}','json');await h.api.disposePreparedFile(prepared);
  await assert.rejects(h.tap(()=>h.api.sharePreparedFile(prepared)),error=>error.code==='FILE_NOT_PREPARED');
});
test('JSON and TXT selection follows privacy authorization and returns UTF-8 content without mutating files',async()=>{
  const payload='{"app":"zhenjiuge","name":"赖茅传承"}';
  const h=setup({'/chosen/backup.txt':payload});
  h.state.choosePath='/chosen/backup.txt';h.state.chooseSize=Buffer.byteLength(payload,'utf8');
  assert.equal(await h.api.chooseBackupFile(),payload);
  assert.deepEqual(h.state.extensions,['json','txt']);
  assert.deepEqual(h.events,['privacy','choose','read']);
  assert.equal(h.contents.get('/chosen/backup.txt'),payload);
});
test('privacy refusal, oversized files and disguised oversized text reject before unsafe use',async()=>{
  const h=setup({'/chosen/big.txt':'中'.repeat(Math.floor(MAX/3)+1)});
  h.state.privacy=false;
  await assert.rejects(h.api.chooseBackupFile(),error=>error.code==='PRIVACY_DENIED');
  assert.equal(h.state.chooseCalls,0);
  h.state.privacy=true;h.state.choosePath='/chosen/big.txt';h.state.chooseSize=MAX+1;
  await assert.rejects(h.api.chooseBackupFile(),error=>error.code==='FILE_TOO_LARGE');
  assert.equal(h.state.readCalls,0);
  h.state.chooseSize=1;
  await assert.rejects(h.api.chooseBackupFile(),error=>error.code==='FILE_TOO_LARGE');
  assert.equal(h.state.readCalls,1);
});
test('pending native sharing does not implicitly dispose its file',async()=>{
  const h=setup(),prepared=await h.api.prepareExport('{}','json');
  h.state.shareMode='pending';
  const sharing=h.tap(()=>h.api.sharePreparedFile(prepared));
  assert.ok(h.contents.has(prepared.filePath));
  h.state.pendingShare.success();
  assert.deepEqual(await sharing,{shared:true});
  assert.ok(h.contents.has(prepared.filePath));
  await h.api.disposePreparedFile(prepared);
  assert.ok(!h.contents.has(prepared.filePath));
});
