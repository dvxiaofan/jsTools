/**
 * 脚本名称: Clean Directory Duplicates (单目录重复清理)
 * 功能描述: 扫描指定目录，检测重复歌曲（完全重复或同名不同文件），保留评分最高的一个，其余移入回收站。
 * 使用方法: 
 *    node clean_directory_duplicates.js [目标目录] [回收站目录]
 */

const fs = require('fs');
const path = require('path');
const { findFiles, getFileHash, parseSongInfo, getScore } = require('./check_duplicates_utils');

// Config
const targetDir = process.argv[2] || '/Volumes/Music/华语精选';
const trashDir = process.argv[3] || '/Volumes/Music/duplicates/_single_dir_trash';

// ---------------------------------------------------------
// Helpers
// ---------------------------------------------------------

function moveFileToTrash(filePath) {
    try {
        if (!fs.existsSync(trashDir)) {
            fs.mkdirSync(trashDir, { recursive: true });
        }

        const fileName = path.basename(filePath);
        let destPath = path.join(trashDir, fileName);

        // Avoid overwrite
        if (fs.existsSync(destPath)) {
            const ext = path.extname(fileName);
            const nameNoExt = path.basename(fileName, ext);
            destPath = path.join(trashDir, `${nameNoExt}_${Date.now()}${ext}`);
        }

        fs.renameSync(filePath, destPath);
        
        // Check for LRC
        const lrcPath = filePath.replace(/\.[^.]+$/, '.lrc');
        if (fs.existsSync(lrcPath)) {
             const lrcName = path.basename(lrcPath);
             const lrcDest = path.join(trashDir, lrcName); // Simplified overwrite logic for LRC
             fs.renameSync(lrcPath, lrcDest);
        }
        
        return true;
    } catch (e) {
        console.error(`❌ Failed to move ${filePath}: ${e.message}`);
        return false;
    }
}

// ---------------------------------------------------------
// Main
// ---------------------------------------------------------

function run() {
    console.log(`🚀 开始清理目录: ${targetDir}`);
    console.log(`🗑️  回收站: ${trashDir}`);

    if (!fs.existsSync(targetDir)) {
        console.error('❌ 目标目录不存在');
        return;
    }

    // 1. Scan files
    // Use shallow scan? Or recursive? 
    // Usually "华语精选" implies flat structure, but findFiles is recursive.
    // Let's stick to recursive but flat logic for grouping.
    const files = findFiles(targetDir);
    console.log(`📁 找到 ${files.length} 个文件`);

    if (files.length < 2) {
        console.log('✨ 文件太少，无需清理。');
        return;
    }

    const fileInfos = files.map(f => ({
        path: f,
        size: fs.statSync(f).size,
        name: path.basename(f)
    }));

    const processedPaths = new Set();
    let movedCount = 0;

    // ---------------------------------------------------------
    // A. Exact Duplicates (Size + MD5)
    // ---------------------------------------------------------
    console.log('\n🔒 检测完全重复文件...');
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
                // Sort by Score
                sameFiles.sort((a, b) => getScore(b) - getScore(a));
                
                // Keep 0, move 1..n
                const winner = sameFiles[0];
                const losers = sameFiles.slice(1);

                losers.forEach(loser => {
                    if (!processedPaths.has(loser.path)) {
                        console.log(`   [完全重复] 移动: ${loser.name}`);
                        if (moveFileToTrash(loser.path)) {
                            movedCount++;
                            processedPaths.add(loser.path);
                        }
                    }
                });
            }
        }
    }

    // ---------------------------------------------------------
    // B. Semantic Duplicates (Same Artist + Title)
    // ---------------------------------------------------------
    console.log('\n🎵 检测疑似重复歌曲...');
    const songMap = new Map();
    
    fileInfos.forEach(f => {
        if (processedPaths.has(f.path)) return; // Already moved
        if (!fs.existsSync(f.path)) return;

        const info = parseSongInfo(f.name);
        // We need stricter check here. If artist is unknown, maybe group by Title only?
        // But title overlap is dangerous (e.g. "Intro", "Love").
        // Let's use Artist|Title if Artist exists, or Title only if length > 4 chars.
        
        const cleanArtist = info.artist.toLowerCase().replace(/\s+/g, '');
        const cleanTitle = info.title.toLowerCase().replace(/\s+/g, '');

        let key = '';
        if (cleanArtist && cleanArtist !== 'unknown') {
            key = `${cleanArtist}|${cleanTitle}`;
        } else if (cleanTitle.length > 3) { // Slightly relaxed for single dir
            key = `unknown|${cleanTitle}`;
        } else {
            return;
        }

        if (!songMap.has(key)) songMap.set(key, []);
        songMap.get(key).push(f);
    });

    for (const [key, group] of songMap) {
        if (group.length > 1) {
            // Sort by Score
            group.sort((a, b) => getScore(b) - getScore(a));

            const winner = group[0];
            const losers = group.slice(1);

            // Double check: if keys are equal, does it mean they are definitely duplicates?
            // "陈奕迅 - 富士山下" vs "富士山下.mp3" -> Duplicates likely.
            
            console.log(`   [疑似重复] 组: ${key}`);
            console.log(`      ✅ 保留: ${winner.name} (${(winner.size/1024/1024).toFixed(1)}MB)`);
            
            losers.forEach(loser => {
                if (!processedPaths.has(loser.path)) {
                    console.log(`      ❌ 移动: ${loser.name} (${(loser.size/1024/1024).toFixed(1)}MB)`);
                    if (moveFileToTrash(loser.path)) {
                        movedCount++;
                        processedPaths.add(loser.path);
                    }
                }
            });
        }
    }

    console.log(`\n🎉 清理完成！共移动 ${movedCount} 个文件。`);
}

run();
