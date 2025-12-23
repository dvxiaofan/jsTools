/**
 * 脚本名称: Check Collection In Library (集合歌曲库内查找)
 * 功能描述: 检查指定集合目录（如"一人一首成名曲"）中的歌曲，是否已存在于“歌手分类”库中。
 *          如果存在，输出到报告文件。
 * 使用方法: 
 *    node check_collection_in_library.js [集合目录] [歌手库目录]
 */

const fs = require('fs');
const path = require('path');
const { parseSongInfo, getFileHash } = require('./check_duplicates_utils');

// Config
const collectionDir = process.argv[2] || '/Volumes/Music/一人一首成名曲';
const libraryDir = process.argv[3] || '/Volumes/Music/歌手分类';
const reportFile = 'collection_duplicates_report.txt';

function run() {
    console.log(`🚀 开始检查集合: ${collectionDir}`);
    console.log(`📂 对比目标库: ${libraryDir}`);

    if (!fs.existsSync(collectionDir) || !fs.existsSync(libraryDir)) {
        console.error('❌ 目录不存在，请检查路径。');
        return;
    }

    // 1. Scan Collection
    let collectionFiles = [];
    try {
        collectionFiles = fs.readdirSync(collectionDir).filter(f => !f.startsWith('.') && /\.(mp3|wav|flac|m4a|ape)$/i.test(f));
    } catch (e) {
        console.error('无法读取集合目录:', e.message);
        return;
    }

    console.log(`📋 集合中共有 ${collectionFiles.length} 首歌曲。`);

    const foundDuplicates = [];
    const notFound = [];

    // 2. Iterate and Check
    collectionFiles.forEach((fileName, index) => {
        if (index % 10 === 0) process.stdout.write(`\r⏳ 正在检查 (${index + 1}/${collectionFiles.length})... `);

        const filePath = path.join(collectionDir, fileName);
        
        // Parse Artist & Title
        // Note: The files in "一人一首成名曲" seem to be in format "01 Title（Artist）.wav"
        // Our utility `parseSongInfo` handles "Title(Artist)" format.
        const info = parseSongInfo(fileName);
        
        const artist = info.artist;
        const title = info.title;

        // If artist is unknown, we can't efficiently check in library (unless we scan everything, which is slow)
        // But for this specific folder, most seem to have (Artist).
        
        if (!artist || artist === 'Unknown') {
            notFound.push({ file: fileName, reason: 'Unknown Artist' });
            return;
        }

        // Check if Artist Folder exists in Library
        // We need to handle potential naming differences (e.g. "S.H.E" vs "S.H.E.")
        // Or "周杰伦" vs "Jay Chou"? Assuming Chinese names match.
        
        const targetArtistDir = path.join(libraryDir, artist);
        
        // Simple check first
        let actualArtistDir = null;
        if (fs.existsSync(targetArtistDir)) {
            actualArtistDir = targetArtistDir;
        } else {
            // Case-insensitive check or fuzzy check?
            try {
                const libraryArtists = fs.readdirSync(libraryDir);
                const match = libraryArtists.find(a => a.toLowerCase() === artist.toLowerCase());
                if (match) {
                    actualArtistDir = path.join(libraryDir, match);
                }
            } catch(e) {}
        }

        if (actualArtistDir) {
            // Artist folder found. Now look for the song.
            // Scan artist dir
            let artistSongs = [];
            try {
                artistSongs = fs.readdirSync(actualArtistDir);
            } catch(e) {}

            // Check for Title match
            // Title in collection: "勇气" (from "03 勇气（梁静茹）.wav")
            // Title in library might be: "勇气.mp3", "01 勇气.flac", "梁静茹 - 勇气.mp3"
            
            // Normalize title for comparison
            const targetTitleClean = title.toLowerCase().replace(/\s+/g, '');
            
            const matchSong = artistSongs.find(songFile => {
                if (songFile.startsWith('.')) return false;
                const songInfo = parseSongInfo(songFile, artist); // reuse utility
                const songTitleClean = songInfo.title.toLowerCase().replace(/\s+/g, '');
                
                // Strict containment or equality?
                // "勇气" == "勇气" -> Match
                // "勇气Live" != "勇气"
                return songTitleClean === targetTitleClean || songTitleClean.includes(targetTitleClean) && songTitleClean.length < targetTitleClean.length + 5;
            });

            if (matchSong) {
                const matchPath = path.join(actualArtistDir, matchSong);
                foundDuplicates.push({
                    source: fileName,
                    sourcePath: filePath,
                    target: matchSong,
                    targetPath: matchPath,
                    artist: artist
                });
            } else {
                notFound.push({ file: fileName, reason: 'Song not found in Artist folder' });
            }

        } else {
            notFound.push({ file: fileName, reason: `Artist folder [${artist}] not found` });
        }
    });

    console.log('\n\n✅ 检查完成！');
    
    // Generate Report
    const lines = [];
    lines.push(`检查时间: ${new Date().toLocaleString()}`);
    lines.push(`集合目录: ${collectionDir}`);
    lines.push(`目标库: ${libraryDir}`);
    lines.push(`----------------------------------------`);
    lines.push(`共检查: ${collectionFiles.length} 首`);
    lines.push(`发现已存在: ${foundDuplicates.length} 首`);
    lines.push(`未找到: ${notFound.length} 首`);
    lines.push(`----------------------------------------`);
    
    if (foundDuplicates.length > 0) {
        lines.push('\n[已存在的歌曲] (建议处理):');
        foundDuplicates.forEach(d => {
            lines.push(`\n源文件: ${d.source}`);
            lines.push(`  -> 对应库中: [${d.artist}] ${d.target}`);
            lines.push(`  -> 库路径: ${d.targetPath}`);
        });
    }

    if (notFound.length > 0) {
        lines.push('\n[未找到的歌曲] (可能需要导入):');
        // Group by reason
        const artistMissing = notFound.filter(i => i.reason.includes('Artist folder'));
        const songMissing = notFound.filter(i => i.reason.includes('Song not found'));
        const otherMissing = notFound.filter(i => !i.reason.includes('Artist folder') && !i.reason.includes('Song not found'));

        if (artistMissing.length > 0) {
            lines.push(`\n  --- 歌手文件夹不存在 (${artistMissing.length}) ---`);
            artistMissing.forEach(i => lines.push(`  ${i.file}  <-- ${i.reason}`));
        }
        if (songMissing.length > 0) {
            lines.push(`\n  --- 歌手存在但歌没找到 (${songMissing.length}) ---`);
            songMissing.forEach(i => lines.push(`  ${i.file}`));
        }
        if (otherMissing.length > 0) {
            lines.push(`\n  --- 其他原因 (${otherMissing.length}) ---`);
            otherMissing.forEach(i => lines.push(`  ${i.file} (${i.reason})`));
        }
    }

    fs.writeFileSync(reportFile, lines.join('\n'));
    console.log(`📄 报告已生成: ${reportFile}`);
}

run();
