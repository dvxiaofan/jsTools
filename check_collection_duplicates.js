const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const targetDir = '/Volumes/Music/其他合集';

// 递归查找所有文件
function findFiles(dir) {
    let results = [];
    let list = [];
    try {
        list = fs.readdirSync(dir);
    } catch (e) {
        return [];
    }
    
    list.forEach(file => {
        if (file.startsWith('.')) return; // 忽略 .DS_Store 等
        
        const fullPath = path.join(dir, file);
        try {
            const stat = fs.statSync(fullPath);
            if (stat.isDirectory()) {
                results = results.concat(findFiles(fullPath));
            } else {
                results.push(fullPath);
            }
        } catch (e) {}
    });
    return results;
}

// 计算文件 MD5
function getFileHash(filePath) {
    try {
        const buffer = fs.readFileSync(filePath);
        const hash = crypto.createHash('md5');
        hash.update(buffer);
        return hash.digest('hex');
    } catch (e) {
        return null;
    }
}

// 解析文件名获取 (歌手, 歌名)
function parseSongInfo(fileName) {
    const ext = path.extname(fileName);
    const nameNoExt = path.basename(fileName, ext);
    
    let artist = '';
    let title = '';

    // 模式 1: "歌手 - 歌名" 或 "歌手-歌名"
    if (nameNoExt.includes('-')) {
        const parts = nameNoExt.split('-');
        if (parts.length >= 2) {
            // 假设第一部分是歌手，第二部分是歌名 (常见的 "Artist - Title")
            // 但有时也可能是 "Title - Artist"，不过在这个集合里 "刘德华-中国人" 看起来是 Artist-Title
            artist = parts[0].trim();
            title = parts[1].trim();
        }
    } 
    // 模式 2: "03 勇气（梁静茹）" 或 "歌名(歌手)"
    else if (/[（(]/.test(nameNoExt) && /[)）]/.test(nameNoExt)) {
        // 提取括号内的内容作为歌手
        const match = nameNoExt.match(/^(\d+\s+)?(.+?)[（(](.+?)[)）]$/);
        if (match) {
            // match[1] 是数字前缀 (可能 undefined)
            // match[2] 是歌名
            // match[3] 是歌手
            title = match[2].trim();
            artist = match[3].trim();
        } else {
            // 简单尝试拆分
            const p1 = nameNoExt.indexOf('（');
            const p2 = nameNoExt.indexOf('(');
            const p = (p1 > -1) ? p1 : p2;
            if (p > -1) {
                title = nameNoExt.substring(0, p).trim();
                // 去掉前面的数字? "03 勇气" -> "勇气"
                title = title.replace(/^\d+\s+/, '');
                
                let rest = nameNoExt.substring(p + 1);
                rest = rest.replace(/[)）]/, '');
                artist = rest.trim();
            }
        }
    } else {
        // 无法解析，直接用文件名作为 title
        title = nameNoExt;
    }

    return {
        artist: artist || 'Unknown',
        title: title || nameNoExt,
        original: fileName
    };
}

function run() {
    console.log(`🚀 开始扫描: ${targetDir}`);
    
    if (!fs.existsSync(targetDir)) {
        console.error('❌ 目标目录不存在');
        return;
    }

    const allFiles = findFiles(targetDir);
    console.log(`📁 找到 ${allFiles.length} 个文件`);

    // ---------------------------------------------------------
    // 1. 完全重复文件检测 (基于 Size + MD5)
    // ---------------------------------------------------------
    console.log('\n🔒 正在检测完全重复文件 (内容一致)...');
    
    const sizeMap = new Map();
    allFiles.forEach(f => {
        try {
            const size = fs.statSync(f).size;
            if (!sizeMap.has(size)) sizeMap.set(size, []);
            sizeMap.get(size).push(f);
        } catch(e) {}
    });

    const exactDuplicates = [];
    
    for (const [size, files] of sizeMap) {
        if (files.length > 1) {
            // 大小相同，检查 MD5
            const hashMap = new Map();
            files.forEach(f => {
                const hash = getFileHash(f);
                if (hash) {
                    if (!hashMap.has(hash)) hashMap.set(hash, []);
                    hashMap.get(hash).push(f);
                }
            });

            for (const [hash, group] of hashMap) {
                if (group.length > 1) {
                    exactDuplicates.push({
                        size: size,
                        hash: hash,
                        files: group
                    });
                }
            }
        }
    }

    if (exactDuplicates.length > 0) {
        console.log(`⚠️ 发现 ${exactDuplicates.length} 组 完全重复文件:`);
        exactDuplicates.forEach((d, idx) => {
            console.log(`\n   [组 ${idx + 1}] 大小: ${(d.size/1024/1024).toFixed(2)}MB`);
            d.files.forEach(f => console.log(`      ${path.relative(targetDir, f)}`));
        });
    } else {
        console.log('✨ 未发现完全重复的文件。');
    }

    // ---------------------------------------------------------
    // 2. 疑似重复歌曲检测 (基于 歌手+歌名)
    // ---------------------------------------------------------
    console.log('\n🎵 正在检测疑似重复歌曲 (同名不同文件)...');

    const songMap = new Map(); // Key: "Artist|Title" -> [files]

    allFiles.forEach(f => {
        // 忽略非音频文件
        if (!/\.(mp3|m4a|flac|wav|wma|ape)$/i.test(f)) return;

        const info = parseSongInfo(path.basename(f));
        if (info.title && info.title !== 'Unknown') {
            // 归一化 Key: 小写，去除标点
            const cleanArtist = info.artist.toLowerCase().replace(/\s+/g, '');
            const cleanTitle = info.title.toLowerCase().replace(/\s+/g, '');
            
            // 如果解析不出歌手，只按歌名分组风险太大，暂时只处理有歌手的
            // 或者：如果是 "Unknown" 歌手，key 只有 title
            // 这里为了准确性，优先处理 (Artist+Title) 匹配
            
            let key = '';
            if (cleanArtist && cleanArtist !== 'unknown') {
                key = `${cleanArtist}|${cleanTitle}`;
            } else {
                // 如果没有歌手名，可能不适合作为重复判断依据 (同名歌太多)，除非文件名很长
                if (cleanTitle.length > 4) {
                    key = `unknown|${cleanTitle}`;
                } else {
                    return; // 跳过短歌名且无歌手的文件
                }
            }

            if (!songMap.has(key)) songMap.set(key, []);
            songMap.get(key).push({
                path: f,
                info: info,
                size: fs.statSync(f).size
            });
        }
    });

    let semanticDuplicateCount = 0;
    console.log('\n📋 疑似重复歌曲列表:');
    
    for (const [key, items] of songMap) {
        if (items.length > 1) {
            // 排除掉已经在 "完全重复" 里报告过的 (虽然逻辑上它们也是疑似重复)
            // 这里只列出 "内容不同 但 歌名相同" 的情况，或者混合列出
            
            // 简单打印所有组
            const [artist, title] = key.split('|');
            console.log(`\n   🎤 ${artist === 'unknown' ? '未知歌手' : items[0].info.artist} - ${title} (${items.length} 首)`);
            items.forEach(item => {
                const relativePath = path.relative(targetDir, item.path);
                const sizeMB = (item.size / 1024 / 1024).toFixed(2);
                console.log(`      📄 ${relativePath} (${sizeMB} MB)`);
            });
            semanticDuplicateCount++;
        }
    }

    if (semanticDuplicateCount === 0) {
        console.log('✨ 未发现疑似重复的歌曲。');
    } else {
        console.log(`\n⚠️ 共发现 ${semanticDuplicateCount} 组疑似重复歌曲。`);
    }
}

run();
