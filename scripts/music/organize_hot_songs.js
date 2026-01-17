/**
 * 脚本名称: Organize Hot Songs (热门歌曲整理)
 * 功能描述: 根据 hot_songs.txt 名单，在歌手目录下查找对应歌曲，并移动到 hot_songs 子目录
 *
 * 使用方法:
 *   node organize_hot_songs.js "/Volumes/Music/歌手分类" [-s 起始位置] [--dry-run]
 *
 * 参数:
 *   -s, --start    起始歌手序号 (默认 1)
 *   --dry-run      仅显示将要移动的文件，不实际移动
 *   --skip         跳过的歌手名，逗号分隔
 *   -h, --help     显示帮助
 */

const fs = require('fs');
const path = require('path');
const OpenCC = require('opencc-js');

// ---------------------------------------------------------
// 1. 配置
// ---------------------------------------------------------

const AUDIO_EXTENSIONS = /\.(mp3|m4a|flac|wav|wma|ape)$/i;
const LRC_EXTENSION = /\.lrc$/i;
const HOT_SONGS_DIR = 'hot_songs';
const HOT_SONGS_FILE = 'hot_songs.txt';

// OpenCC 转换器：繁体 → 简体
const converter = OpenCC.Converter({ from: 'hk', to: 'cn' });

// 描述性后缀列表 (括号内容，用于去重)
const DESCRIPTIVE_SUFFIXES = [
    'live', 'remix', 'mix', 'cover', 'demo', 'acoustic', 'instrumental',
    'dj', '伴奏', '演唱会', '现场', '版', '大合唱', '合唱', '独唱',
    '钢琴版', '吉他版', '纯音乐', 'karaoke', 'ktv', 'radio edit',
    'remaster', 'remastered', 'bonus', 'edit', 'extended', 'short',
    '国语', '粤语', '日语', '英语', '翻唱'
];

// ---------------------------------------------------------
// 2. 工具函数
// ---------------------------------------------------------

function parseArgs() {
    const args = process.argv.slice(2);
    const result = {
        dir: null,
        start: 1,
        dryRun: false,
        skip: []
    };

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        const next = args[i + 1];

        if (arg.startsWith('-')) {
            switch (arg) {
                case '--start':
                case '-s':
                    result.start = parseInt(next, 10) || 1;
                    i++;
                    break;
                case '--dry-run':
                    result.dryRun = true;
                    break;
                case '--skip':
                    result.skip = next ? next.split(',').map(s => s.trim()) : [];
                    i++;
                    break;
                case '--help':
                case '-h':
                    printHelp();
                    process.exit(0);
            }
        } else if (!result.dir) {
            result.dir = arg;
        }
    }

    return result;
}

function printHelp() {
    console.log(`
🎵 热门歌曲整理工具

使用方法:
  node organize_hot_songs.js "/path/to/artists/dir" [选项]

选项:
  -s, --start     起始歌手序号 (默认 1，用于断点续传)
  --dry-run       仅显示将要移动的文件，不实际移动
  --skip "a,b,c"  跳过的歌手名，逗号分隔
  -h, --help      显示帮助

示例:
  node organize_hot_songs.js "/Volumes/Music/歌手分类"
  node organize_hot_songs.js "/Volumes/Music/歌手分类" --dry-run
  node organize_hot_songs.js "/Volumes/Music/歌手分类" -s 50
`);
}

/**
 * 递归查找目录中的所有文件
 */
function findAllFiles(dir, results = []) {
    try {
        if (!fs.existsSync(dir)) return results;

        const items = fs.readdirSync(dir, { withFileTypes: true });
        items.forEach(item => {
            if (item.name.startsWith('.') || item.name.startsWith('_')) return;

            const fullPath = path.join(dir, item.name);
            try {
                if (item.isDirectory()) {
                    findAllFiles(fullPath, results);
                } else {
                    results.push(fullPath);
                }
            } catch (e) {}
        });
    } catch (e) {}
    return results;
}

/**
 * 从 hot_songs.txt 解析歌曲列表
 * 格式：
 * 1. 歌手 - 歌曲名
 * 2. 歌手 - 歌曲名
 */
function parseHotSongsList(filePath) {
    try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const lines = content.split('\n');
        const songs = [];

        lines.forEach(line => {
            // 匹配格式: "数字. 歌手 - 歌曲名"
            const match = line.match(/^\s*\d+\.\s+(.+?)\s+-\s+(.+?)$/);
            if (match) {
                songs.push({
                    artist: match[1].trim(),
                    name: match[2].trim()
                });
            }
        });

        return songs;
    } catch (e) {
        console.error(`   ❌ 读取文件失败: ${e.message}`);
        return [];
    }
}

/**
 * 繁体转简体 (使用 OpenCC-js 库)
 */
function toSimplified(str) {
    return converter(str);
}

/**
 * 移除描述性后缀 (括号内容)
 * 例如: "趁早 (2005版)" -> "趁早", "用心良苦 [Remastered]" -> "用心良苦"
 * 借鉴自 hot_songs.js 的成熟去重逻辑
 */
function removeDescriptiveSuffix(name) {
    let result = name;
    let prev;

    // 循环移除所有后缀，直到没有变化
    do {
        prev = result;

        // 移除方括号内容 [xxx]
        result = result.replace(/\s*\[[^\]]*\]\s*$/i, '');

        // 移除圆括号内容 (xxx)，包括描述性后缀和数字版本
        // 这个正则会匹配：(描述性词汇), (数字版本), (任何文本)
        const suffixPattern = new RegExp(
            `\\s*[（(]\\s*([0-9a-zA-Z${DESCRIPTIVE_SUFFIXES.join('')}年版\\s\\-\\u4e00-\\u9fff]*)[^)）]*[)）]\\s*$`,
            'i'
        );
        result = result.replace(suffixPattern, '');

    } while (result !== prev);

    return result.trim();
}

/**
 * 生成歌曲规范化 Key (用于对比匹配)
 * 例如: "趁早 (2005版)" + "趁早" + "趁早 [Remastered]" -> 同一个 key
 * 借鉴自 hot_songs.js 的成熟去重逻辑
 */
function getSongKey(trackName) {
    let normalized = trackName;
    // 1. 移除描述性后缀
    normalized = removeDescriptiveSuffix(normalized);
    // 2. 繁体转简体
    normalized = toSimplified(normalized);
    // 3. 小写 + 移除空格和连字符
    normalized = normalized
        .toLowerCase()
        .replace(/\s+/g, '')
        .replace(/[-–—·]/g, '');  // 移除各种连字符和点号
    return normalized;
}

/**
 * 在目录中查找匹配的歌曲文件
 */
function findSongFile(dir, songName) {
    const targetKey = getSongKey(songName);
    const allFiles = findAllFiles(dir);

    for (const filePath of allFiles) {
        // 只考虑音频文件
        if (!AUDIO_EXTENSIONS.test(filePath)) continue;

        // 跳过 hot_songs 目录下的文件
        if (filePath.includes(`/${HOT_SONGS_DIR}/`) || filePath.includes(`\\${HOT_SONGS_DIR}\\`)) {
            continue;
        }

        const fileName = path.basename(filePath);
        const fileKey = getSongKey(fileName);

        if (fileKey === targetKey) {
            return filePath;
        }

        if (fileKey && targetKey && (fileKey.includes(targetKey) || targetKey.includes(fileKey))) {
            return filePath;
        }
    }

    return null;
}

/**
 * 查找关联的歌词文件
 */
function findLrcFile(audioFilePath) {
    const baseName = path.basename(audioFilePath, path.extname(audioFilePath));
    const lrcPath = path.join(path.dirname(audioFilePath), baseName + '.lrc');

    if (fs.existsSync(lrcPath)) {
        return lrcPath;
    }

    return null;
}

/**
 * 创建 hot_songs 目录
 */
function ensureHotSongsDir(artistDir) {
    const hotSongsDir = path.join(artistDir, HOT_SONGS_DIR);
    try {
        if (!fs.existsSync(hotSongsDir)) {
            fs.mkdirSync(hotSongsDir, { recursive: true });
        }
        return hotSongsDir;
    } catch (e) {
        console.error(`   ❌ 创建目录失败: ${e.message}`);
        return null;
    }
}

/**
 * 移动文件
 */
function moveFile(srcPath, destPath, dryRun = false) {
    try {
        if (dryRun) {
            return true;
        }

        // 检查目标文件是否已存在
        if (fs.existsSync(destPath)) {
            console.log(`   ⚠️  目标文件已存在，跳过: ${path.basename(destPath)}`);
            return false;
        }

        fs.renameSync(srcPath, destPath);
        return true;
    } catch (e) {
        console.error(`   ❌ 移动文件失败: ${e.message}`);
        return false;
    }
}

/**
 * 获取子目录列表
 */
function getSubDirs(dirPath) {
    try {
        if (!fs.existsSync(dirPath)) return [];

        const items = fs.readdirSync(dirPath, { withFileTypes: true });
        return items
            .filter(item => item.isDirectory() && !item.name.startsWith('.') && !item.name.startsWith('_'))
            .map(item => item.name)
            .sort();
    } catch (e) {
        return [];
    }
}

// ---------------------------------------------------------
// 3. 主函数
// ---------------------------------------------------------

function main() {
    const args = parseArgs();

    if (!args.dir) {
        console.error('❌ 请提供目录路径');
        printHelp();
        return;
    }

    // 获取所有歌手目录
    const artists = getSubDirs(args.dir);

    if (artists.length === 0) {
        console.log('❌ 未找到任何歌手目录');
        return;
    }

    // 过滤跳过的歌手
    const skipSet = new Set(args.skip);
    const toProcess = artists.filter(a => !skipSet.has(a));

    // 确定起始位置
    const startIndex = Math.max(0, args.start - 1);
    const finalList = toProcess.slice(startIndex);

    console.log(`\n📂 开始整理热门歌曲`);
    console.log(`📍 目录: ${args.dir}`);
    console.log(`👥 歌手总数: ${artists.length}`);
    console.log(`🔄 待处理: ${finalList.length}`);
    if (args.dryRun) {
        console.log(`🔍 模式: 仅预览（不实际移动）\n`);
    } else {
        console.log(`💾 模式: 实际移动\n`);
    }

    let totalMoved = 0;
    let successCount = 0;

    for (let i = 0; i < finalList.length; i++) {
        const artist = finalList[i];
        const artistDir = path.join(args.dir, artist);
        const hotSongsListPath = path.join(artistDir, HOT_SONGS_FILE);

        // 检查是否有 hot_songs.txt
        if (!fs.existsSync(hotSongsListPath)) {
            continue;
        }

        const progress = `[${String(startIndex + i + 1).padStart(String(artists.length).length, ' ')}/${artists.length}]`;
        process.stdout.write(`${progress} ${artist.padEnd(30)}... `);

        // 解析歌曲列表
        const songsList = parseHotSongsList(hotSongsListPath);
        if (songsList.length === 0) {
            console.log(`⏭️  无有效歌曲\n`);
            continue;
        }

        // 查找并移动歌曲
        let movedCount = 0;
        const hotSongsDir = ensureHotSongsDir(artistDir);

        if (!hotSongsDir) {
            console.log(`❌ 创建目录失败\n`);
            continue;
        }

        for (const song of songsList) {
            const songFilePath = findSongFile(artistDir, song.name);

            if (songFilePath) {
                // 移动歌曲文件
                const fileName = path.basename(songFilePath);
                const destPath = path.join(hotSongsDir, fileName);

                if (moveFile(songFilePath, destPath, args.dryRun)) {
                    // 查找并移动对应的歌词文件
                    const lrcFilePath = findLrcFile(songFilePath);
                    if (lrcFilePath) {
                        const lrcFileName = path.basename(lrcFilePath);
                        const lrcDestPath = path.join(hotSongsDir, lrcFileName);
                        moveFile(lrcFilePath, lrcDestPath, args.dryRun);
                    }

                    movedCount++;
                }
            }
        }

        if (movedCount > 0) {
            console.log(`✅ 找到并移动 ${movedCount} 首`);
            successCount++;
            totalMoved += movedCount;
        } else {
            console.log(`⚠️  未找到任何歌曲`);
        }
    }

    // 输出统计
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`\n📊 处理完成!\n`);
    console.log(`✅ 已处理的歌手: ${successCount}`);
    console.log(`📀 已移动的歌曲: ${totalMoved} 首\n`);

    if (args.dryRun) {
        console.log(`💡 提示: 这是预览模式，实际执行请去掉 --dry-run 参数\n`);
    } else {
        console.log(`✨ 所有热门歌曲已整理到各歌手的 ${HOT_SONGS_DIR} 目录\n`);
    }
}

main();
