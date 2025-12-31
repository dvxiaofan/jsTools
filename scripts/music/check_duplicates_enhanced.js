/**
 * 脚本名称: Check Duplicates Enhanced (增强版音乐重复检测)
 * 功能描述: 扫描指定目录，检测完全重复和语义重复的音乐文件，关联歌词，生成清理脚本
 * 使用方法:
 *    node check_duplicates_enhanced.js [目标目录]
 * 示例:
 *    node check_duplicates_enhanced.js "/Volumes/CCSSD/Media/齐秦"
 *    cd /Volumes/CCSSD/Media/齐秦 && node /path/to/check_duplicates_enhanced.js
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ---------------------------------------------------------
// 1. 配置
// ---------------------------------------------------------

const AUDIO_EXTENSIONS = /\.(mp3|m4a|flac|wav|wma|ape)$/i;
const LRC_EXTENSION = /\.lrc$/i;

// 描述性后缀（括号内容），会被移除用于匹配
const DESCRIPTIVE_SUFFIXES = [
    'live', 'remix', 'mix', 'cover', 'demo', 'acoustic', 'instrumental',
    'dj', '伴奏', '演唱会', '现场', '版', '大合唱', '合唱', '独唱',
    '钢琴版', '吉他版', '纯音乐', 'karaoke', 'ktv', 'radio edit',
    'remaster', 'remastered', 'bonus', 'edit', 'extended', 'short',
    '蛰伏', '国语', '粤语', '日语', '英语', '翻唱'
];

// 合作歌手分隔符
const COLLABORATION_SEPARATORS = /[、&,\/×x]|\s+feat\.?\s+|\s+ft\.?\s+|\s+with\s+/i;

// 繁简体映射表（常用字）
const TRAD_TO_SIMP = {
    '齊': '齐', '學': '学', '華': '华', '國': '国', '愛': '爱',
    '戀': '恋', '夢': '梦', '風': '风', '雲': '云', '時': '时',
    '間': '间', '東': '东', '車': '车', '馬': '马', '鳥': '鸟',
    '魚': '鱼', '長': '长', '門': '门', '開': '开', '關': '关',
    '聽': '听', '說': '说', '話': '话', '語': '语', '紅': '红',
    '綠': '绿', '藍': '蓝', '黃': '黄', '頭': '头', '臉': '脸',
    '體': '体', '發': '发', '無': '无', '從': '从', '來': '来',
    '過': '过', '裡': '里', '頭': '头', '葉': '叶', '電': '电',
    '腦': '脑', '機': '机', '書': '书', '畫': '画', '詩': '诗',
    '歌': '歌', '聲': '声', '響': '响', '樂': '乐', '東': '东',
    '見': '见', '親': '亲', '對': '对', '這': '这', '裏': '里',
    '誰': '谁', '讓': '让', '還': '还', '後': '后', '隨': '随'
};

// 罗马数字映射
const ROMAN_TO_ARABIC = {
    'VIII': '8', 'VII': '7', 'III': '3', 'II': '2',
    'IV': '4', 'VI': '6', 'IX': '9', 'V': '5', 'X': '10', 'I': '1'
};

// ---------------------------------------------------------
// 2. 工具函数
// ---------------------------------------------------------

/**
 * 递归查找目录下的所有文件
 */
function findAllFiles(dir) {
    let results = [];
    try {
        if (!fs.existsSync(dir)) return [];
        const list = fs.readdirSync(dir);

        list.forEach(file => {
            if (file.startsWith('.')) return; // 忽略隐藏文件

            const fullPath = path.join(dir, file);
            try {
                const stat = fs.statSync(fullPath);
                if (stat.isDirectory()) {
                    results = results.concat(findAllFiles(fullPath));
                } else {
                    results.push(fullPath);
                }
            } catch (e) {}
        });
    } catch (e) {}
    return results;
}

/**
 * 计算文件 MD5
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

/**
 * 繁体转简体
 */
function toSimplified(str) {
    return str.split('').map(c => TRAD_TO_SIMP[c] || c).join('');
}

/**
 * 罗马数字转阿拉伯数字
 */
function normalizeRomanNumerals(str) {
    let result = str;
    // 从长到短匹配，避免 III 被拆成 I I I
    const romans = ['VIII', 'VII', 'III', 'IV', 'VI', 'IX', 'II', 'V', 'X', 'I'];
    romans.forEach(roman => {
        // 只匹配独立的罗马数字（前后非字母）
        const regex = new RegExp(`(?<![A-Za-z])${roman}(?![A-Za-z])`, 'gi');
        result = result.replace(regex, ROMAN_TO_ARABIC[roman]);
    });
    return result;
}

/**
 * 移除数字前缀
 * 例如: "01 - xxx", "01.xxx", "01-xxx", "1-01 xxx"
 */
function removeTrackNumber(name) {
    // 匹配开头的数字编号
    // "01 - " | "01. " | "01-" | "01." | "1-01 " | "1-01."
    return name
        .replace(/^[\d\-\.]+[\s\.\-]+/, '')  // "01 - xxx" -> "xxx"
        .replace(/^\d+\./, '');               // "01.xxx" -> "xxx"
}

/**
 * 移除描述性后缀（括号内容）
 * 例如: "(Live)", "（大合唱）"
 */
function removeDescriptiveSuffix(name) {
    // 匹配末尾的括号内容
    const suffixPattern = new RegExp(
        `\\s*[（(]\\s*(${DESCRIPTIVE_SUFFIXES.join('|')})[^)）]*[)）]$`,
        'i'
    );

    let result = name;
    // 可能有多个后缀，循环移除
    let prev;
    do {
        prev = result;
        result = result.replace(suffixPattern, '');
    } while (result !== prev);

    return result.trim();
}

/**
 * 从文件名提取歌手和歌名
 */
function parseSongInfo(fileName, defaultArtist) {
    // 去扩展名
    const ext = path.extname(fileName);
    let nameNoExt = path.basename(fileName, ext);

    // 去数字前缀
    nameNoExt = removeTrackNumber(nameNoExt);

    let artist = '';
    let title = '';

    // 尝试按 " - " 分割 (最标准的格式)
    if (nameNoExt.includes(' - ')) {
        const idx = nameNoExt.indexOf(' - ');
        const possibleArtist = nameNoExt.substring(0, idx).trim();
        const possibleTitle = nameNoExt.substring(idx + 3).trim();

        // 检查第一部分是否像歌手名（非纯数字）
        if (!/^\d+$/.test(possibleArtist) && possibleArtist.length > 0) {
            artist = possibleArtist;
            title = possibleTitle;
        } else {
            title = nameNoExt;
        }
    }
    // 尝试按 "-" 分割 (无空格)
    else if (nameNoExt.includes('-') && !nameNoExt.startsWith('-')) {
        const idx = nameNoExt.indexOf('-');
        const possibleArtist = nameNoExt.substring(0, idx).trim();
        const possibleTitle = nameNoExt.substring(idx + 1).trim();

        if (!/^\d+$/.test(possibleArtist) && possibleArtist.length > 0) {
            artist = possibleArtist;
            title = possibleTitle;
        } else {
            title = nameNoExt;
        }
    }
    else {
        title = nameNoExt;
    }

    // 去除歌名的描述性后缀
    title = removeDescriptiveSuffix(title);

    // 歌手 fallback
    if (!artist) {
        artist = defaultArtist || 'Unknown';
    }

    return { artist, title, original: fileName };
}

/**
 * 检查歌手是否匹配（处理合唱/feat情况）
 */
function artistMatches(fileArtist, dirArtist) {
    if (!fileArtist || !dirArtist) return false;

    const normFile = toSimplified(fileArtist.toLowerCase().replace(/\s+/g, ''));
    const normDir = toSimplified(dirArtist.toLowerCase().replace(/\s+/g, ''));

    // 完全匹配
    if (normFile === normDir) return true;

    // 拆分合作歌手
    const collaborators = fileArtist
        .split(COLLABORATION_SEPARATORS)
        .map(s => toSimplified(s.trim().toLowerCase().replace(/\s+/g, '')))
        .filter(s => s.length > 0);

    // 目录歌手在合作者中
    return collaborators.some(c => c === normDir || c.includes(normDir) || normDir.includes(c));
}

/**
 * 生成归一化的匹配 Key
 */
function getSongKey(artist, title, dirArtist) {
    // 确定最终歌手
    let finalArtist = artist;
    if (artistMatches(artist, dirArtist)) {
        finalArtist = dirArtist;
    }

    // 归一化处理
    let normArtist = toSimplified(finalArtist);
    normArtist = normArtist.toLowerCase().replace(/\s+/g, '');

    let normTitle = toSimplified(title);
    normTitle = normalizeRomanNumerals(normTitle);
    normTitle = normTitle.toLowerCase().replace(/\s+/g, '');

    return `${normArtist}|${normTitle}`;
}

/**
 * 评分函数：决定哪个文件更应该保留
 */
function getScore(fileInfo) {
    let score = 0;
    const name = fileInfo.name;

    // 优先 "Artist - Title" 格式
    if (name.includes(' - ')) score += 100;

    // 优先简体中文
    if (!/[齊學華國愛戀夢風雲時間東車馬鳥魚長門開關聽說話語紅綠藍黃頭臉體發無從來過]/.test(name)) {
        score += 20;
    }

    // 文件大小 (每 MB 加 1 分)
    if (fileInfo.size) {
        score += (fileInfo.size / 1024 / 1024);
    }

    // 优先无损格式
    if (/\.flac$/i.test(name)) score += 50;
    if (/\.ape$/i.test(name)) score += 40;
    if (/\.wav$/i.test(name)) score += 30;

    return score;
}

/**
 * 查找同目录下的同名歌词文件
 */
function findAssociatedLrc(audioPath, lrcIndex) {
    const dir = path.dirname(audioPath);
    const baseName = path.basename(audioPath, path.extname(audioPath));
    const lrcPath = path.join(dir, baseName + '.lrc');

    // 检查索引中是否存在
    if (lrcIndex.has(lrcPath)) {
        return lrcPath;
    }
    return null;
}

/**
 * 生成安全的目录名
 */
function safeDirName(name) {
    return name.replace(/[\/\\:*?"<>|]/g, '_').substring(0, 50);
}

// ---------------------------------------------------------
// 3. 主逻辑
// ---------------------------------------------------------

function run() {
    // 解析目标目录
    const targetDir = process.argv[2] || process.cwd();
    const dirArtist = path.basename(targetDir);

    console.log(`\n🚀 增强版音乐重复检测`);
    console.log(`📂 扫描目录: ${targetDir}`);
    console.log(`🎤 默认歌手: ${dirArtist}`);
    console.log('─'.repeat(50));

    if (!fs.existsSync(targetDir)) {
        console.error('❌ 目标目录不存在');
        process.exit(1);
    }

    // 扫描所有文件
    console.log('\n⏳ 正在扫描文件...');
    const allFiles = findAllFiles(targetDir);

    // 分类：音频 vs 歌词
    const audioFiles = [];
    const lrcIndex = new Map(); // path -> true

    allFiles.forEach(f => {
        const name = path.basename(f);
        if (AUDIO_EXTENSIONS.test(name)) {
            audioFiles.push(f);
        } else if (LRC_EXTENSION.test(name)) {
            lrcIndex.set(f, true);
        }
    });

    console.log(`   音频文件: ${audioFiles.length} 个`);
    console.log(`   歌词文件: ${lrcIndex.size} 个`);

    if (audioFiles.length === 0) {
        console.log('\n✨ 未找到音频文件');
        return;
    }

    // 预处理文件信息
    const fileInfos = audioFiles.map(f => {
        const stat = fs.statSync(f);
        const songInfo = parseSongInfo(path.basename(f), dirArtist);
        const lrcPath = findAssociatedLrc(f, lrcIndex);

        return {
            path: f,
            name: path.basename(f),
            size: stat.size,
            artist: songInfo.artist,
            title: songInfo.title,
            key: getSongKey(songInfo.artist, songInfo.title, dirArtist),
            lrcPath: lrcPath
        };
    });

    // ---------------------------------------------------------
    // A. 完全重复检测 (Size + MD5)
    // ---------------------------------------------------------
    console.log('\n🔒 [1/2] 检测完全重复文件 (MD5)...');

    const sizeMap = new Map();
    fileInfos.forEach(f => {
        if (!sizeMap.has(f.size)) sizeMap.set(f.size, []);
        sizeMap.get(f.size).push(f);
    });

    const exactDuplicates = [];
    let checkedCount = 0;
    const sizeGroups = [...sizeMap.entries()].filter(([size, group]) => group.length > 1 && size > 0);

    for (const [size, group] of sizeGroups) {
        checkedCount++;
        process.stdout.write(`\r   进度: ${checkedCount}/${sizeGroups.length} 组...`);

        const hashMap = new Map();
        group.forEach(f => {
            const hash = getFileHash(f.path);
            if (hash) {
                if (!hashMap.has(hash)) hashMap.set(hash, []);
                hashMap.get(hash).push(f);
            }
        });

        for (const [hash, sameFiles] of hashMap) {
            if (sameFiles.length > 1) {
                exactDuplicates.push({ hash, size, files: sameFiles });
            }
        }
    }
    console.log(`\r   完成！发现 ${exactDuplicates.length} 组完全重复`);

    // 记录已在完全重复中的文件路径（避免语义重复重复报告）
    const exactDupPaths = new Set();
    exactDuplicates.forEach(d => {
        d.files.forEach(f => exactDupPaths.add(f.path));
    });

    // ---------------------------------------------------------
    // B. 语义重复检测 (歌手 + 歌名)
    // ---------------------------------------------------------
    console.log('\n🎵 [2/2] 检测语义重复文件 (同名歌曲)...');

    const songMap = new Map();
    fileInfos.forEach(f => {
        // 跳过已在完全重复中的文件? 不，语义重复也要报告
        if (f.title && f.key) {
            if (!songMap.has(f.key)) songMap.set(f.key, []);
            songMap.get(f.key).push(f);
        }
    });

    const semanticDuplicates = [];
    for (const [key, group] of songMap) {
        if (group.length > 1) {
            // 检查是否全部都在同一个完全重复组中
            const allInExact = group.every(f => exactDupPaths.has(f.path));
            const uniqueHashes = new Set();
            if (allInExact) {
                // 计算这组内有多少不同的文件（通过路径）
                // 如果都是完全相同的文件，跳过
                group.forEach(f => {
                    const ed = exactDuplicates.find(e => e.files.some(ef => ef.path === f.path));
                    if (ed) uniqueHashes.add(ed.hash);
                });
                if (uniqueHashes.size <= 1) {
                    // 全是同一组完全重复，跳过语义重复报告
                    continue;
                }
            }

            semanticDuplicates.push({ key, files: group });
        }
    }
    console.log(`   完成！发现 ${semanticDuplicates.length} 组语义重复`);

    // ---------------------------------------------------------
    // C. 输出报告
    // ---------------------------------------------------------
    console.log('\n' + '═'.repeat(50));
    console.log('📊 检测报告');
    console.log('═'.repeat(50));

    // 完全重复
    if (exactDuplicates.length > 0) {
        console.log(`\n🔒 完全重复 (${exactDuplicates.length} 组)`);
        exactDuplicates.forEach((d, idx) => {
            d.files.sort((a, b) => getScore(b) - getScore(a));
            console.log(`\n   [组 ${idx + 1}] MD5: ${d.hash.substring(0, 8)}... | ${(d.size/1024/1024).toFixed(2)}MB`);
            d.files.forEach((f, i) => {
                const prefix = i === 0 ? '✅ 保留' : '❌ 移除';
                const relPath = path.relative(targetDir, f.path);
                console.log(`      ${prefix}: ${relPath}`);
                if (f.lrcPath) {
                    console.log(`         📝 歌词: ${path.basename(f.lrcPath)}`);
                }
            });
        });
    }

    // 语义重复
    if (semanticDuplicates.length > 0) {
        console.log(`\n🎵 语义重复 (${semanticDuplicates.length} 组)`);
        semanticDuplicates.forEach((d, idx) => {
            d.files.sort((a, b) => getScore(b) - getScore(a));
            const [artist, title] = d.key.split('|');
            console.log(`\n   [组 ${idx + 1}] ${artist} - ${title} (${d.files.length} 首)`);
            d.files.forEach((f, i) => {
                const prefix = i === 0 ? '⭐ 推荐' : '   备选';
                const relPath = path.relative(targetDir, f.path);
                const sizeMB = (f.size / 1024 / 1024).toFixed(2);
                console.log(`      ${prefix}: ${relPath} (${sizeMB}MB)`);
                if (f.lrcPath) {
                    console.log(`         📝 歌词: ${path.basename(f.lrcPath)}`);
                }
            });
        });
    }

    if (exactDuplicates.length === 0 && semanticDuplicates.length === 0) {
        console.log('\n✨ 完美！未发现任何重复文件。');
        return;
    }

    // ---------------------------------------------------------
    // D. 生成清理脚本
    // ---------------------------------------------------------
    console.log('\n' + '═'.repeat(50));
    console.log('📝 生成清理脚本');
    console.log('═'.repeat(50));

    const scriptPath = path.join(targetDir, '_cleanup_duplicates.sh');
    const tempDir = '_duplicates_temp';
    const lines = [];

    lines.push('#!/bin/bash');
    lines.push('# 重复文件清理脚本 (自动生成)');
    lines.push(`# 生成时间: ${new Date().toLocaleString()}`);
    lines.push(`# 扫描目录: ${targetDir}`);
    lines.push('#');
    lines.push('# ⚠️  此脚本将文件移动到 _duplicates_temp 目录，不会删除');
    lines.push('# 请检查后手动删除临时目录');
    lines.push('');
    lines.push('set -e');
    lines.push('');

    // 切换到目标目录
    lines.push(`cd "${targetDir}"`);
    lines.push('');

    // 完全重复
    if (exactDuplicates.length > 0) {
        lines.push('# ═══════════════════════════════════════');
        lines.push('# 完全重复 (内容完全相同)');
        lines.push('# ═══════════════════════════════════════');
        lines.push('');

        exactDuplicates.forEach((d, idx) => {
            d.files.sort((a, b) => getScore(b) - getScore(a));
            const groupDir = `${tempDir}/exact/group_${String(idx + 1).padStart(3, '0')}`;

            lines.push(`# [组 ${idx + 1}] ${d.files[0].title || 'Unknown'}`);
            lines.push(`mkdir -p "./${groupDir}"`);

            // 跳过第一个（保留），移动其余的
            d.files.slice(1).forEach(f => {
                const relPath = path.relative(targetDir, f.path);
                lines.push(`mv "./${relPath}" "./${groupDir}/" 2>/dev/null || true`);
                if (f.lrcPath) {
                    const lrcRelPath = path.relative(targetDir, f.lrcPath);
                    lines.push(`mv "./${lrcRelPath}" "./${groupDir}/" 2>/dev/null || true`);
                }
            });
            lines.push('');
        });
    }

    // 语义重复
    if (semanticDuplicates.length > 0) {
        lines.push('# ═══════════════════════════════════════');
        lines.push('# 语义重复 (同名歌曲不同版本)');
        lines.push('# ═══════════════════════════════════════');
        lines.push('');

        semanticDuplicates.forEach((d, idx) => {
            d.files.sort((a, b) => getScore(b) - getScore(a));
            const [artist, title] = d.key.split('|');
            const safeTitle = safeDirName(title);
            const groupDir = `${tempDir}/semantic/group_${String(idx + 1).padStart(3, '0')}_${safeTitle}`;

            lines.push(`# [组 ${idx + 1}] ${artist} - ${title}`);
            lines.push(`mkdir -p "./${groupDir}"`);

            // 跳过第一个（推荐保留），移动其余的
            d.files.slice(1).forEach(f => {
                const relPath = path.relative(targetDir, f.path);
                lines.push(`mv "./${relPath}" "./${groupDir}/" 2>/dev/null || true`);
                if (f.lrcPath) {
                    const lrcRelPath = path.relative(targetDir, f.lrcPath);
                    lines.push(`mv "./${lrcRelPath}" "./${groupDir}/" 2>/dev/null || true`);
                }
            });
            lines.push('');
        });
    }

    lines.push('echo ""');
    lines.push('echo "✅ 清理完成！"');
    lines.push(`echo "📁 重复文件已移动到: ${tempDir}"`);
    lines.push('echo "请检查后手动删除临时目录"');

    fs.writeFileSync(scriptPath, lines.join('\n'), { mode: 0o755 });
    console.log(`\n✅ 清理脚本已生成: ${scriptPath}`);
    console.log('\n执行清理:');
    console.log(`   cd "${targetDir}"`);
    console.log('   bash _cleanup_duplicates.sh');

    // 统计
    let totalToMove = 0;
    exactDuplicates.forEach(d => totalToMove += d.files.length - 1);
    semanticDuplicates.forEach(d => totalToMove += d.files.length - 1);

    console.log(`\n📊 统计:`);
    console.log(`   完全重复组: ${exactDuplicates.length}`);
    console.log(`   语义重复组: ${semanticDuplicates.length}`);
    console.log(`   待移动文件: ${totalToMove} 个`);
}

// ---------------------------------------------------------
// 执行
// ---------------------------------------------------------
run();
