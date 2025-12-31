#!/usr/bin/env node
const fs = require('fs').promises;
const fssync = require('fs');
const path = require('path');

const audioExts = new Set(['.mp3','.flac','.m4a','.wav','.aac','.ape','.wma','.ogg','.alac','.aiff']);

const mapping = {
  '吕莘': ['365节','懒惰虫','深呼吸','完啦完啦','我想回家','陪你到底','流浪者','老朋友','小人国','第一支舞'],
  'Gareth.T': ['劲浪漫超温馨','紧急联络人','国际孤独等级','用背脊唱情歌','boyfriend material','去北极忘记你','偶像已死','笑住喊','遇上你之前的我','November Rain'],
  '張智成': ['凌晨三点钟','May I Love You','你爱上的我','末日之恋','May I Love U','寂寞有罪','换日线','Wish You Well','凌晨三点钟 (戴佩妮版)','诗人']
};

function normalize(s){
  if(!s) return '';
  s = s.toString().normalize('NFKC');
  s = s.toLowerCase();
  s = s.replace(/\p{P}|\p{S}/gu, ' ');
  s = s.replace(/\s+/g,' ').trim();
  return s;
}

function shouldKeepFilename(base, keepList){
  const nb = normalize(base);
  for(const k of keepList){
    const nk = normalize(k);
    if(!nk) continue;
    if(nb === nk) return true;
    if(nb.includes(nk) || nk.includes(nb)) return true;
  }
  return false;
}

async function findToDelete(rootDir){
  const keys = Object.keys(mapping);
  const toDelete = [];

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

      const segments = full.split(path.sep).map(s=>normalize(s));
      let matched = null;
      for(const k of keys){ if(segments.some(seg=>seg.includes(normalize(k)))){ matched = k; break; } }
      if(!matched) continue;
      const keepList = mapping[matched];
      if(!shouldKeepFilename(base, keepList)){
        toDelete.push({ path: full, ext, base });
      }
    }
  }

  await walk(rootDir);
  return toDelete;
}

async function ensureDir(dir){
  await fs.mkdir(dir, { recursive: true }).catch(()=>{});
}

async function moveFile(src, dst){
  await ensureDir(path.dirname(dst));
  try{
    await fs.rename(src, dst);
  }catch(err){
    // fallback: copy then unlink
    await fs.copyFile(src, dst);
    await fs.unlink(src);
  }
}

async function main(){
  const argv = require('minimist')(process.argv.slice(2));
  const target = argv.dir || argv._[0] || '/Volumes/MusicBackup';
  const doMove = !!argv.move;
  const doEmpty = !!argv.empty;
  const recycleRoot = argv.recycle || path.join(target, '.recycle_' + Date.now());

  if(doEmpty){
    // empty recycleRoot after confirmation
    if(!fssync.existsSync(recycleRoot)){
      console.log('回收目录不存在：', recycleRoot); return;
    }
    console.log('清空回收目录：', recycleRoot);
    const rimraf = async dir=>{
      const items = await fs.readdir(dir, { withFileTypes:true });
      for(const it of items){
        const p = path.join(dir, it.name);
        if(it.isDirectory()) await rimraf(p);
        else await fs.unlink(p).catch(()=>{});
      }
      await fs.rmdir(dir).catch(()=>{});
    };
    await rimraf(recycleRoot).catch(e=>console.error(e));
    console.log('已清空并移除回收目录');
    return;
  }

  console.log('扫描（保留名单）目标：', target);
  const list = await findToDelete(target);
  if(list.length===0){ console.log('未找到将被删除的文件。'); return; }
  console.log('找到', list.length, '项（将被移动到回收目录）：');
  list.forEach((it,i)=> console.log(`${i+1}. ${it.path}`));

  if(!doMove){
    console.log('\n未执行移动。若确认将这些文件移动到回收目录，请加 `--move --recycle=/path/to/recycle` 参数。');
    return;
  }

  console.log('回收目录：', recycleRoot);
  for(const it of list){
    const rel = path.relative(target, it.path);
    const dest = path.join(recycleRoot, rel);
    try{ await moveFile(it.path, dest); console.log('已移动:', it.path, '->', dest); }
    catch(err){ console.error('移动失败:', it.path, err.message); }
  }
  console.log('移动完成。确认无误后可使用 `--empty --recycle=' + recycleRoot + '` 来清空回收目录。');
}

main().catch(e=>{ console.error(e); process.exit(1); });
