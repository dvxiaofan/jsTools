/**
 * 脚本名称: Fix Dates (照片日期修复)
 * 功能描述: 扫描指定目录，从文件名提取日期，写入 EXIF 并修正文件系统时间
 * 使用方法:
 *    node fix_dates.js [目标目录]
 * 示例:
 *    node fix_dates.js "/path/to/photos"
 *
 * 解决痛点:
 *   照片管理软件优先读取 EXIF 日期，如果丢失或错误，照片会显示为"今天"。
 *   此脚本从文件名提取日期 (YYYYMMDD格式) 并写入 EXIF。
 *
 * 支持格式: JPG/JPEG (piexifjs 限制)
 * 依赖: piexifjs (npm install piexifjs)
 */

const fs = require('fs');
const path = require('path');
const piexif = require('piexifjs');

// ---------------------------------------------------------
// 1. 配置
// ---------------------------------------------------------

// 日期匹配正则 (YYYYMMDD 格式)
// 例如: _SC_0181_20160612_001.jpg -> 匹配 20160612
const DATE_REGEX = /(20\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])/;

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
        // 跳过临时目录
        if (file.startsWith('_')) return;

        const fullPath = path.join(dir, file);
        try {
            const stat = fs.statSync(fullPath);
            if (stat.isDirectory()) {
                scanDirectory(fullPath, results, visited);
            } else if (stat.isFile()) {
                const ext = path.extname(file).toLowerCase();
                // 只支持 JPG 的 EXIF 写入 (piexifjs 限制)
                if (ext === '.jpg' || ext === '.jpeg') {
                    results.push({
                        name: file,
                        fullPath: fullPath
                    });
                }
            }
        } catch (e) {}
    });

    return results;
}

/**
 * 处理单个文件
 */
function processFile(file, targetDir) {
    // 从文件名提取日期
    const match = file.name.match(DATE_REGEX);
    if (!match) {
        return { status: 'skipped', reason: '无日期信息' };
    }

    const year = match[1];
    const month = match[2];
    const day = match[3];
    const dateStr = `${year}:${month}:${day} 12:00:00`; // 默认中午 12点

    // 构造 Date 对象用于修改文件系统时间
    const dateObj = new Date(Number(year), Number(month) - 1, Number(day), 12, 0, 0);

    try {
        // 读取并修改 EXIF
        const jpeg = fs.readFileSync(file.fullPath);
        const data = jpeg.toString("binary");

        let exifObj;
        try {
            exifObj = piexif.load(data);
        } catch (e) {
            // 如果读取失败，创建一个空的 EXIF 对象
            exifObj = { "0th": {}, "Exif": {}, "GPS": {}, "Interop": {}, "1st": {}, "thumbnail": null };
        }

        // 写入日期到多个 EXIF 字段
        exifObj["0th"][piexif.ImageIFD.DateTime] = dateStr;
        exifObj["Exif"][piexif.ExifIFD.DateTimeOriginal] = dateStr;
        exifObj["Exif"][piexif.ExifIFD.DateTimeDigitized] = dateStr;

        const exifBytes = piexif.dump(exifObj);
        const newData = piexif.insert(exifBytes, data);
        const newJpeg = Buffer.from(newData, "binary");

        fs.writeFileSync(file.fullPath, newJpeg);

        // 修改文件系统时间
        fs.utimesSync(file.fullPath, dateObj, dateObj);

        return {
            status: 'success',
            date: `${year}-${month}-${day}`,
            relPath: path.relative(targetDir, file.fullPath)
        };

    } catch (err) {
        return { status: 'error', reason: err.message };
    }
}

// ---------------------------------------------------------
// 3. 主逻辑
// ---------------------------------------------------------

function run() {
    const targetDir = process.argv[2] || process.cwd();
    const absoluteTargetDir = path.resolve(targetDir);

    console.log(`\n🛠️  照片日期修复工具`);
    console.log(`📂 扫描目录: ${absoluteTargetDir}`);
    console.log('─'.repeat(50));

    if (!fs.existsSync(absoluteTargetDir)) {
        console.error('❌ 目标目录不存在');
        process.exit(1);
    }

    // 扫描文件
    console.log('\n⏳ 正在扫描 JPG 文件...');
    const fileList = scanDirectory(absoluteTargetDir);

    console.log(`   找到 ${fileList.length} 个 JPG 文件`);

    if (fileList.length === 0) {
        console.log('\n✨ 未找到 JPG 文件');
        return;
    }

    // 处理文件
    console.log('\n🔧 正在修复 EXIF 日期...');

    const results = {
        success: [],
        skipped: [],
        error: []
    };

    fileList.forEach(file => {
        const result = processFile(file, absoluteTargetDir);

        if (result.status === 'success') {
            results.success.push(result);
            console.log(`   ✅ ${result.relPath} -> ${result.date}`);
        } else if (result.status === 'skipped') {
            results.skipped.push({ ...result, name: file.name });
        } else {
            results.error.push({ ...result, name: file.name });
            console.log(`   ❌ ${file.name}: ${result.reason}`);
        }
    });

    // ---------------------------------------------------------
    // 输出报告
    // ---------------------------------------------------------
    console.log('\n' + '═'.repeat(50));
    console.log('📊 修复报告');
    console.log('═'.repeat(50));

    if (results.success.length > 0) {
        console.log(`\n✅ 成功修复: ${results.success.length} 张`);
    }

    if (results.skipped.length > 0) {
        console.log(`\n⏭️  跳过 (无日期信息): ${results.skipped.length} 张`);
        if (results.skipped.length <= 10) {
            results.skipped.forEach(r => {
                console.log(`   ${r.name}`);
            });
        }
    }

    if (results.error.length > 0) {
        console.log(`\n❌ 失败: ${results.error.length} 张`);
        results.error.forEach(r => {
            console.log(`   ${r.name}: ${r.reason}`);
        });
    }

    // 统计
    console.log('\n' + '─'.repeat(50));
    console.log(`📊 统计:`);
    console.log(`   扫描文件: ${fileList.length} 个`);
    console.log(`   成功修复: ${results.success.length} 个`);
    console.log(`   跳过文件: ${results.skipped.length} 个`);
    console.log(`   失败文件: ${results.error.length} 个`);

    if (results.success.length > 0) {
        console.log(`\n💡 提示: EXIF 日期和文件修改时间已同步更新`);
    }

    console.log(`\n⚠️  注意: 仅支持 JPG/JPEG 格式，RAW 文件需使用 exiftool 处理`);
}

// ---------------------------------------------------------
// 执行
// ---------------------------------------------------------
run();
