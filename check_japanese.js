/**
 * 🇯🇵 日语歌曲识别与整理工具 (Japanese Song Detector)
 *
 * 作用:
 * 扫描指定目录，通过文件名中的“平假名”和“片假名”来识别日语歌曲。
 * 并可生成脚本将它们移动到指定目录。
 *
 * 识别原理:
 * 检测文件名中是否包含日语特有的字符区间:
 * - 平假名 (Hiragana): \u3040-\u309F
 * - 片假名 (Katakana): \u30A0-\u30FF
 * - 片假名扩展: \u31F0-\u31FF
 *
 * 注意: 仅包含汉字的日语歌名（如 "未来"）无法通过此方法与中文区分，
 * 但绝大多数日语文件名都会包含假名，因此准确率很高。
 *
 * 使用方法:
 * node check_japanese.js "/path/to/music_folder"
 *
 * 作者: devxiaofan
 */

const fs = require('fs');
const path = require('path');

// 获取目标目录参数
const args = process.argv.slice(2);
const targetDir = args[0] || '.';
const absoluteTargetDir = path.resolve(targetDir);

// 支持的音乐格式
const MUSIC_EXTS = new Set([
    '.mp3', '.flac', '.wav', '.ape', '.m4a', '.wma', '.aac', '.ogg', '.dff', '.dsf'
]);

// 日语字符正则 (平假名 + 片假名 + 扩展片假名)
const JAPANESE_REGEX = /[\u3040-\u309F\u30A0-\u30FF\u31F0-\u31FF]/;

console.log(`\n🇯🇵 开始扫描日语歌曲: ${absoluteTargetDir}`);
console.log(`🎧 支持格式: ${Array.from(MUSIC_EXTS).join(', ')}\n`);

const japaneseFiles = [];
let scannedCount = 0;

/**
 * 递归遍历目录
 */
function scanDirectory(dir) {
    let files;
    try {
        files = fs.readdirSync(dir);
    } catch (err) {
        console.error(`❌ 无法读取目录 ${dir}: ${err.message}`);
        return;
    }

    files.forEach(file => {
        // 忽略隐藏文件和 node_modules
        if (file.startsWith('.') || file === 'node_modules') return;

        const fullPath = path.join(dir, file);
        let stat;

        try {
            stat = fs.statSync(fullPath);
        } catch (err) {
            return;
        }

        if (stat.isDirectory()) {
            scanDirectory(fullPath);
        } else if (stat.isFile()) {
            const ext = path.extname(file).toLowerCase();
            if (MUSIC_EXTS.has(ext)) {
                scannedCount++;
                // 仅检测文件名 (不含路径)
                const nameWithoutExt = path.parse(file).name;

                if (JAPANESE_REGEX.test(nameWithoutExt)) {
                    japaneseFiles.push({
                        name: file,
                        fullPath: fullPath,
                        size: stat.size
                    });
                }
            }
        }
    });
}

// 执行扫描
scanDirectory(absoluteTargetDir);

// 输出结果
if (japaneseFiles.length === 0) {
    console.log(`✅ 扫描了 ${scannedCount} 个文件，未发现带有假名的日语歌曲。`);
} else {
    console.log(`🌸 扫描了 ${scannedCount} 个文件，发现 ${japaneseFiles.length} 首日语歌曲 (基于文件名假名判断)：\n`);

    const reportLines = [];
    const moveCommands = [];
    const TARGET_FOLDER_NAME = '_Japanese_Songs';

    // 准备移动脚本头部
    if (process.platform === 'win32') {
        moveCommands.push('@echo off');
        moveCommands.push('echo Start moving Japanese songs...');
        moveCommands.push(`if not exist "${TARGET_FOLDER_NAME}" mkdir "${TARGET_FOLDER_NAME}"`);
    } else {
        moveCommands.push('#!/bin/bash');
        moveCommands.push('echo "Start moving Japanese songs..."');
        moveCommands.push(`mkdir -p "${TARGET_FOLDER_NAME}"`);
        // 定义安全移动函数 (防重名)
        moveCommands.push(`
safe_move() {
    src="$1"
    dest_dir="$2"
    filename=$(basename "$src")
    dest="$dest_dir/$filename"

    if [ -e "$dest" ]; then
        timestamp=$(date +%s)
        filename="\${filename%.*}_\${timestamp}.\${filename##*.}"
        dest="$dest_dir/$filename"
    fi

    mv "$src" "$dest"
    echo "Moved: $src -> $dest"
}
`);
    }

    japaneseFiles.forEach((file, index) => {
        const sizeMB = (file.size / 1024 / 1024).toFixed(2) + ' MB';
        console.log(`   [${index + 1}] ${file.name} (${sizeMB})`);

        // 记录到报告
        reportLines.push(`${file.name}\t${file.fullPath}`);

        // 生成移动命令
        if (process.platform === 'win32') {
            moveCommands.push(`move "${file.fullPath}" "${TARGET_FOLDER_NAME}\\"`);
        } else {
            moveCommands.push(`safe_move "${file.fullPath}" "${TARGET_FOLDER_NAME}"`);
        }

        // --- 检查关联的 LRC 歌词文件 ---
        const ext = path.extname(file.name);
        const baseName = file.name.slice(0, -ext.length); // 去除后缀的文件名
        const lrcName = baseName + '.lrc';
        const lrcPath = path.join(path.dirname(file.fullPath), lrcName);

        if (fs.existsSync(lrcPath)) {
            console.log(`      📄 [关联歌词] ${lrcName}`);
            reportLines.push(`${lrcName}\t${lrcPath}`);
            if (process.platform === 'win32') {
                moveCommands.push(`move "${lrcPath}" "${TARGET_FOLDER_NAME}\\"`);
            } else {
                moveCommands.push(`safe_move "${lrcPath}" "${TARGET_FOLDER_NAME}"`);
            }
        }
    });

    // 写入脚本
    const scriptName = process.platform === 'win32' ? 'move_japanese.bat' : 'move_japanese.sh';
    const scriptPath = path.join(process.cwd(), scriptName);

    try {
        fs.writeFileSync(scriptPath, moveCommands.join('\n'), { mode: 0o755 });
        console.log(`\n--------------------------------------------------`);
        console.log(`🛡️  已生成迁移脚本: ${scriptPath}`);
        console.log(`   运行该脚本会将识别出的歌曲移动到: ./${TARGET_FOLDER_NAME}/`);
        console.log(`   (这有助于你将日语歌曲集中到一个文件夹方便管理)`);
    } catch (err) {
        console.error(`❌ 生成脚本失败: ${err.message}`);
    }
}
