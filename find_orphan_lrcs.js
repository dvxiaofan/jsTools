const fs = require('fs');
const path = require('path');

const musicDir = '/Volumes/Music';
const audioExts = new Set(['.mp3', '.flac', '.wav', '.m4a', '.ape', '.wma', '.dff', '.dsf', '.ogg', '.aac']);

function findOrphanLrcs(dir) {
    let results = [];
    let items = [];
    try {
        items = fs.readdirSync(dir);
    } catch (e) {
        // console.error(`无法读取目录: ${dir} - ${e.message}`);
        return [];
    }

    const lrcFiles = [];
    const audioBasenames = new Set();
    const subDirs = [];

    // 1. 遍历当前目录，分类文件
    items.forEach(item => {
        if (item.startsWith('.')) return; // 忽略隐藏文件

        const fullPath = path.join(dir, item);
        try {
            const stat = fs.statSync(fullPath);
            if (stat.isDirectory()) {
                subDirs.push(fullPath);
            } else {
                const ext = path.extname(item).toLowerCase();
                const basename = path.basename(item, path.extname(item)); // 获取无后缀文件名

                if (ext === '.lrc') {
                    lrcFiles.push({ path: fullPath, basename: basename });
                } else if (audioExts.has(ext)) {
                    audioBasenames.add(basename.toLowerCase()); // 存入小写以支持忽略大小写匹配
                }
            }
        } catch (e) {}
    });

    // 2. 检查 LRC 是否落单
    lrcFiles.forEach(lrc => {
        // 这里使用小写比较，稍微宽松一点，防止 "Song.mp3" 和 "song.lrc" 被误判为不匹配
        if (!audioBasenames.has(lrc.basename.toLowerCase())) {
            results.push(lrc.path);
        }
    });

    // 3. 递归处理子目录
    subDirs.forEach(subDir => {
        results = results.concat(findOrphanLrcs(subDir));
    });

    return results;
}

function run() {
    console.log(`🚀 开始扫描落单 LRC 文件...`);
    console.log(`📂 目标目录: ${musicDir}`);

    if (!fs.existsSync(musicDir)) {
        console.error('❌ Music 目录不存在');
        return;
    }

    const orphans = findOrphanLrcs(musicDir);

    console.log(`\n🔍 扫描完成!`);
    if (orphans.length > 0) {
        console.log(`⚠️ 发现 ${orphans.length} 个落单的歌词文件:`);
        
        // 预览前 20 个
        orphans.slice(0, 20).forEach(f => {
            console.log(`   📄 ${path.relative(musicDir, f)}`);
        });
        if (orphans.length > 20) {
            console.log(`   ... 等 ${orphans.length - 20} 个更多文件`);
        }

        console.log(`\n💡 建议: 如果确认这些歌词无用，可以运行脚本将其移动到待删除文件夹。`);
    } else {
        console.log(`✨ 没有发现落单的歌词文件。`);
    }
}

run();
