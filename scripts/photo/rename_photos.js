/**
 * 脚本名称: Rename Photos (照片批量重命名)
 * 功能描述: 扫描指定目录，读取照片 EXIF 拍摄日期，生成重命名脚本
 * 使用方法:
 *    node rename_photos.js [目标目录]
 * 示例:
 *    node rename_photos.js "/path/to/photos"
 *
 * 命名格式:
 *   [原文件名]_[拍摄日期YYYYMMDD]_[序号].[后缀]
 *   例如: _SC_0181.NEF -> _SC_0181_20160612_001.NEF
 *
 * 特性:
 *   - RAW+JPG 同名文件自动分组，保持序号一致
 *   - RAW 文件自动移动到 RAW/ 子目录
 *   - 优先读取 EXIF 日期，无则使用文件修改时间
 *
 * 依赖: exifr (npm install exifr)
 */

const fs = require('fs');
const path = require('path');
const exifr = require('exifr');

// ---------------------------------------------------------
// 1. 配置
// ---------------------------------------------------------

const RAW_EXTS = new Set(['.nef', '.cr2', '.arw', '.dng', '.orf', '.rw2', '.raf']);
const IMAGE_EXTS = new Set([
    ...RAW_EXTS,
    '.jpg', '.jpeg', '.png', '.tif', '.tiff', '.heic'
]);

const RAW_DIR_NAME = 'RAW'; // RAW 文件存放目录名

// ---------------------------------------------------------
// 2. 工具函数
// ---------------------------------------------------------

/**
 * 递归扫描目录
 */
function scanDirectory(dir, results = [], visited = new Set()) {
    // 防止循环引用
    let realPath;
    try {
        realPath = fs.realpathSync(dir);
    } catch (e) {
        return results;
    }
    if (visited.has(realPath)) return results;
    visited.add(realPath);

    let files;
    try {
        files = fs.readdirSync(dir);
    } catch (err) {
        return results;
    }

    files.forEach(file => {
        // 跳过隐藏文件
        if (file.startsWith('.')) return;
        // 跳过临时目录和 RAW 目录
        if (file.startsWith('_') || file === RAW_DIR_NAME) return;

        const fullPath = path.join(dir, file);
        try {
            const stat = fs.statSync(fullPath);
            if (stat.isDirectory()) {
                scanDirectory(fullPath, results, visited);
            } else if (stat.isFile()) {
                const ext = path.extname(file).toLowerCase();
                if (IMAGE_EXTS.has(ext)) {
                    results.push({
                        name: file,
                        fullPath: fullPath,
                        ext: ext
                    });
                }
            }
        } catch (e) {}
    });

    return results;
}

/**
 * 格式化日期 YYYYMMDD
 */
function formatDate(date) {
    if (!date) return null;
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}${m}${d}`;
}

// ---------------------------------------------------------
// 3. 主逻辑
// ---------------------------------------------------------

async function run() {
    const targetDir = process.argv[2] || process.cwd();
    const absoluteTargetDir = path.resolve(targetDir);

    console.log(`\n📸 照片批量重命名工具`);
    console.log(`📂 扫描目录: ${absoluteTargetDir}`);
    console.log('─'.repeat(50));

    if (!fs.existsSync(absoluteTargetDir)) {
        console.error('❌ 目标目录不存在');
        process.exit(1);
    }

    // 扫描文件
    console.log('\n⏳ 正在扫描图片文件...');
    const fileList = scanDirectory(absoluteTargetDir);

    if (fileList.length === 0) {
        console.log('\n✨ 未找到支持的图片文件');
        return;
    }

    console.log(`   找到 ${fileList.length} 个图片文件`);

    // 按文件名(不含后缀)分组，解决 RAW+JPG 同名文件需要保持序号一致的问题
    console.log('\n📦 按文件名分组 (RAW+JPG 同步)...');
    const groups = new Map();

    fileList.forEach(file => {
        const baseName = path.basename(file.name, path.extname(file.name));
        if (!groups.has(baseName)) {
            groups.set(baseName, []);
        }
        groups.get(baseName).push(file);
    });

    console.log(`   共 ${groups.size} 组照片`);

    // 读取 EXIF 并生成重命名命令
    console.log('\n🔍 读取 EXIF 日期信息...');

    const renameCommands = [];
    const isWin = process.platform === 'win32';

    // 脚本头部
    if (isWin) {
        renameCommands.push('@echo off');
        renameCommands.push('chcp 65001');
        renameCommands.push('echo Start renaming photos...');
    } else {
        renameCommands.push('#!/bin/bash');
        renameCommands.push('# 照片重命名脚本 (自动生成)');
        renameCommands.push(`# 生成时间: ${new Date().toLocaleString()}`);
        renameCommands.push(`# 扫描目录: ${absoluteTargetDir}`);
        renameCommands.push('');
        renameCommands.push('set -e');
        renameCommands.push('');
        renameCommands.push(`cd "${absoluteTargetDir}"`);
        renameCommands.push('echo "开始重命名照片..."');
        renameCommands.push('');
    }

    let counter = 1;
    let processedCount = 0;
    let rawCount = 0;

    // 遍历每一组进行处理
    for (const [baseName, files] of groups) {
        let dateStr = null;

        // 优先尝试读取这一组中任一文件的 EXIF
        for (const file of files) {
            try {
                const meta = await exifr.parse(file.fullPath, ['CreateDate', 'DateTimeOriginal']);
                if (meta) {
                    const date = meta.DateTimeOriginal || meta.CreateDate;
                    dateStr = formatDate(date);
                    if (dateStr) break;
                }
            } catch (err) {}
        }

        // 兜底：如果没有 EXIF，用第一个文件的修改时间
        if (!dateStr) {
            try {
                const stat = fs.statSync(files[0].fullPath);
                dateStr = formatDate(stat.birthtime || stat.mtime);
            } catch (e) {}
        }

        if (!dateStr) dateStr = '00000000';

        const indexStr = String(counter).padStart(3, '0');

        // 对组内的每个文件应用相同的日期和序号
        files.forEach(file => {
            const newName = `${baseName}_${dateStr}_${indexStr}${file.ext}`;
            const relPath = path.relative(absoluteTargetDir, file.fullPath);
            const dir = path.dirname(file.fullPath);
            const relDir = path.relative(absoluteTargetDir, dir);
            const isRaw = RAW_EXTS.has(file.ext);

            if (isRaw) {
                // RAW 文件移动到 RAW 子目录
                const rawDir = relDir ? `${relDir}/${RAW_DIR_NAME}` : RAW_DIR_NAME;
                rawCount++;

                if (isWin) {
                    renameCommands.push(`if not exist "${rawDir}" mkdir "${rawDir}"`);
                    renameCommands.push(`move "${relPath}" "${rawDir}\\${newName}"`);
                } else {
                    renameCommands.push(`mkdir -p "./${rawDir}"`);
                    renameCommands.push(`mv "./${relPath}" "./${rawDir}/${newName}"`);
                }
            } else {
                // 普通文件 (JPG等)
                if (file.name !== newName) {
                    const newRelPath = relDir ? `${relDir}/${newName}` : newName;

                    if (isWin) {
                        renameCommands.push(`ren "${relPath}" "${newName}"`);
                    } else {
                        renameCommands.push(`mv "./${relPath}" "./${newRelPath}"`);
                    }
                }
            }

            processedCount++;
        });

        counter++;
    }

    // 脚本尾部
    if (isWin) {
        renameCommands.push('echo Done!');
    } else {
        renameCommands.push('');
        renameCommands.push('echo ""');
        renameCommands.push('echo "✅ 重命名完成！"');
        renameCommands.push(`echo "   处理照片: ${processedCount} 张"`);
        renameCommands.push(`echo "   RAW 文件: ${rawCount} 张 (已移动到 ${RAW_DIR_NAME}/ 目录)"`);
    }

    // ---------------------------------------------------------
    // 输出报告
    // ---------------------------------------------------------
    console.log('\n' + '═'.repeat(50));
    console.log('📊 检测报告');
    console.log('═'.repeat(50));

    console.log(`\n📷 待重命名照片: ${processedCount} 张`);
    console.log(`   普通照片: ${processedCount - rawCount} 张`);
    console.log(`   RAW 文件: ${rawCount} 张 (将移动到 ${RAW_DIR_NAME}/ 目录)`);

    // ---------------------------------------------------------
    // 生成脚本
    // ---------------------------------------------------------
    console.log('\n' + '═'.repeat(50));
    console.log('📝 生成重命名脚本');
    console.log('═'.repeat(50));

    const scriptName = isWin ? '_rename_photos.bat' : '_rename_photos.sh';
    const scriptPath = path.join(absoluteTargetDir, scriptName);

    fs.writeFileSync(scriptPath, renameCommands.join('\n'), { mode: 0o755 });
    console.log(`\n✅ 重命名脚本已生成: ${scriptPath}`);
    console.log('\n执行重命名:');
    console.log(`   cd "${absoluteTargetDir}"`);
    console.log(`   ${isWin ? '' : 'bash '}${scriptName}`);

    // 统计
    console.log(`\n📊 统计:`);
    console.log(`   照片分组: ${groups.size} 组`);
    console.log(`   待处理文件: ${processedCount} 个`);
    console.log(`   RAW 文件: ${rawCount} 个`);
}

// ---------------------------------------------------------
// 执行
// ---------------------------------------------------------
run().catch(err => {
    console.error('❌ 错误:', err.message);
    process.exit(1);
});
