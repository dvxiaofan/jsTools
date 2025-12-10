/**
 * 📸 批量照片重命名工具 (Photo Batch Renamer)
 *
 * 作用:
 * 扫描指定目录下的图片文件，读取拍摄日期，并生成重命名脚本。
 *
 * 命名格式:
 * [原文件名]_[拍摄日期YYYYMMDD]_[序号].[后缀]
 * 例如: _SC_0181.NEF -> _SC_0181_20160612_001.NEF
 *
 * 使用方法:
 * node rename_photos.js "/path/to/photos"
 */

const fs = require('fs');
const path = require('path');
const exifr = require('exifr');

// 获取目标目录参数
const args = process.argv.slice(2);
const targetDir = args[0] || '.';
const absoluteTargetDir = path.resolve(targetDir);

// 支持的图片格式
const RAW_EXTS = new Set(['.nef', '.cr2', '.arw', '.dng', '.orf']);
const IMAGE_EXTS = new Set([
    ...RAW_EXTS,
    '.jpg', '.jpeg', '.png', '.tif', '.tiff', '.heic'
]);

const RAW_DIR_NAME = 'RAW'; // RAW 文件存放目录名

let processedCount = 0;
let fileList = [];

// 递归扫描目录
function scanDirectory(dir) {
    let files;
    try {
        files = fs.readdirSync(dir);
    } catch (err) {
        console.error(`❌ 无法读取目录 ${dir}: ${err.message}`);
        return;
    }

    files.forEach(file => {
        if (file.startsWith('.') || file === 'node_modules') return;

        const fullPath = path.join(dir, file);
        let stat;
        try {
            stat = fs.statSync(fullPath);
        } catch (e) { return; }

        if (stat.isDirectory()) {
            scanDirectory(fullPath);
        } else if (stat.isFile()) {
            const ext = path.extname(file).toLowerCase();
            if (IMAGE_EXTS.has(ext)) {
                fileList.push({
                    name: file,
                    fullPath: fullPath,
                    ext: ext
                });
            }
        }
    });
}

// 格式化日期 YYYYMMDD
function formatDate(date) {
    if (!date) return null;
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}${m}${d}`;
}

async function generateRenameScript() {
    console.log(`\n📂 正在扫描目录: ${absoluteTargetDir} ...`);
    scanDirectory(absoluteTargetDir);

    if (fileList.length === 0) {
        console.log('⚠️ 未找到支持的图片文件。');
        return;
    }

    console.log(`🔍 找到 ${fileList.length} 个图片文件，正在进行分组处理...`);

    // 1. 按文件名(不含后缀)分组，解决 RAW+JPG 同名文件需要保持序号一致的问题
    const groups = new Map();

    fileList.forEach(file => {
        const baseName = path.basename(file.name, path.extname(file.name));
        if (!groups.has(baseName)) {
            groups.set(baseName, []);
        }
        groups.get(baseName).push(file);
    });

    console.log(`📦 共识别出 ${groups.size} 组照片 (自动合并 RAW+JPG)`);

    const renameCommands = [];

    // 脚本头部
    if (process.platform === 'win32') {
        renameCommands.push('@echo off');
        renameCommands.push('chcp 65001'); // 防止中文乱码
        renameCommands.push('echo Start renaming photos...');
    } else {
        renameCommands.push('#!/bin/bash');
        renameCommands.push('echo "Start renaming photos..."');
    }

    let counter = 1;

    // 2. 遍历每一组进行处理
    for (const [baseName, files] of groups) {
        let dateStr = null;

        // 优先尝试读取这一组中任一文件的 EXIF
        // 通常 RAW 文件信息更全，但为了速度，只要读到一个就行
        for (const file of files) {
            try {
                const meta = await exifr.parse(file.fullPath, ['CreateDate', 'DateTimeOriginal']);
                if (meta) {
                    const date = meta.DateTimeOriginal || meta.CreateDate;
                    dateStr = formatDate(date);
                    if (dateStr) break; // 读到了就停止
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

        // 对组内的每个文件应用相同的 日期 和 序号
        files.forEach(file => {
            // 格式: 原名(无后缀)_日期_序号.后缀
            // 注意：这里原名直接使用 baseName，确保同组文件前缀一致
            const newName = `${baseName}_${dateStr}_${indexStr}${file.ext}`;
            const dir = path.dirname(file.fullPath);
            const isRaw = RAW_EXTS.has(file.ext);

            // 如果是 RAW 文件，移动到子目录
            if (isRaw) {
                const rawDir = path.join(dir, RAW_DIR_NAME);
                const newFullPath = path.join(rawDir, newName);

                console.log(`   [${indexStr}] ${file.name} -> ${RAW_DIR_NAME}/${newName}`);

                if (process.platform === 'win32') {
                    renameCommands.push(`if not exist "${rawDir}" mkdir "${rawDir}"`);
                    renameCommands.push(`move "${file.fullPath}" "${newFullPath}"`);
                } else {
                    renameCommands.push(`mkdir -p "${rawDir}"`);
                    renameCommands.push(`mv "${file.fullPath}" "${newFullPath}"`);
                }
            } else {
                // 普通文件 (JPG等)
                if (file.name !== newName) {
                    console.log(`   [${indexStr}] ${file.name} -> ${newName}`);

                    if (process.platform === 'win32') {
                        renameCommands.push(`ren "${file.fullPath}" "${newName}"`);
                    } else {
                        const newFullPath = path.join(dir, newName);
                        renameCommands.push(`mv "${file.fullPath}" "${newFullPath}"`);
                    }
                }
            }
        });

        counter++;
    }

    // 写入脚本文件
    const scriptName = process.platform === 'win32' ? 'run_rename.bat' : 'run_rename.sh';
    const scriptPath = path.join(process.cwd(), scriptName);

    try {
        fs.writeFileSync(scriptPath, renameCommands.join('\n'), { mode: 0o755 });
        console.log(`\n✅ 处理完成！已生成重命名脚本: ${scriptName}`);
        console.log(`👉 请检查脚本内容，确认无误后运行: ./${scriptName}`);
    } catch (err) {
        console.error(`❌ 写入脚本失败: ${err.message}`);
    }
}

generateRenameScript();
