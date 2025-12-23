const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ---------------------------------------------------------
// 1. 文件查找工具
// ---------------------------------------------------------

/**
 * 递归查找目录下的所有文件
 * @param {string} dir 目录路径
 * @param {Object} options 选项 { audioOnly: boolean }
 * @returns {string[]} 文件路径数组
 */
function findFiles(dir, options = {}) {
    let results = [];
    let list = [];
    try {
        if (!fs.existsSync(dir)) return [];
        list = fs.readdirSync(dir);
    } catch (e) {
        // console.error(`无法读取目录: ${dir}`, e.message);
        return [];
    }

    list.forEach(file => {
        if (file.startsWith('.')) return; // 忽略 .DS_Store 等

        // 过滤非音频文件
        if (options.audioOnly) {
             if (!/\.(mp3|m4a|flac|wav|wma|ape)$/i.test(file)) {
                // 如果是目录，仍然递归，但如果是文件则跳过
                const fullPath = path.join(dir, file);
                try {
                    if (fs.statSync(fullPath).isDirectory()) {
                        results = results.concat(findFiles(fullPath, options));
                    }
                } catch(e) {}
                return;
             }
        }

        const fullPath = path.join(dir, file);
        try {
            const stat = fs.statSync(fullPath);
            if (stat.isDirectory()) {
                results = results.concat(findFiles(fullPath, options));
            } else {
                results.push(fullPath);
            }
        } catch (e) {}
    });
    return results;
}

// ---------------------------------------------------------
// 2. 哈希计算工具
// ---------------------------------------------------------

/**
 * 计算文件 MD5
 * @param {string} filePath 文件路径
 * @returns {string|null} MD5 哈希值
 */
function getFileHash(filePath) {
    const BUFFER_SIZE = 8192;
    try {
        const fd = fs.openSync(filePath, 'r');
        const hash = crypto.createHash('md5');
        const buffer = Buffer.alloc(BUFFER_SIZE);
        let bytesRead;
        try {
            while ((bytesRead = fs.readSync(fd, buffer, 0, BUFFER_SIZE, null)) !== 0) {
                hash.update(buffer.slice(0, bytesRead));
            }
        } finally {
            fs.closeSync(fd);
        }
        return hash.digest('hex');
    } catch (e) {
        return null;
    }
}

// ---------------------------------------------------------
// 3. 歌曲信息解析工具
// ---------------------------------------------------------

/**
 * 解析文件名获取 (歌手, 歌名)
 * @param {string} fileName 文件名
 * @param {string} [defaultArtist] 默认歌手名（用于 fallback）
 * @returns {Object} { artist, title, original }
 */
function parseSongInfo(fileName, defaultArtist) {
    const ext = path.extname(fileName);
    let nameNoExt = path.basename(fileName, ext);

    // 0. 预处理：去除开头的数字编号 (如 "01. ", "01 ", "1-01 ")
    // 匹配规则: 开头数字 + 可选的点/横杠 + 必须有空格
    // 或者纯数字开头 + 点 (如 "25.秋天不回来")
    // 或者纯数字开头 + 空格 (如 "25 秋天不回来")
    nameNoExt = nameNoExt.replace(/^(\d+[\.\-]?\s+)/, ''); // "01. Title" -> "Title"
    nameNoExt = nameNoExt.replace(/^\d+\./, ''); // "01.Title" -> "Title"

    let artist = '';
    let title = '';

    // 模式 1: "歌手 - 歌名" (最标准)
    if (nameNoExt.includes(' - ')) {
        const parts = nameNoExt.split(' - ');
        if (parts.length >= 2) {
            artist = parts[0].trim();
            title = parts[1].trim();
        }
    }
    // 模式 2: "歌手-歌名" (无空格，风险较高，但常见)
    else if (nameNoExt.includes('-')) {
        const parts = nameNoExt.split('-');
        if (parts.length >= 2) {
            // 简单判断：如果前面部分像数字，可能还是 track number (如 "1-01")
            // 但前面已经去除了数字前缀，所以这里大概率是歌手
            artist = parts[0].trim();
            title = parts[1].trim();
        }
    }
    // 模式 3: "歌名(歌手)" 或 "歌名（歌手）"
    else if (/[（(]/.test(nameNoExt) && /[)）]/.test(nameNoExt)) {
        // 提取括号内的内容作为歌手
        // 此时 nameNoExt 已经去除了前面的数字，所以直接匹配
        const match = nameNoExt.match(/^(.+?)[（(](.+?)[)）]$/);
        if (match) {
            title = match[1].trim();
            artist = match[2].trim();
        }
    }

    // 最后的 fallback
    if (!title) title = nameNoExt;

    // 后处理：去除 Title 中的常见后缀 (Live, Remix等)
    // 只有当 Title 看起来很长且包含括号时才处理，避免误伤 "Love (Is All)"
    // 简单策略：如果 Title 结尾有括号，尝试去除
    const suffixRegex = /[（(](Live|Mix|Remix|Cover|DJ|伴奏|演唱会|版)[)）]$/i;
    if (suffixRegex.test(title)) {
        title = title.replace(suffixRegex, '').trim();
    }

    // 如果没有解析出歌手，或者歌手名为 "Unknown"，尝试使用默认歌手
    if (!artist || artist.toLowerCase() === 'unknown') {
        if (defaultArtist) {
            artist = defaultArtist;
        } else {
            artist = 'Unknown';
        }
    }

    return {
        artist: artist,
        title: title,
        original: fileName
    };
}

// ---------------------------------------------------------
// 4. 评分工具
// ---------------------------------------------------------

/**
 * 评分函数：决定哪个文件更应该保留
 * @param {Object} fileInfo { path, size, name }
 * @returns {number} 分数
 */
function getScore(fileInfo) {
    let score = 0;
    const name = path.basename(fileInfo.path);

    // 1. 优先 "Artist - Title" 格式 (含有 " - ")
    if (name.includes(' - ')) score += 100;

    // 2. 优先简体中文 (简单的启发式: 避免特定的繁体字)
    if (name.includes('爱') && !name.includes('愛')) score += 10;
    if (name.includes('亲') && !name.includes('親')) score += 10;

    // 3. 文件大小 (每 MB 加 1 分)
    if (fileInfo.size) {
        score += (fileInfo.size / 1024 / 1024);
    }

    return score;
}

module.exports = {
    findFiles,
    getFileHash,
    parseSongInfo,
    getScore
};
