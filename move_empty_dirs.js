#!/usr/bin/env node
const fs = require('fs').promises;
const fssync = require('fs');
const path = require('path');

const COVER_NAMES = new Set(['cover.jpg','cover.jpeg']);

async function ensureDir(dir){
  await fs.mkdir(dir, { recursive: true }).catch(()=>{});
}

async function movePath(src, dst){
  await ensureDir(path.dirname(dst));
  try{ await fs.rename(src, dst); }
  catch(err){
    // fallback: copy then remove
    const stat = await fs.lstat(src);
    if(stat.isDirectory()){
      await copyDir(src, dst);
      await removeDirRecursive(src);
    }else{
      await fs.copyFile(src, dst);
      await fs.unlink(src);
    }
  }
}

async function copyDir(src, dst){
  await ensureDir(dst);
  const items = await fs.readdir(src, { withFileTypes: true });
  for(const it of items){
    const s = path.join(src, it.name);
    const d = path.join(dst, it.name);
    if(it.isDirectory()) await copyDir(s,d);
    else await fs.copyFile(s,d);
  }
}

async function removeDirRecursive(dir){
  const items = await fs.readdir(dir, { withFileTypes: true });
  for(const it of items){
    const p = path.join(dir, it.name);
    if(it.isDirectory()) await removeDirRecursive(p);
    else await fs.unlink(p).catch(()=>{});
  }
  await fs.rmdir(dir).catch(()=>{});
}

async function findEmptyOrCoverOnly(root){
  const matches = [];

  async function walk(dir){
    let entries;
    try{ entries = await fs.readdir(dir, { withFileTypes: true }); }
    catch(e){ return; }
    // ignore recycle dirs inside target
    if(entries.some(e=>e.isDirectory() && e.name.startsWith('.recycle_'))) return;

    // process children first
    for(const ent of entries){ if(ent.isDirectory()) await walk(path.join(dir, ent.name)); }

    // re-read entries after walking children (some children may have been moved)
    try{ entries = await fs.readdir(dir, { withFileTypes: true }); }
    catch(e){ return; }

    // skip root if same as recycle placeholder
    // count files (not counting hidden .DS_Store? we'll include .DS_Store as a file)
    const files = entries.filter(e=>e.isFile());
    const dirs = entries.filter(e=>e.isDirectory());

    // if no files and no dirs -> empty
    if(files.length === 0 && dirs.length === 0){ matches.push({ type: 'empty', path: dir }); return; }

    // if no dirs and exactly one file which is cover.jpg/jpeg (case-insensitive)
    if(dirs.length === 0 && files.length === 1){
      const name = files[0].name.toLowerCase();
      if(COVER_NAMES.has(name)){
        matches.push({ type: 'cover-only', path: dir });
      }
    }
  }

  await walk(root);
  return matches;
}

async function main(){
  const argv = require('minimist')(process.argv.slice(2));
  const target = argv.dir || argv._[0] || '/Volumes/MusicBackup';
  const doMove = !!argv.move;
  const recycleRoot = argv.recycle || path.join(target, '.recycle_empty_' + Date.now());

  console.log('扫描目标：', target);
  const matches = await findEmptyOrCoverOnly(target);
  if(matches.length===0){ console.log('未发现空目录或仅含封面的目录。'); return; }
  console.log('发现', matches.length, '个匹配目录：');
  matches.forEach((m,i)=> console.log(`${i+1}. [${m.type}] ${m.path}`));

  if(!doMove){
    console.log('\n未执行移动。若确认移动这些目录，请加参数 `--move --recycle=/path/to/recycle`。');
    return;
  }

  console.log('回收目录：', recycleRoot);
  for(const m of matches){
    const rel = path.relative(target, m.path);
    const dest = path.join(recycleRoot, rel);
    try{
      await movePath(m.path, dest);
      console.log('已移动:', m.path, '->', dest);
    }catch(err){ console.error('移动失败:', m.path, err.message); }
  }
  console.log('移动完成。若需要清空回收目录，请运行 `node retain_tracks_safe.js --empty --recycle=' + recycleRoot + '`');
}

main().catch(e=>{ console.error(e); process.exit(1); });
