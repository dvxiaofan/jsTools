const fs = require('fs');
const path = require('path');

const topsDir = path.join(__dirname, 'tops');
const musicDir = '/Volumes/Music';

// 递归查找文件
function findFiles(dir) {
    let results = [];
    let list = [];
    try {
        list = fs.readdirSync(dir);
    } catch (e) {
        return [];
    }
    
    list.forEach(file => {
        file = path.join(dir, file);
        try {
            const stat = fs.statSync(file);
            if (stat && stat.isDirectory()) {
                results = results.concat(findFiles(file));
            } else {
                results.push(file);
            }
        } catch (e) {
            // ignore
        }
    });
    return results;
}

function run() {
    console.log('🔍 开始检查重复文件...');
    
    if (!fs.existsSync(topsDir)) {
        console.error('❌ tops 目录不存在');
        return;
    }

    // 1. 建立 tops 目录的文件索引
    // 结构: { "歌手名": Set("文件名1", "文件名2", ...) }
    const topsIndex = {};
    let topsFileCount = 0;

    const artists = fs.readdirSync(topsDir);
    artists.forEach(artist => {
        const artistPath = path.join(topsDir, artist);
        if (fs.statSync(artistPath).isDirectory()) {
            topsIndex[artist] = new Set();
            const files = fs.readdirSync(artistPath);
            files.forEach(f => {
                if (!f.startsWith('.')) { // 忽略 .DS_Store
                    topsIndex[artist].add(f);
                    topsFileCount++;
                }
            });
        }
    });

    console.log(`✅ 已索引 tops 目录: ${Object.keys(topsIndex).length} 位歌手, ${topsFileCount} 个文件`);

    // 2. 遍历 Music 目录查找重复
    let duplicateCount = 0;
    const duplicates = [];

    // 只检查在 topsIndex 中存在的歌手
    const musicArtists = fs.readdirSync(musicDir);
    
    musicArtists.forEach(artist => {
        // 尝试匹配歌手名 (不区分大小写)
        const targetArtistKey = Object.keys(topsIndex).find(k => k.toLowerCase() === artist.toLowerCase());
        
        if (targetArtistKey) {
            const artistPath = path.join(musicDir, artist);
            if (!fs.statSync(artistPath).isDirectory()) return;

            // 获取该歌手在 Music 目录下的所有文件
            const files = findFiles(artistPath);
            
            files.forEach(filePath => {
                const fileName = path.basename(filePath);
                if (topsIndex[targetArtistKey].has(fileName)) {
                    duplicates.push({
                        artist: artist,
                        file: fileName,
                        path: filePath
                    });
                    duplicateCount++;
                }
            });
        }
    });

    // 3. 输出结果
    console.log('\n📊 检查结果:');
    if (duplicateCount === 0) {
        console.log('✨ 完美！没有发现残留的重复文件。');
    } else {
        console.log(`⚠️ 发现 ${duplicateCount} 个重复文件 (已移动到 tops 但仍存在于 Music 中):`);
        duplicates.forEach(d => {
            console.log(`   - [${d.artist}] ${d.file}`);
            console.log(`     路径: ${d.path}`);
        });
    }
}

run();
