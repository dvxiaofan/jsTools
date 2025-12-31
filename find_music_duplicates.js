/**
 * 脚本名称: Find Music Duplicates (单目录重复检测)
 * 功能描述: 扫描指定目录，检测完全重复（MD5）和疑似重复（同名不同文件）的音乐文件。
 * 使用方法:
 *    node find_music_duplicates.js [目标目录]
 * 示例:
 *    node find_music_duplicates.js "/Volumes/Music/其他合集"
 *    (如果不传参数，默认扫描 /Volumes/Music/歌手分类)
 */

const fs = require('fs');
const path = require('path');
const { findFiles, getFileHash, parseSongInfo, getScore } = require('./check_duplicates_utils');

// 默认扫描目录，可以通过命令行参数覆盖
const targetDir = process.argv[2] || '/Volumes/Music/歌手分类';

// ---------------------------------------------------------
// 2. 主逻辑
// ---------------------------------------------------------

function run() {
    console.log(`🚀 开始扫描: ${targetDir}`);

    if (!fs.existsSync(targetDir)) {
        console.error('❌ 目标目录不存在');
        return;
    }

    const allFiles = findFiles(targetDir);
    console.log(`📁 找到 ${allFiles.length} 个文件`);

    // 预处理文件信息
    const fileInfos = allFiles.map(f => {
        return {
            path: f,
            size: fs.statSync(f).size,
            name: path.basename(f)
        };
    });

    // ---------------------------------------------------------
    // A. 完全重复检测 (Size + MD5)
    // ---------------------------------------------------------
    console.log('\n🔒 [1/2] 正在检测完全重复文件 (内容一致)...');

    const sizeMap = new Map();
    fileInfos.forEach(f => {
        if (!sizeMap.has(f.size)) sizeMap.set(f.size, []);
        sizeMap.get(f.size).push(f);
    });

    const exactDuplicates = [];

    // Helper to detect audio vs metadata
    const audioRegex = /\.(mp3|m4a|flac|wav|wma|ape)$/i;
    const metaRegex = /\.(lrc|jpg|jpeg|png|gif|bmp)$/i;

    for (const [size, group] of sizeMap) {
        if (group.length < 2) continue;
        if (size === 0) continue;

        // 1) 对音频文件做全局 MD5 检测（原有行为）
        const audioFiles = group.filter(f => audioRegex.test(f.name));
        if (audioFiles.length > 1) {
            const hashMap = new Map();
            audioFiles.forEach(f => {
                const hash = getFileHash(f.path);
                if (hash) {
                    if (!hashMap.has(hash)) hashMap.set(hash, []);
                    hashMap.get(hash).push(f);
                }
            });
            for (const [hash, sameFiles] of hashMap) {
                if (sameFiles.length > 1) {
                    exactDuplicates.push({ size: size, hash: hash, files: sameFiles });
                }
            }
        }

        // 2) 对元数据文件（歌词、封面等）仅在同一父目录中检测重复
        const metaFiles = group.filter(f => metaRegex.test(f.name));
        if (metaFiles.length > 1) {
            const dirMap = new Map();
            metaFiles.forEach(f => {
                const dir = path.dirname(f.path);
                if (!dirMap.has(dir)) dirMap.set(dir, []);
                dirMap.get(dir).push(f);
            });

            for (const [dir, filesInDir] of dirMap) {
                if (filesInDir.length < 2) continue;
                const hashMap = new Map();
                filesInDir.forEach(f => {
                    const hash = getFileHash(f.path);
                    if (hash) {
                        if (!hashMap.has(hash)) hashMap.set(hash, []);
                        hashMap.get(hash).push(f);
                    }
                });
                for (const [hash, sameFiles] of hashMap) {
                    if (sameFiles.length > 1) {
                        exactDuplicates.push({ size: size, hash: hash, files: sameFiles });
                    }
                }
            }
        }
    }

    if (exactDuplicates.length > 0) {
        console.log(`⚠️ 发现 ${exactDuplicates.length} 组 完全重复文件:`);
        exactDuplicates.forEach((d, idx) => {
            console.log(`\n   [组 ${idx + 1}] 大小: ${(d.size/1024/1024).toFixed(2)}MB`);

            // 排序建议保留的文件
            d.files.sort((a, b) => getScore(b) - getScore(a));

            d.files.forEach((f, i) => {
                const prefix = i === 0 ? '✅ 保留' : '❌ 删除';
                console.log(`      ${prefix}: ${path.relative(targetDir, f.path)}`);
            });
        });
    } else {
        console.log('✨ 未发现完全重复的文件。');
    }

    // ---------------------------------------------------------
    // B. 语义重复检测 (同名不同文件)
    // ---------------------------------------------------------
    console.log('\n🎵 [2/2] 正在检测疑似重复歌曲 (同名不同文件)...');

    const songMap = new Map();

    fileInfos.forEach(f => {
        // 忽略非音频
        if (!/\.(mp3|m4a|flac|wav|wma|ape)$/i.test(f.name)) return;

        // 如果已经在完全重复里了，这里是否还要报？
        // 通常如果完全重复，已经被上面的逻辑捕获。
        // 这里我们主要关心内容不同（MD5不同）但歌名相同的。
        // 为了简单，我们先把所有文件都放进去，最后再过滤掉完全重复的组（如果需要）。

        const info = parseSongInfo(f.name);
        if (info.title && info.title !== 'Unknown') {
            const cleanArtist = info.artist.toLowerCase().replace(/\s+/g, '');
            const cleanTitle = info.title.toLowerCase().replace(/\s+/g, '');

            let key = '';
            if (cleanArtist && cleanArtist !== 'unknown') {
                key = `${cleanArtist}|${cleanTitle}`;
            } else if (cleanTitle.length > 4) {
                // 只有长歌名才允许无歌手匹配，避免误判
                key = `unknown|${cleanTitle}`;
            } else {
                return;
            }

            if (!songMap.has(key)) songMap.set(key, []);
            songMap.get(key).push(f);
        }
    });

    let semanticDuplicateCount = 0;

    for (const [key, group] of songMap) {
        if (group.length > 1) {
            // 检查这一组是否所有文件的 MD5 都一样？如果都一样，其实就是上面的"完全重复"，这里就没必要再报了
            // 或者我们可以简单点，只要路径不同就报

            // 过滤掉已经在 exactDuplicates 中完全被包含的组（即组内所有文件两两互为完全重复）
            // 简单处理：只要这组里的文件大小不全一样，或者大小一样但MD5不一样，就有价值报告
            const uniqueSizes = new Set(group.map(f => f.size));
            if (uniqueSizes.size === 1) {
                // 大小都一样，检查是否已在 exactDuplicates 出现过
                // 这里简化处理：直接列出，用户自己判断
            }

            const [artist, title] = key.split('|');

            // 排序
            group.sort((a, b) => getScore(b) - getScore(a));

            console.log(`\n   🎤 ${artist === 'unknown' ? '未知歌手' : artist} - ${title} (${group.length} 首)`);
            group.forEach((f, i) => {
                const isBest = i === 0;
                const sizeMB = (f.size / 1024 / 1024).toFixed(2);
                console.log(`      ${isBest ? '⭐ 推荐' : '  备选'}: ${path.relative(targetDir, f.path)} (${sizeMB} MB)`);
            });
            semanticDuplicateCount++;
        }
    }

    if (semanticDuplicateCount === 0) {
        console.log('✨ 未发现疑似重复的歌曲。');
    } else {
        console.log(`\n⚠️ 共发现 ${semanticDuplicateCount} 组疑似重复歌曲。`);
    }
}

run();
