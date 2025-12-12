/**
 * 🧹 歌词文件清理工具 (LRC Cleaner)
 *
 * 作用:
 * 扫描指定目录，查找“孤立”的 .lrc 歌词文件。
 * 定义：如果一个 .lrc 文件没有对应的同名非 .lrc 文件（如同名 mp3/flac 等），则视为孤立。
 *
 * 行为:
 * 将所有孤立的 .lrc 文件移动到 _Orphaned_LRC 文件夹中，等待用户后续删除。
 *
 * 使用方法:
 * node clean_lrc.js "/path/to/music_folder"
 */

const fs = require('fs');
const path = require('path');

// 获取目标目录参数
const args = process.argv.slice(2);
const targetDir = args[0] || '.';
const absoluteTargetDir = path.resolve(targetDir);

// 孤立文件存放目录名
const ORPHAN_DIR_NAME = '_Orphaned_LRC';

console.log(`\n🧹 开始扫描孤立歌词文件: ${absoluteTargetDir}`);

function scanDirectory(dir) {
    let files;
    try {
        files = fs.readdirSync(dir);
    } catch (err) {
        console.error(`❌ 无法读取目录 ${dir}: ${err.message}`);
        return [];
    }

    // 分离文件
    const lrcFiles = [];
    const otherFilesMap = new Set(); // 存储所有非 .lrc 文件的 basename

    files.forEach(file => {
        if (file.startsWith('.') || file === 'node_modules') return;

        const fullPath = path.join(dir, file);
        let stat;
        try {
            stat = fs.statSync(fullPath);
        } catch (e) { return; }

        if (stat.isDirectory()) {
            // 递归扫描子目录 (可选，如果只想扫描当前目录，注释掉下面这行)
            scanDirectory(fullPath);
        } else if (stat.isFile()) {
            const ext = path.extname(file).toLowerCase();
            const basename = path.basename(file, path.extname(file)); // 获取无后缀文件名

            if (ext === '.lrc') {
                lrcFiles.push({
                    name: file,
                    fullPath: fullPath,
                    basename: basename
                });
            } else {
                // 记录非 lrc 文件，用于比对
                otherFilesMap.add(basename);
            }
        }
    });

    // 检查孤立 LRC
    const orphans = [];
    lrcFiles.forEach(lrc => {
        if (!otherFilesMap.has(lrc.basename)) {
            orphans.push(lrc);
        }
    });

    if (orphans.length > 0) {
        console.log(`\n📂 在目录 ${dir} 中发现 ${orphans.length} 个孤立歌词文件:`);
        
        // 准备生成的脚本内容
        const moveCommands = [];
        const orphanDirPath = path.join(process.cwd(), ORPHAN_DIR_NAME); // 统一移动到运行目录下的 _Orphaned_LRC，或者改为 dir 下

        // 策略：统一移动到根目录下的 _Orphaned_LRC 方便一次性删除
        // 或者：在每个子目录下建一个 (这样太乱了)，还是统一移动比较好。
        
        orphans.forEach(file => {
            console.log(`   📄 [孤立] ${file.name}`);
            
            // 为了防止不同目录下同名文件冲突，我们在移动时加上时间戳或父目录名
            // 这里简单处理：直接移动，如果有重名会自动覆盖（或者脚本里处理）
            // 让我们在脚本里做个简单的重命名处理
            
            if (process.platform === 'win32') {
                // Windows 批处理比较难处理重名，这里简单生成 move
                moveCommands.push(`move "${file.fullPath}" "${ORPHAN_DIR_NAME}\\"`);
            } else {
                // Bash
                 moveCommands.push(`safe_move "${file.fullPath}" "${ORPHAN_DIR_NAME}"`);
            }
        });

        // 将这些命令追加到全局列表中（这里为了简化，我们直接生成一个全局脚本）
        appendCommandsToScript(moveCommands);
    }
}

// 全局脚本内容缓存
let globalCommands = [];

function appendCommandsToScript(commands) {
    globalCommands = globalCommands.concat(commands);
}

// 开始扫描
scanDirectory(absoluteTargetDir);

// 生成最终脚本
if (globalCommands.length === 0) {
    console.log(`\n✅ 未发现孤立的歌词文件。`);
} else {
    const scriptName = process.platform === 'win32' ? 'move_orphans.bat' : 'move_orphans.sh';
    const scriptPath = path.join(process.cwd(), scriptName);
    
    const finalContent = [];

    if (process.platform === 'win32') {
        finalContent.push('@echo off');
        finalContent.push('chcp 65001');
        finalContent.push(`if not exist "${ORPHAN_DIR_NAME}" mkdir "${ORPHAN_DIR_NAME}"`);
        finalContent.push(...globalCommands);
    } else {
        finalContent.push('#!/bin/bash');
        finalContent.push(`mkdir -p "${ORPHAN_DIR_NAME}"`);
        // 定义安全移动函数
        finalContent.push(`
safe_move() {
    src="$1"
    dest_dir="$2"
    filename=$(basename "$src")
    dest="$dest_dir/$filename"

    if [ -e "$dest" ]; then
        timestamp=$(date +%s)
        # 如果重名，加上时间戳
        filename="\${filename%.*}_\${timestamp}.\${filename##*.}"
        dest="$dest_dir/$filename"
    fi

    mv "$src" "$dest"
    echo "Moved: $src -> $dest"
}
`);
        finalContent.push(...globalCommands);
    }

    try {
        fs.writeFileSync(scriptPath, finalContent.join('\n'), { mode: 0o755 });
        console.log(`\n--------------------------------------------------`);
        console.log(`🛡️  已生成清理脚本: ${scriptPath}`);
        console.log(`   运行该脚本会将所有孤立歌词移动到: ./${ORPHAN_DIR_NAME}/`);
        console.log(`   (确认无误后，你可以直接删除该文件夹)`);
    } catch (err) {
        console.error(`❌ 生成脚本失败: ${err.message}`);
    }
}
