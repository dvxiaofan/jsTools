#!/usr/bin/env node
const fs = require('fs').promises;
const path = require('path');

const audioExts = new Set(['.mp3','.flac','.m4a','.wav','.aac','.ape','.wma','.ogg','.alac','.aiff']);
const keywords = ['live','伴奏','纯音乐'];
const kwRegex = new RegExp(keywords.map(k=>k.replace(/[\\-\\/\\\\^$*+?.()|[\]{}]/g,'\\$&')).join('|'),'i');

function usage(){
  console.log('用法: node remove_tagged_tracks.js --dir="/path/to/dir" [--delete]');
  process.exit(1);
}

const argv = require('minimist')(process.argv.slice(2));
const targetDir = argv.dir || argv._[0] || process.cwd();
const doDelete = !!argv.delete;

async function findCandidates(dir){
  const results = [];
  async function walk(current){
    let entries;
    try{ entries = await fs.readdir(current, { withFileTypes: true }); }
    catch(err){ console.error('无法读取:', current, err.message); return; }
    const lowered = entries.map(e=>e.name.toLowerCase());
    for(const ent of entries){
      const full = path.join(current, ent.name);
      if(ent.isDirectory()){
        await walk(full);
        continue;
      }
      if(ent.isFile()){
        const ext = path.extname(ent.name).toLowerCase();
        if(!audioExts.has(ext)) continue;
        if(!kwRegex.test(ent.name)) continue;
        const base = path.basename(ent.name, ext);
        // try to find same-name .lrc (case-insensitive)
        const lrcCandidates = ['.lrc'];
        let lrcPath = null;
        for(const lExt of lrcCandidates){
          const expected = (base + lExt).toLowerCase();
          const idx = lowered.indexOf(expected);
          if(idx !== -1){
            lrcPath = path.join(current, entries[idx].name);
            break;
          }
        }
        results.push({ audio: full, lrc: lrcPath });
      }
    }
  }
  await walk(dir);
  return results;
}

async function main(){
  console.log('扫描目录:', targetDir);
  const cands = await findCandidates(targetDir);
  if(cands.length===0){
    console.log('未发现符合关键词的音频文件。');
    return;
  }
  console.log('发现', cands.length, '个候选项：');
  cands.forEach((c,i)=>{
    console.log(`${i+1}. ${c.audio}`);
    if(c.lrc) console.log(`   -> 同名 LRC: ${c.lrc}`);
  });

  if(!doDelete){
    console.log('\n未启用删除。若确认删除，请加参数 `--delete` 再运行一次。');
    return;
  }

  // 删除阶段
  for(const c of cands){
    try{
      await fs.unlink(c.audio);
      console.log('已删除音频:', c.audio);
    }catch(err){ console.error('删除音频失败:', c.audio, err.message); }
    if(c.lrc){
      try{ await fs.unlink(c.lrc); console.log('已删除 LRC:', c.lrc); }
      catch(err){ console.error('删除 LRC 失败:', c.lrc, err.message); }
    }
  }
}

main().catch(err=>{ console.error(err); process.exit(1); });
