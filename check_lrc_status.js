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
    console.log('🔍 正在验证 .lrc 歌词文件的清理状态...');
    
    if (!fs.existsSync(topsDir)) {
        console.error('❌ tops 目录不存在');
        return;
    }

    // 1. 获取 tops 中所有的 lrc 文件
    const topsLrcs = {}; // { "歌手名": [ "文件名1.lrc", ... ] }
    let lrcCount = 0;

    const artists = fs.readdirSync(topsDir);
    artists.forEach(artist => {
        const artistPath = path.join(topsDir, artist);
        if (fs.statSync(artistPath).isDirectory()) {
            const files = fs.readdirSync(artistPath);
            const lrcs = files.filter(f => f.toLowerCase().endsWith('.lrc'));
            if (lrcs.length > 0) {
                topsLrcs[artist] = lrcs;
                lrcCount += lrcs.length;
            }
        }
    });

    console.log(`✅ 在 tops 目录中找到 ${lrcCount} 个 .lrc 文件，正在检查 Music 目录是否有残留...`);

    // 2. 检查 Music 目录
    let residueCount = 0;
    let deletedCount = 0;

    const musicArtists = fs.readdirSync(musicDir);
    
    musicArtists.forEach(artist => {
        const targetArtistKey = Object.keys(topsLrcs).find(k => k.toLowerCase() === artist.toLowerCase());
        
        if (targetArtistKey) {
            const targetLrcs = new Set(topsLrcs[targetArtistKey]);
            const artistPath = path.join(musicDir, artist);
            
            if (!fs.existsSync(artistPath) || !fs.statSync(artistPath).isDirectory()) return;

            const files = findFiles(artistPath);
            
            files.forEach(filePath => {
                const fileName = path.basename(filePath);
                
                // 如果是 lrc 文件，且存在于 tops 中
                if (fileName.toLowerCase().endsWith('.lrc') && targetLrcs.has(fileName)) {
                    residueCount++;
                    
                    // 再次确认文件大小一致后删除
                    try {
                        const musicFileSize = fs.statSync(filePath).size;
                        const topsFilePath = path.join(topsDir, targetArtistKey, fileName);
                        const topsFileSize = fs.statSync(topsFilePath).size;

                        if (musicFileSize === topsFileSize) {
                            fs.unlinkSync(filePath);
                            console.log(`🗑️  补删残留歌词: [${artist}] ${fileName}`);
                            deletedCount++;
                        } else {
                            console.warn(`⚠️ 发现同名歌词但大小不一致，跳过: ${fileName}`);
                        }
                    } catch (e) {
                        console.error(`❌ 处理失败: ${filePath} - ${e.message}`);
                    }
                }
            });
        }
    });

    console.log('\n📊 歌词清理验证报告:');
    if (residueCount === 0) {
        console.log('✨ 完美！所有对应的 .lrc 歌词文件都已清理干净，没有残留。');
    } else {
        console.log(`ℹ️  发现 ${residueCount} 个残留歌词文件，已成功删除 ${deletedCount} 个。`);
    }
}

run();
