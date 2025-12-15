const fs = require('fs');
const path = require('path');

const musicDir = '/Volumes/Music';

function isCover(filename) {
    return filename.toLowerCase() === 'cover.jpg';
}

function scanForEmptyDirs(dir) {
    let emptyDirs = [];
    
    let items;
    try {
        items = fs.readdirSync(dir);
    } catch (e) {
        // console.error(`无法读取目录: ${dir} - ${e.message}`);
        return [];
    }

    let subDirs = [];
    let files = [];

    items.forEach(item => {
        if (item === '.DS_Store') return; // 忽略系统文件
        
        const fullPath = path.join(dir, item);
        try {
            const stat = fs.statSync(fullPath);
            if (stat.isDirectory()) {
                subDirs.push(fullPath);
            } else {
                files.push(item);
            }
        } catch (e) {
            // ignore broken links etc
        }
    });

    // 先递归处理子目录
    subDirs.forEach(subDir => {
        emptyDirs = emptyDirs.concat(scanForEmptyDirs(subDir));
    });

    // 检查当前目录是否符合“空”的定义
    // 定义：没有子目录（或者子目录也是空的？脚本逻辑简单点，只看物理存在），且文件只有 cover.jpg 或无文件
    
    // 注意：如果子目录被标记为empty，当前目录不算empty，除非我们真的删除了子目录。
    // 用户只是要求“列出来”，所以我们只列出“当前状态下”看起来空的叶子节点或近似叶子节点。
    // 如果一个目录下还有一个空目录，严格来说它不是“空”的（因为它包含一个目录）。
    // 我们只报告最底层的空目录。
    
    if (subDirs.length === 0) {
        // 没有子目录，检查文件
        const isEffectiveEmpty = files.every(f => isCover(f));
        
        if (files.length === 0) {
            emptyDirs.push({ path: dir, reason: 'Empty' });
        } else if (isEffectiveEmpty) {
            emptyDirs.push({ path: dir, reason: 'Only cover.jpg' });
        }
    }

    return emptyDirs;
}

function run() {
    console.log(`🔍 正在扫描 ${musicDir} ...`);
    const results = scanForEmptyDirs(musicDir);

    if (results.length === 0) {
        console.log('✅ 未发现符合条件的空文件夹。');
    } else {
        console.log(`⚠️ 发现 ${results.length} 个空文件夹 (或仅含 cover.jpg):`);
        results.forEach(item => {
            console.log(`[${item.reason}] ${item.path}`);
        });
        
        // 生成一个删除脚本的建议？或者只是列出。
        console.log('\n💡 如果需要删除这些文件夹，请告诉我，我可以为您编写清理脚本。');
    }
}

run();
