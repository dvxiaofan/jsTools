/**
 * 🛠️ 修复照片拍摄日期 (Photo Date Fixer)
 * 
 * 作用:
 * 扫描指定目录下的 JPG 照片，尝试从文件名中提取日期 (例如 20160313)，
 * 并将该日期写入到照片的 Exif 信息中，同时修改文件的系统修改时间。
 * 
 * 解决痛点:
 * 很多照片管理软件优先读取文件修改时间或 Exif 日期，如果两者都丢失或错误，
 * 照片就会显示为“今天”。此脚本可以根据文件名“纠正”时间。
 * 
 * 使用方法:
 * node fix_dates.js "/path/to/photos"
 */

const fs = require('fs');
const path = require('path');
const piexif = require('piexifjs');

// 获取目标目录参数
const args = process.argv.slice(2);
const targetDir = args[0] || '.';
const absoluteTargetDir = path.resolve(targetDir);

// 日期匹配正则 (支持 YYYYMMDD 格式)
// 例如: _SC_0181_20160612_001.jpg -> 匹配 20160612
const DATE_REGEX = /(20\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])/;

let processedCount = 0;
let errorCount = 0;

console.log(`\n🛠️  开始修复照片日期: ${absoluteTargetDir}`);

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
            // 目前只支持 JPG 的 Exif 写入 (piexifjs 限制)
            if (ext === '.jpg' || ext === '.jpeg') {
                processFile(file, fullPath);
            }
        }
    });
}

function processFile(filename, fullPath) {
    // 1. 从文件名提取日期
    const match = filename.match(DATE_REGEX);
    if (!match) {
        // console.log(`   [跳过] 无日期信息: ${filename}`);
        return;
    }

    const year = match[1];
    const month = match[2];
    const day = match[3];
    const dateStr = `${year}:${month}:${day} 12:00:00`; // 默认中午 12点
    
    // 构造 Date 对象用于修改文件系统时间
    const dateObj = new Date(Number(year), Number(month) - 1, Number(day), 12, 0, 0);

    try {
        // 2. 读取并修改 Exif
        const jpeg = fs.readFileSync(fullPath);
        const data = jpeg.toString("binary");
        
        let exifObj;
        try {
            exifObj = piexif.load(data);
        } catch (e) {
            // 如果读取失败，创建一个空的 Exif 对象
            exifObj = { "0th": {}, "Exif": {}, "GPS": {}, "Interop": {}, "1st": {}, "thumbnail": null };
        }

        // 检查是否已有 Exif 日期 (DateTimeOriginal)
        const existingDate = exifObj["Exif"][piexif.ExifIFD.DateTimeOriginal];
        
        // 如果没有日期，或者日期看起来不对(比如是空的)，就覆盖它
        // 这里我们强制覆盖，因为用户明确表示文件名里的日期才是对的
        
        exifObj["0th"][piexif.ImageIFD.DateTime] = dateStr;
        exifObj["Exif"][piexif.ExifIFD.DateTimeOriginal] = dateStr;
        exifObj["Exif"][piexif.ExifIFD.DateTimeDigitized] = dateStr;

        const exifBytes = piexif.dump(exifObj);
        const newData = piexif.insert(exifBytes, data);
        const newJpeg = Buffer.from(newData, "binary");

        fs.writeFileSync(fullPath, newJpeg);
        
        // 3. 修改文件系统时间 (utimes)
        // atime (访问时间) 和 mtime (修改时间)
        fs.utimesSync(fullPath, dateObj, dateObj);

        console.log(`✅ 已修复: ${filename} -> 设定为 ${year}-${month}-${day}`);
        processedCount++;

    } catch (err) {
        console.error(`❌ 处理失败 ${filename}: ${err.message}`);
        errorCount++;
    }
}

scanDirectory(absoluteTargetDir);

console.log(`\n--------------------------------------------------`);
console.log(`🎉 处理完成！`);
console.log(`   成功修复: ${processedCount} 张`);
if (errorCount > 0) {
    console.log(`   失败数量: ${errorCount} 张`);
}
console.log(`⚠️  注意: 仅支持 JPG/JPEG 格式。RAW 文件需要使用 exiftool 处理。`);
