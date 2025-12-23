/**
 * 脚本名称: Scan Artists Duplicates (批量歌手目录重复检测)
 * 功能描述: 批量扫描指定目录下的所有子文件夹（假设为歌手名），生成详细的重复歌曲报告。
 *          会自动跳过非音频文件。
 * 使用方法:
 *    node scan_artists_duplicates.js [根目录] [报告输出路径]
 * 示例:
 *    node scan_artists_duplicates.js "/Volumes/Music/歌手分类" "./my_report.txt"
 */

const fs = require('fs');
const path = require('path');
const { findFiles, getFileHash, parseSongInfo, getScore } = require('./check_duplicates_utils');

const rootDir = process.argv[2] || '/Volumes/Music/歌手分类';
const reportFile = process.argv[3] || 'all_artists_duplicates_report_v2.txt';

// Artists to skip
const skipArtists = ['张韶涵', '周杰伦'];

// ---------------------------------------------------------
// Main Logic
// ---------------------------------------------------------

async function run() {
    console.log(`🚀 开始批量扫描: ${rootDir}`);

    if (!fs.existsSync(rootDir)) {
        console.error('❌ 根目录不存在');
        return;
    }

    // Get all artist folders
    const items = fs.readdirSync(rootDir, { withFileTypes: true });
    const artistFolders = items
        .filter(item => item.isDirectory())
        .map(item => item.name);

    console.log(`📋 共有 ${artistFolders.length} 个歌手文件夹待检查`);

    const totalReport = [];
    let artistsWithDuplicates = 0;
    let totalDuplicateGroups = 0;

    for (const [index, artistName] of artistFolders.entries()) {
        if (skipArtists.includes(artistName)) {
             continue;
        }

        const artistDir = path.join(rootDir, artistName);

        // Progress log every 10 artists or so
        if (index % 10 === 0) {
            process.stdout.write(`\r⏳ 正在处理 (${index + 1}/${artistFolders.length}): ${artistName}...   `);
        }

        const files = findFiles(artistDir, { audioOnly: true });
        if (files.length < 2) continue; // No duplicates possible if < 2 files

        const fileInfos = files.map(f => ({
            path: f,
            size: fs.statSync(f).size,
            name: path.basename(f)
        }));

        const currentArtistDuplicates = [];

        // --- A. Exact Duplicates ---
        const sizeMap = new Map();
        fileInfos.forEach(f => {
            if (!sizeMap.has(f.size)) sizeMap.set(f.size, []);
            sizeMap.get(f.size).push(f);
        });

        for (const [size, group] of sizeMap) {
            if (group.length < 2 || size === 0) continue;
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
                    currentArtistDuplicates.push({
                        type: 'exact',
                        files: sameFiles,
                        size: size
                    });
                }
            }
        }

        // --- B. Semantic Duplicates ---
        // Only check files that are NOT already in exact duplicates groups?
        // Actually, simpler to just run the check and maybe flag them.
        // Or, to avoid double counting, we can ignore files identified as exact dupes?
        // Let's keep it simple: run independent checks, but in the report make sure we distinguish.

        const songMap = new Map();
        fileInfos.forEach(f => {
            // Already filtered in findFiles, but safe to keep check or remove
            // if (!/\.(mp3|m4a|flac|wav|wma|ape)$/i.test(f.name)) return;

            // Pass artistName as default
            const info = parseSongInfo(f.name, artistName);

            // Key is Title only? No, duplicate within "Jay Chou" folder might be "Zhou Jielun - Song" vs "Song".
            // If we use folder name as default artist, then "Song" -> "Jay Chou - Song".
            // So we can group by Title primarily, assuming the folder IS the artist.
            // But what if there is a "Feat. X" song?
            // "Jay Chou - Song A" vs "Jay Chou feat. X - Song A".
            // If we strictly group by "Artist|Title", these might not match.
            // But within a single artist folder, maybe grouping by normalized TITLE is aggressive but useful?
            // Let's stick to "Artist|Title" but with the fallback mechanism, it should catch most.

            // Normalize
            const cleanArtist = info.artist.toLowerCase().replace(/\s+/g, '');
            const cleanTitle = info.title.toLowerCase().replace(/\s+/g, '');

            if (cleanTitle) {
                // If the parsed artist is vaguely similar to the folder artist, unify them?
                // Too complex. Let's just use the key.
                const key = `${cleanArtist}|${cleanTitle}`;
                if (!songMap.has(key)) songMap.set(key, []);
                songMap.get(key).push(f);
            }
        });

        for (const [key, group] of songMap) {
            if (group.length > 1) {
                // Filter out if this group is purely a subset of an exact duplicate group
                // (i.e. if they are exact duplicates, we already reported them).
                // Check if all files in this group have the same Size (quick check).
                const sizes = new Set(group.map(g => g.size));
                if (sizes.size === 1) {
                    // Potential exact duplicate, likely caught by logic A.
                    // To avoid noise, let's skip if they are indeed exact dupes.
                    // But we don't have the hash here easily without re-reading.
                    // Let's just report them as "Possible Duplicate (Same Name)" and let user decide.
                    // Actually, if we want a clean report, better to de-dupe the reports.
                    // But for now, separate sections is fine.
                }

                currentArtistDuplicates.push({
                    type: 'semantic',
                    files: group,
                    key: key
                });
            }
        }

        // If we found anything
        if (currentArtistDuplicates.length > 0) {
            artistsWithDuplicates++;
            totalDuplicateGroups += currentArtistDuplicates.length;

            totalReport.push(`\n📂 歌手: ${artistName}`);

            currentArtistDuplicates.forEach(d => {
                if (d.type === 'exact') {
                    d.files.sort((a, b) => getScore(b) - getScore(a));
                    totalReport.push(`  🔒 完全重复 (Size: ${(d.size/1024/1024).toFixed(2)}MB):`);
                    d.files.forEach((f, i) => {
                        totalReport.push(`     ${i===0?'✅':'❌'} ${path.relative(artistDir, f.path)}`);
                    });
                } else {
                    d.files.sort((a, b) => getScore(b) - getScore(a));
                    const [artist, title] = d.key.split('|');
                    totalReport.push(`  🎵 疑似重复: ${title} (${d.files.length} 首)`);
                    d.files.forEach((f, i) => {
                        totalReport.push(`     ${i===0?'⭐':'  '} ${path.relative(artistDir, f.path)} (${(f.size/1024/1024).toFixed(2)}MB)`);
                    });
                }
            });
        }
    }

    console.log('\n\n✅ 扫描完成！');
    console.log(`📊 统计:`);
    console.log(`   - 检查歌手: ${artistFolders.length}`);
    console.log(`   - 发现重复的歌手: ${artistsWithDuplicates}`);
    console.log(`   - 重复文件组数: ${totalDuplicateGroups}`);

    if (totalReport.length > 0) {
        fs.writeFileSync(reportFile, totalReport.join('\n'));
        console.log(`\n📄 详细报告已生成: ${reportFile}`);
    } else {
        console.log('✨ 完美！没有发现任何重复。');
    }
}

run();
