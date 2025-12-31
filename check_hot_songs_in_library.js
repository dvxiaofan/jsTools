/**
 * 脚本名称: Check Hot Songs In Library (华语精选库内查找)
 * 功能描述: 检查“华语精选”目录中的歌曲，是否已存在于“歌手分类”库中。
 *          只列出找到的歌曲名字到报告文件。
 * 使用方法: 
 *    node check_hot_songs_in_library.js [华语精选目录] [歌手库目录]
 */

const fs = require('fs');
const path = require('path');
const { parseSongInfo, findFiles } = require('./check_duplicates_utils');

// Config
const hotSongsDir = process.argv[2] || '/Volumes/Music/华语精选';
const libraryDir = process.argv[3] || '/Volumes/Music/歌手分类';
const reportFile = 'hot_songs_in_library_report.txt';

function run() {
    console.log(`🚀 开始检查: ${hotSongsDir}`);
    console.log(`📂 对比目标库: ${libraryDir}`);

    if (!fs.existsSync(hotSongsDir) || !fs.existsSync(libraryDir)) {
        console.error('❌ 目录不存在，请检查路径。');
        return;
    }

    // 1. Scan Hot Songs Dir
    console.log('⏳ 正在扫描华语精选目录...');
    const hotFiles = findFiles(hotSongsDir, { audioOnly: true });
    console.log(`📋 共找到 ${hotFiles.length} 首歌曲。`);

    // 2. Scan Library (Build Index for Speed)
    // Because checking every file against every artist folder is slow.
    // We can index Library by Artist.
    console.log('⏳ 正在索引歌手库 (这可能需要一点时间)...');
    
    // Index: ArtistName -> Set(CleanTitle)
    const libraryIndex = new Map();
    let librarySongCount = 0;

    try {
        const artists = fs.readdirSync(libraryDir);
        artists.forEach((artistDirName, idx) => {
            if (artistDirName.startsWith('.')) return;
            const fullArtistPath = path.join(libraryDir, artistDirName);
            try {
                if (fs.statSync(fullArtistPath).isDirectory()) {
                    // We assume folder name is Artist Name
                    // Normalize artist name key
                    const artistKey = artistDirName.toLowerCase().replace(/\s+/g, '');
                    
                    if (!libraryIndex.has(artistKey)) {
                        libraryIndex.set(artistKey, new Set());
                    }

                    // Read songs in artist folder
                    const songs = fs.readdirSync(fullArtistPath);
                    songs.forEach(songFile => {
                        if (songFile.startsWith('.') || !/\.(mp3|m4a|flac|wav|wma|ape)$/i.test(songFile)) return;
                        
                        const info = parseSongInfo(songFile, artistDirName);
                        const cleanTitle = info.title.toLowerCase().replace(/\s+/g, '');
                        
                        libraryIndex.get(artistKey).add(cleanTitle);
                        librarySongCount++;
                    });
                }
            } catch(e) {}
        });
    } catch(e) {
        console.error('索引库失败:', e.message);
        return;
    }
    console.log(`📚 库索引完成: ${libraryIndex.size} 位歌手, ${librarySongCount} 首歌曲。`);

    // 3. Compare
    const foundList = [];
    const notFoundList = [];

    hotFiles.forEach((filePath, index) => {
        const fileName = path.basename(filePath);
        const info = parseSongInfo(fileName);
        
        const artist = info.artist;
        const title = info.title;

        // If artist is unknown, we can't efficiently check
        if (!artist || artist.toLowerCase() === 'unknown') {
            notFoundList.push({ file: fileName, reason: 'Unknown Artist' });
            return;
        }

        const targetArtistKey = artist.toLowerCase().replace(/\s+/g, '');
        const targetTitleKey = title.toLowerCase().replace(/\s+/g, '');

        // Check if artist exists
        // Fuzzy match artist? For now exact match on normalized key
        // Try direct match
        let artistSongs = libraryIndex.get(targetArtistKey);
        
        // Try finding if any key contains this artist or vice versa (simple fuzzy)
        if (!artistSongs) {
            for (const [k, v] of libraryIndex) {
                // 更宽松的歌手名匹配：
                // 1. 包含关系：k.includes(target) OR target.includes(k)
                // 2. 忽略中间的 "The" 等前缀 (暂时不做)
                if (k.includes(targetArtistKey) || targetArtistKey.includes(k)) {
                    // Length check to avoid "Jay" matching "Jay Chou" if logic reversed?
                    // Safe enough for now.
                    if (Math.abs(k.length - targetArtistKey.length) < 5) {
                        artistSongs = v;
                        break;
                    }
                }
            }
        }

        if (artistSongs) {
            // Check title
            let found = false;
            // Normalize target title key (remove spaces)
            // But we should also support fuzzy matching on titles
            
            // 1. Exact match (cleaned)
            if (artistSongs.has(targetTitleKey)) {
                found = true;
            } else {
                // 2. Fuzzy title match
                for (const libTitle of artistSongs) {
                    // 只要 libTitle 包含 targetTitleKey，或者 targetTitleKey 包含 libTitle
                    if (libTitle.includes(targetTitleKey) || targetTitleKey.includes(libTitle)) {
                         // Length diff check to avoid too broad matches
                         if (Math.abs(libTitle.length - targetTitleKey.length) < 10) {
                             found = true;
                             break;
                         }
                    }
                }
            }

            if (found) {
                foundList.push(`${artist} - ${title}`);
            } else {
                notFoundList.push({ file: fileName, reason: 'Song not found in Artist folder' });
            }
        } else {
            // 如果没找到歌手文件夹，可能是歌手名识别错误，或者库里确实没有这个歌手
            // 但如果 "华语精选" 里的歌名是 "03 手放开.mp3"，parseSongInfo 可能会解析出 Title="手放开", Artist="Unknown"
            // 这时候就无法匹配。
            // 我们可以尝试全库搜索 Title (非常慢，但对于未匹配的可以试一下)
            
            // 全局搜索备用方案：只匹配 Title
            if (targetTitleKey.length > 4) { // 短歌名不敢乱配
                let foundInAnyArtist = false;
                for (const [artKey, songsSet] of libraryIndex) {
                     for (const s of songsSet) {
                         if (s === targetTitleKey) {
                             foundInAnyArtist = true;
                             break;
                         }
                     }
                     if (foundInAnyArtist) break;
                }
                if (foundInAnyArtist) {
                    foundList.push(`[Different Artist?] ${artist} - ${title}`);
                    // foundCount++; // logic below uses array length
                } else {
                    notFoundList.push({ file: fileName, reason: `Artist [${artist}] not found` });
                }
            } else {
                notFoundList.push({ file: fileName, reason: `Artist [${artist}] not found` });
            }
        }
    });

    console.log(`\n✅ 检查完成！`);
    console.log(`   发现重复: ${foundList.length} 首`);
    console.log(`   未找到: ${notFoundList.length} 首`);

    // 4. Generate Report
    const lines = [];
    lines.push(`检查时间: ${new Date().toLocaleString()}`);
    lines.push(`源目录: ${hotSongsDir}`);
    lines.push(`库目录: ${libraryDir}`);
    lines.push(`----------------------------------------`);
    lines.push(`[已存在于库中的歌曲] (${foundList.length} 首):`);
    foundList.sort().forEach(name => lines.push(name));
    
    // Optional: List not found? User asked for "found songs" only mostly?
    // "只查找列出歌曲名字在一个txt文件中" -> implicit: list the found ones.
    // Let's list found ones primarily.

    fs.writeFileSync(reportFile, lines.join('\n'));
    console.log(`📄 报告已生成: ${reportFile}`);
}

run();
