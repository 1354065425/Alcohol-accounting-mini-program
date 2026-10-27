const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert/strict');
const root=path.resolve(__dirname,'..');
function walk(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(item=>item.isDirectory()&&!['release','node_modules','.git'].includes(item.name)?walk(path.join(dir,item.name)):item.isFile()?[path.join(dir,item.name)]:[]);}
const files=walk(root);
for(const file of files){
  const content=fs.readFileSync(file,'utf8');
  if(file.endsWith('.js'))new vm.Script(content,{filename:path.relative(root,file)});
  if(file.endsWith('.json'))JSON.parse(content);
}
const app=JSON.parse(fs.readFileSync(path.join(root,'app.json'),'utf8'));
for(const page of app.pages)for(const extension of ['js','json','wxml','wxss'])assert.ok(fs.existsSync(path.join(root,page+'.'+extension)),'Missing page file: '+page+'.'+extension);
const config=JSON.parse(fs.readFileSync(path.join(root,'project.config.json'),'utf8'));
assert.match(config.appid,/^wx[0-9a-f]{16}$/,'A real mini program AppID is required');
for(const file of files.filter(file=>file.includes(path.sep+'pages'+path.sep)&&file.endsWith('.js')))assert.ok(!/getStorageSync\(['"]cellar(Entries|Stock|LiquorCatalog)/.test(fs.readFileSync(file,'utf8')),'Page still reads legacy storage: '+file);
assert.ok(fs.existsSync(path.join(root,'assets/app-logo.png')),'Missing release logo');
const entry=fs.readFileSync(path.join(root,'app.js'),'utf8');
assert.ok(!/const seed|stockSeed/.test(entry),'Release must not create fake business data');
console.log('Release checks passed: JS/JSON syntax, '+app.pages.length+' complete routes, real AppID, unified storage and no demo seeding.');
