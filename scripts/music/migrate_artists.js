
const fs = require('fs');
const path = require('path');

// --- 配置 ---
const SOURCE_BASE_DIR = '/Volumes/otherMusic';
const TARGET_BASE_DIR = '/Volumes/Music/歌手分类';
const OUTPUT_SCRIPT_NAME = 'migrate_music.sh';
const IGNORED_FILES = new Set(['.DS_Store', 'Thumbs.db']);

function main() {
    console.log('🚀 开始生成迁移脚本...');
    console.log(`源目录: ${SOURCE_BASE_DIR}`);
    console.log(`目标目录: ${TARGET_BASE_DIR}`);

    if (!fs.existsSync(SOURCE_BASE_DIR)) {
        console.error(`❌ 错误：源目录不存在: ${SOURCE_BASE_DIR}`);
        return;
    }
    if (!fs.existsSync(TARGET_BASE_DIR)) {
        console.error(`❌ 错误：目标目录不存在: ${TARGET_BASE_DIR}`);
        return;
    }

    const scriptLines = [
        '#!/bin/bash',
        '# 自动生成的音乐迁移脚本 (高速版)',
        `# 源目录: ${SOURCE_BASE_DIR}`,
        `# 目标目录: ${TARGET_BASE_DIR}`,
        '# 注意: 此脚本会覆盖目标目录中的同名文件！',
        'set -e', // 如果有命令失败则立即退出
        ''
    ];

    const artistDirs = fs.readdirSync(SOURCE_BASE_DIR, { withFileTypes: true })
        .filter(dirent => dirent.isDirectory())
        .map(dirent => dirent.name);

    console.log(`📂 发现 ${artistDirs.length} 个歌手目录在源位置。`);

    let commandsGenerated = 0;
    for (const artistName of artistDirs) {
        const sourceArtistDir = path.join(SOURCE_BASE_DIR, artistName);
        const targetArtistDir = path.join(TARGET_BASE_DIR, artistName);

        // 检查源目录是否为空
        const itemsToMove = fs.readdirSync(sourceArtistDir)
            .filter(item => !IGNORED_FILES.has(item));

        if (itemsToMove.length === 0) {
            // 如果源歌手目录为空，则跳过
            scriptLines.push(`# --- 跳过空目录: ${artistName} ---`);
            scriptLines.push('');
            continue;
        }

        scriptLines.push(`# --- 迁移歌手: ${artistName} ---`);
        
        // 1. 确保目标歌手目录存在
        scriptLines.push(`mkdir -p "${targetArtistDir}"`);
        
        // 2. 将源目录的所有内容移动到目标目录
        // 使用 'shopt -s dotglob' 来包含隐藏文件, 'shopt -u dotglob' 恢复
        // '|| true' 确保在目录为空时脚本不会因 'mv' 失败而退出
        scriptLines.push(`(shopt -s dotglob; mv "${sourceArtistDir}"/* "${targetArtistDir}/" || true)`);
        
        commandsGenerated++;
        scriptLines.push('');
    }

    if (commandsGenerated > 0) {
        const outputScriptPath = path.join(process.cwd(), OUTPUT_SCRIPT_NAME);
        fs.writeFileSync(outputScriptPath, scriptLines.join('\n'));
        fs.chmodSync(outputScriptPath, '755'); // 赋予执行权限
        console.log(`\n✅ 成功生成高速迁移脚本: ${outputScriptPath}`);
        console.log(`   包含了 ${commandsGenerated} 个歌手的迁移指令。`);
        console.log('\n👉 下一步: 请在您的终端中运行以下命令来执行迁移:');
        console.log(`   bash ${outputScriptPath}`);
    } else {
        console.log('\n✨ 源目录中没有需要迁移的内容。');
    }
}

main();
