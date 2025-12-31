#!/usr/bin/env node
const fs = require('fs').promises;
const path = require('path');

const audioExts = new Set(['.mp3','.flac','.m4a','.wav','.aac','.ape','.wma','.ogg','.alac','.aiff']);

const mapping = {
  '吕莘': [
    '365节','懒惰虫','深呼吸','完啦完啦','我想回家','陪你到底','流浪者','老朋友','小人国','第一支舞'
  ],
  'Gareth.T': [
    '劲浪漫超温馨','紧急联络人','国际孤独等级','用背脊唱情歌','boyfriend material','去北极忘记你','偶像已死','笑住喊','遇上你之前的我','November Rain'
  ],
  '張智成': [
    '凌晨三点钟','May I Love You','你爱上的我','末日之恋','May I Love U','寂寞有罪','换日线','Wish You Well','凌晨三点钟 (戴佩妮版)','诗人'
  ]
};

function normalize(s){
  if(!s) return '';
  s = s.normalize('NFKC');
  s = s.toLowerCase();
  // remove punctuation and symbol characters
  s = s.replace(/\p{P}|\p{S}/gu, ' ');
  s = s.replace(/\s+/g,' ').trim();
  return s;
}

function shouldKeepFilename(base, keepList){
  const nb = normalize(base);
  for(const k of keepList){
    const nk = normalize(k);
    if(nk.length===0) continue;
    if(nb === nk) return true;
    if(nb.includes(nk) || nk.includes(nb)) return true;
  }
  return false;
}

async function scanAndPlan(rootDir){
  const toDelete = [];
  const keys = Object.keys(mapping);

  async function walk(current){
    let entries;
    try{ entries = await fs.readdir(current, { withFileTypes: true }); }
    catch(err){ return; }
    for(const ent of entries){
      const full = path.join(current, ent.name);
      if(ent.isDirectory()){
        await walk(full);
        continue;
      }
      if(!ent.isFile()) continue;
      const ext = path.extname(ent.name).toLowerCase();
      const base = path.basename(ent.name, ext);

      if(!audioExts.has(ext) && ext !== '.lrc') continue;

      // determine which artist this file belongs to by checking path segments
      const pathSegments = full.split(path.sep).map(s=>normalize(s));
      let matchedKey = null;
      for(const k of keys){
        const nk = normalize(k);
        if(pathSegments.some(seg => seg.includes(nk))) { matchedKey = k; break; }
      }
      if(!matchedKey) continue;
      const keepList = mapping[matchedKey];

      if(ext === '.lrc'){
        if(!shouldKeepFilename(base, keepList)){
          toDelete.push({ type: 'lrc', path: full, dir: current, base });
        }
      }else{
        if(!shouldKeepFilename(base, keepList)){
          toDelete.push({ type: 'audio', path: full, dir: current, base });
        }
      }
    }
  }

  await walk(rootDir);
  return toDelete;
}

async function main(){
  const argv = require('minimist')(process.argv.slice(2));
  const target = argv.dir || argv._[0] || '/Volumes/MusicBackup';
  const doDelete = !!argv.delete;
  console.log('扫描并保留映射中列出的歌曲，目标目录：', target);
  const plan = await scanAndPlan(target);
  if(plan.length===0){ console.log('未找到需要删除的文件。'); return; }
  console.log('将要删除的文件（共', plan.length, '项）：');
  plan.forEach((p,i)=>{
    console.log(`${i+1}. [${p.type}] ${p.path}`);
  });
  if(!doDelete){
    console.log('\n当前为演示模式；若确认删除，请使用 `--delete` 参数再运行一次。');
    return;
  }
  for(const p of plan){
    try{ await fs.unlink(p.path); console.log('已删除:', p.path); }
    catch(err){ console.error('删除失败:', p.path, err.message); }
  }
}

main().catch(e=>{ console.error(e); process.exit(1); });
