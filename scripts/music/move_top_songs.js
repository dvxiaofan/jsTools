/**
 * 脚本名称: Move Top Songs (热门歌曲整理工具)
 * 功能描述:
 *   根据 artist_top_songs.txt 文件中的列表，
 *   在各歌手目录下查找对应的歌曲文件（及歌词），
 *   并将其移动到该歌手目录下的 top_songs 子目录中。
 *
 * 匹配逻辑:
 *   1. 读取 artist_top_songs.txt，解析出 歌手 -> [歌曲列表] 的映射
 *   2. 遍历每个歌手目录
 *   3. 对目录下的文件进行模糊匹配（忽略大小写、忽略括号内容、忽略扩展名）
 *   4. 找到匹配文件后，移动到 ./top_songs/ 目录
 *   5. 同时移动对应的 .lrc 歌词文件
 *
 * 使用方法:
 *   node move_top_songs.js [目标目录] [列表文件路径]
 */

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------
// 1. 配置
// ---------------------------------------------------------

const AUDIO_EXTENSIONS = /\.(mp3|m4a|flac|wav|ogg|aac|ape|wma|dff|dsf)$/i;
const LRC_EXTENSION = /\.lrc$/i;

// ---------------------------------------------------------
// 2. 工具函数
// ---------------------------------------------------------

/**
 * 解析 artist_top_songs.txt 文件
 * 返回: Map<ArtistName, Set<SongName>>
 */
function parseSongList(filePath) {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');

    const result = new Map();
    let currentArtist = null;

    for (let line of lines) {
        line = line.trim();
        if (!line) continue;

        // 匹配歌手行: "### 歌手名 (数量 首)"
        const artistMatch = line.match(/^###\s+(.+?)\s+\(\d+\s+首\)/);
        if (artistMatch) {
            currentArtist = artistMatch[1].trim();
            result.set(currentArtist, new Set());
            continue;
        }

        // 匹配歌曲行: "01. 歌曲名"
        // 注意：有些歌曲名可能包含 feat. 或括号，后续匹配时需要处理
        if (currentArtist && /^\d+\./.test(line)) {
            let songName = line.replace(/^\d+\.\s+/, '').trim();
            result.get(currentArtist).add(songName);
        }
    }
    return result;
}

/**
 * 规范化字符串用于比较
 * 1. 转小写
 * 2. 移除括号及内容 (Live, feat. 等)
 * 3. 移除特殊字符
 * 4. 移除多余空格
 */
function normalizeString(str) {
    if (!str) return '';

    // 移除括号内容 (包括中文和英文括号)
    // 策略：先移除常见的后缀词，再移除所有括号内容，以提高匹配率
    let s = str.toLowerCase();

    // 移除 feat./ft. 及其后内容 (通常不算作歌名核心部分)
    s = s.replace(/[\(\[【（]\s*(feat|ft)\.?\s+.*$/i, '');

    // 移除 Live, Remix 等后缀
    const suffixes = ['live', 'remix', 'mix', 'cover', '伴奏', '纯音乐', '现场', '版'];
    suffixes.forEach(suffix => {
        const regex = new RegExp(`[\\(\\[【（].*${suffix}.*[\\)\\]】）]`, 'g');
        s = s.replace(regex, '');
    });

    // 移除所有剩余的括号内容 (作为最后的手段，可能过于激进，但对于top songs匹配通常有效)
    s = s.replace(/[\(\[【（].*?[\)\]】）]/g, '');

    // 移除标点符号
    s = s.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()\[\]'"?]/g, ' ');

    // 移除多余空格
    s = s.replace(/\s+/g, ' ').trim();

    // 移除开头的数字序号 (如 "01. ", "1 - ")
    s = s.replace(/^\d+[\.\s\-_]+/, '');

    return s;
}

/**
 * 递归获取目录下所有文件
 */
function getAllFiles(dirPath, arrayOfFiles) {
    const files = fs.readdirSync(dirPath);

    arrayOfFiles = arrayOfFiles || [];

    files.forEach(function(file) {
        const fullPath = path.join(dirPath, file);
        if (fs.statSync(fullPath).isDirectory()) {
            if (file !== 'top_songs') { // 避免扫描已移动的目录
                arrayOfFiles = getAllFiles(fullPath, arrayOfFiles);
            }
        } else {
            arrayOfFiles.push(fullPath);
        }
    });

    return arrayOfFiles;
}

/**
 * 检查文件名是否匹配歌曲名列表
 * 返回匹配到的标准歌曲名 (用于日志)，未匹配返回 null
 */
function findMatch(fileName, songSet) {
    const normFileName = normalizeString(path.parse(fileName).name);

    for (const song of songSet) {
        const normSong = normalizeString(song);

        // 1. 精确匹配 (规范化后)
        if (normFileName === normSong) return song;

        // 2. 包含匹配 (文件名包含歌名，或歌名包含文件名)
        // 注意：这里需要小心，比如 "Love" 可能匹配 "Love Story"，需要长度限制或边界检查
        // 对于 Top Songs 场景，我们假设列表里的歌名是核心词
        if (normFileName.includes(normSong) && normFileName.length < normSong.length * 1.5) return song;

        // 3. 反向包含 (列表里的歌名可能更长，包含额外信息)
        if (normSong.includes(normFileName) && normSong.length < normFileName.length * 1.5) return song;
    }
    return null;
}

/**
 * 获取同名歌词文件
 */
function getLrcPath(audioPath) {
    const dir = path.dirname(audioPath);
    const name = path.basename(audioPath, path.extname(audioPath));
    const lrcPath = path.join(dir, `${name}.lrc`);
    return fs.existsSync(lrcPath) ? lrcPath : null;
}

// ---------------------------------------------------------
// 3. 主逻辑
// ---------------------------------------------------------

function run() {
    // 默认路径配置
    const defaultListPath = '/Users/ccfun/Downloads/压缩包/artist_top_songs.txt';
    const defaultTargetDir = '/Users/ccfun/Downloads/压缩包'; // 假设歌手目录就在这个目录下

    const targetDir = process.argv[2] || defaultTargetDir;
    const listPath = process.argv[3] || defaultListPath;

    console.log(`\n🎵 热门歌曲整理工具`);
    console.log(`📂 目标目录: ${targetDir}`);
    console.log(`📄 列表文件: ${listPath}`);
    console.log('─'.repeat(50));

    if (!fs.existsSync(targetDir) || !fs.existsSync(listPath)) {
        console.error('❌ 目录或列表文件不存在');
        process.exit(1);
    }

    // 1. 解析列表
    console.log('⏳ 正在解析歌曲列表...');
    const artistSongs = parseSongList(listPath);
    console.log(`   共找到 ${artistSongs.size} 位歌手的榜单数据`);

    let totalMoved = 0;

    // 2. 遍历歌手
    for (const [artist, songs] of artistSongs) {
        // 尝试找到歌手目录
        // 策略：目录名可能包含歌手名，或者完全一致
        // 这里简化为：在 targetDir 下查找包含 artist 名字的目录
        const items = fs.readdirSync(targetDir);
        let artistDir = null;

        for (const item of items) {
            const fullPath = path.join(targetDir, item);
            if (fs.statSync(fullPath).isDirectory()) {
                if (item.toLowerCase().includes(artist.toLowerCase()) || artist.toLowerCase().includes(item.toLowerCase())) {
                    artistDir = fullPath;
                    break;
                }
            }
        }

        if (!artistDir) {
            console.log(`\n⚠️  未找到歌手目录: ${artist}`);
            continue;
        }

        console.log(`\n🔍 处理歌手: ${artist} (目录: ${path.basename(artistDir)})`);

        // 创建 top_songs 目录
        const topSongsDir = path.join(artistDir, 'top_songs');
        if (!fs.existsSync(topSongsDir)) {
            fs.mkdirSync(topSongsDir);
        }

        // 扫描歌手目录下的文件 (递归)
        const files = getAllFiles(artistDir);
        let movedCount = 0;

        for (const fullPath of files) {
            const file = path.basename(fullPath);

            // 跳过非音频文件
            if (!AUDIO_EXTENSIONS.test(file)) continue;

            // 匹配
            const matchedSong = findMatch(file, songs);
            if (matchedSong) {
                // 移动音频文件
                const targetPath = path.join(topSongsDir, file);

                // 防止移动到自身 (虽然逻辑上不会，但安全第一)
                if (fullPath !== targetPath) {
                    try {
                        fs.renameSync(fullPath, targetPath);
                        console.log(`   ✅ [${matchedSong}] 移动: ${file} (来自: ${path.relative(artistDir, path.dirname(fullPath))})`);

                        // 移动歌词
                        const lrcPath = getLrcPath(fullPath);
                        if (lrcPath) {
                            const lrcName = path.basename(lrcPath);
                            const targetLrcPath = path.join(topSongsDir, lrcName);
                            fs.renameSync(lrcPath, targetLrcPath);
                            console.log(`      📝 移动歌词: ${lrcName}`);
                        }

                        movedCount++;
                    } catch (e) {
                        console.error(`   ❌ 移动失败 ${file}: ${e.message}`);
                    }
                }
            }
        }

        if (movedCount === 0) {
            console.log(`   (未找到匹配歌曲)`);
            // 如果目录为空，可以删除 top_songs 目录
            if (fs.readdirSync(topSongsDir).length === 0) {
                fs.rmdirSync(topSongsDir);
            }
        } else {
            totalMoved += movedCount;
        }
    }

    console.log('\n' + '═'.repeat(50));
    console.log(`🎉 全部完成！共移动 ${totalMoved} 首歌曲。`);
}

run();
