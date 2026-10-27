const MAX_FILE_BYTES=4*1024*1024;
const EXPORT_PREFIX='zjg-export-';
const activePaths=new Set();
let exportSequence=0;

function exportError(message,code,cause){
  const error=new Error(message);
  error.code=code;
  const detail=typeof cause==='string'?cause:cause&&(cause.errMsg||cause.message);
  error.rawMessage=String(detail||'').slice(0,300);
  return error;
}
function byteLength(text){
  let bytes=0;
  for(let index=0;index<text.length;index++){
    const code=text.charCodeAt(index);
    if(code<0x80)bytes++;
    else if(code<0x800)bytes+=2;
    else if(code>=0xd800&&code<=0xdbff&&index+1<text.length&&text.charCodeAt(index+1)>=0xdc00&&text.charCodeAt(index+1)<=0xdfff){bytes+=4;index++;}
    else bytes+=3;
  }
  return bytes;
}
function bestEffortUnlink(fs,filePath){
  return new Promise(resolve=>{
    if(!fs||typeof fs.unlink!=='function')return resolve();
    try{fs.unlink({filePath,success:resolve,fail:resolve});}catch(error){resolve();}
  });
}
function pruneExports(fs,directory){
  return new Promise(resolve=>{
    if(typeof fs.readdir!=='function'||typeof fs.unlink!=='function')return resolve();
    try{
      fs.readdir({dirPath:directory,success(result){
        const files=result&&Array.isArray(result.files)?result.files:[];
        const stale=files.filter(name=>/^zjg-export-[A-Za-z0-9._-]+\.(json|txt|csv)$/.test(name))
          .map(name=>directory+'/'+name).filter(filePath=>!activePaths.has(filePath));
        Promise.all(stale.map(filePath=>bestEffortUnlink(fs,filePath))).then(()=>resolve());
      },fail:()=>resolve()});
    }catch(error){resolve();}
  });
}
function prepareExport(content,extension){
  return new Promise((resolve,reject)=>{
    const suffix=typeof extension==='string'?extension.toLowerCase():'';
    if(!['json','txt','csv'].includes(suffix))return reject(exportError('不支持这个导出文件格式','FILE_TYPE'));
    if(typeof content!=='string')return reject(exportError('导出内容格式不正确','FILE_CONTENT'));
    if(byteLength(content)>MAX_FILE_BYTES)return reject(exportError('导出文件不能超过4MB','FILE_TOO_LARGE'));
    if(typeof wx.getFileSystemManager!=='function'||!wx.env||!wx.env.USER_DATA_PATH)return reject(exportError('当前微信不支持文件导出','FILE_UNSUPPORTED'));
    let fs;
    try{fs=wx.getFileSystemManager();}catch(error){return reject(exportError('无法访问微信文件存储','FILE_UNSUPPORTED',error));}
    if(!fs||typeof fs.writeFile!=='function')return reject(exportError('当前微信不支持文件导出','FILE_UNSUPPORTED'));
    const directory=String(wx.env.USER_DATA_PATH).replace(/\/$/,'');
    const fileName=EXPORT_PREFIX+Date.now()+'-'+(++exportSequence)+'-'+Math.random().toString(36).slice(2,8)+'.'+suffix;
    const filePath=directory+'/'+fileName;
    activePaths.add(filePath);
    const failed=error=>{
      activePaths.delete(filePath);
      bestEffortUnlink(fs,filePath).then(()=>reject(exportError('文件生成失败，请检查微信存储空间','FILE_WRITE_FAILED',error)));
    };
    pruneExports(fs,directory).then(()=>{
      try{
        fs.writeFile({filePath,data:content,encoding:'utf8',
          success:()=>resolve({filePath,fileName,extension:suffix}),
          fail:failed});
      }catch(error){failed(error);}
    });
  });
}
function sharePreparedFile(prepared){
  return new Promise((resolve,reject)=>{
    if(!prepared||typeof prepared.filePath!=='string'||typeof prepared.fileName!=='string'||!activePaths.has(prepared.filePath))return reject(exportError('备份文件已失效，请重新导出','FILE_NOT_PREPARED'));
    if(typeof wx.shareFileMessage!=='function')return resolve({shared:false,unsupported:true});
    try{
      // Keep this native call on the user's tap stack: no async file I/O precedes it.
      wx.shareFileMessage({filePath:prepared.filePath,fileName:prepared.fileName,
        success:()=>resolve({shared:true}),
        fail:error=>{
          const raw=String(error&&(error.errMsg||error.message)||'');
          if(/cancel|取消/i.test(raw))return resolve({shared:false,cancelled:true});
          reject(exportError('文件分享未完成，请重试','SHARE_FAILED',error));
        }});
    }catch(error){reject(exportError('文件分享未完成，请重试','SHARE_FAILED',error));}
  });
}
function disposePreparedFile(prepared){
  if(!prepared||!activePaths.has(prepared.filePath))return Promise.resolve();
  activePaths.delete(prepared.filePath);
  let fs;
  try{fs=wx.getFileSystemManager();}catch(error){return Promise.resolve();}
  return bestEffortUnlink(fs,prepared.filePath);
}
function chooseBackupFile(){
  return new Promise((resolve,reject)=>{
    if(typeof wx.chooseMessageFile!=='function'||typeof wx.getFileSystemManager!=='function')return reject(exportError('当前微信不支持选择文件','FILE_PICK_UNSUPPORTED'));
    const choose=()=>{
      try{
        wx.chooseMessageFile({count:1,type:'file',extension:['json','txt'],success(result){
          const file=result&&result.tempFiles&&result.tempFiles[0];
          if(!file||typeof file.path!=='string'||!file.path)return reject(exportError('未选择有效文件','FILE_NOT_SELECTED'));
          if(file.size!==undefined&&(!Number.isFinite(file.size)||file.size<0||file.size>MAX_FILE_BYTES))return reject(exportError('备份文件不能超过4MB','FILE_TOO_LARGE'));
          try{
            const fs=wx.getFileSystemManager();
            if(!fs||typeof fs.readFile!=='function')return reject(exportError('当前微信不支持读取文件','FILE_PICK_UNSUPPORTED'));
            fs.readFile({filePath:file.path,encoding:'utf8',success(result){
              if(!result||typeof result.data!=='string')return reject(exportError('备份内容不是有效文本','FILE_CONTENT'));
              if(byteLength(result.data)>MAX_FILE_BYTES)return reject(exportError('备份文件不能超过4MB','FILE_TOO_LARGE'));
              resolve(result.data);
            },fail:error=>reject(exportError('文件读取失败，请重新选择','FILE_READ_FAILED',error))});
          }catch(error){reject(exportError('文件读取失败，请重新选择','FILE_READ_FAILED',error));}
        },fail:error=>reject(exportError(/cancel|取消/i.test(String(error&&error.errMsg||''))?'已取消选择':'文件选择未完成，请重试','FILE_PICK_FAILED',error))});
      }catch(error){reject(exportError('文件选择未完成，请重试','FILE_PICK_FAILED',error));}
    };
    if(typeof wx.requirePrivacyAuthorize==='function'){
      try{wx.requirePrivacyAuthorize({success:choose,fail:error=>reject(exportError('请先同意文件恢复所需的隐私保护指引','PRIVACY_DENIED',error))});}
      catch(error){reject(exportError('请先同意文件恢复所需的隐私保护指引','PRIVACY_DENIED',error));}
    }else choose();
  });
}
module.exports={prepareExport,sharePreparedFile,disposePreparedFile,chooseBackupFile};
