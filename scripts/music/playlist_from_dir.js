/**
 * 脚本名称: Playlist From Directory (目录歌单生成器)
 * 功能描述: 根据源目录的歌曲列表，在音乐库中匹配并生成播放列表
 *
 * 匹配策略 (三级递进):
 *   1. 精确匹配: 标题 + 艺术家完全一致
 *   2. 标准匹配: 仅标题一致
 *   3. 模糊匹配: 标题相似度 >= 80%
 *
 * 质量排序 (多版本时选最优):
 *   格式: DFF/DSF > FLAC > WAV > ALAC/M4A > AAC > MP3 > OGG
 *   同格式: 采样率 > 位深 > 比特率
 *
 * 使用方法:
 *   node playlist_from_dir.js --source "/源目录" --library "/音乐库" --name "歌单名"
 *
 * 参数:
 *   --source, -s   源目录 (包含歌曲文件作为名单)
 *   --library, -l  音乐库根目录 (搜索目标)
 *   --name, -n     歌单名称
 *   --output, -o   输出目录 (默认: 音乐库下的 playlists 目录)
 *   --dry-run      仅预览，不生成文件
 *   -h, --help     显示帮助
 *
 * 示例:
 *   node playlist_from_dir.js -s "/Downloads/新歌" -l "/Music" -n "新歌精选"
 */

const fs = require('fs');
const path = require('path');
const mm = require('music-metadata');

// ---------------------------------------------------------
// 配置
// ---------------------------------------------------------

const AUDIO_EXTENSIONS = /\.(mp3|m4a|flac|wav|ogg|aac|ape|wma|dff|dsf|alac)$/i;

// 格式质量优先级 (越大越好)
const FORMAT_PRIORITY = {
    'dff': 100,
    'dsf': 100,
    'flac': 90,
    'wav': 85,
    'alac': 80,
    'm4a': 70,
    'aac': 60,
    'mp3': 50,
    'ogg': 40,
    'ape': 35,
    'wma': 30
};

// 需要忽略的后缀/标记 (用于模糊匹配)
const IGNORE_PATTERNS = [
    /[\(\[【（](live|现场|演唱会|伴奏|纯音乐|instrumental|remix|cover|翻唱|dj版?|加长版?|完整版?|高清|无损|flac|mp3|320k|128k)[\)\]】）]/gi,
    /\s*[-–—]\s*(live|现场|伴奏|dj版?)$/gi,
    /\s+(live|现场版?|伴奏版?|dj版?)$/gi
];

// ---------------------------------------------------------
// 工具函数
// ---------------------------------------------------------

function parseArgs() {
    const args = process.argv.slice(2);
    const result = {
        source: null,
        library: null,
        name: null,
        output: null,
        dryRun: false,
        help: false
    };

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        const next = args[i + 1];

        switch (arg) {
            case '--source':
            case '-s':
                result.source = next;
                i++;
                break;
            case '--library':
            case '-l':
                result.library = next;
                i++;
                break;
            case '--name':
            case '-n':
                result.name = next;
                i++;
                break;
            case '--output':
            case '-o':
                result.output = next;
                i++;
                break;
            case '--dry-run':
                result.dryRun = true;
                break;
            case '--help':
            case '-h':
                result.help = true;
                break;
        }
    }

    return result;
}

function printHelp() {
    console.log(`
🎵 目录歌单生成器

根据源目录的歌曲列表，在音乐库中匹配并生成播放列表。

使用方法:
  node playlist_from_dir.js --source <源目录> --library <音乐库> --name <歌单名>

参数:
  --source, -s   源目录路径 (包含歌曲文件作为名单)
  --library, -l  音乐库根目录 (搜索目标)
  --name, -n     歌单名称
  --output, -o   输出目录 (默认: 音乐库/playlists)
  --dry-run      仅预览匹配结果，不生成文件
  -h, --help     显示帮助

匹配策略:
  1. 精确匹配  标题+艺术家完全一致
  2. 标准匹配  仅标题一致
  3. 模糊匹配  标题相似度>=80% (忽略Live/伴奏等后缀)

质量优先级:
  DFF/DSF > FLAC > WAV > M4A > AAC > MP3 > OGG

示例:
  # 基本用法
  node playlist_from_dir.js -s "/Downloads/新歌" -l "/Music" -n "新歌精选"

  # 仅预览
  node playlist_from_dir.js -s "/Downloads/新歌" -l "/Music" -n "新歌精选" --dry-run
`);
}

/**
 * 递归查找音频文件
 */
function findAudioFiles(dir) {
    let results = [];
    try {
        if (!fs.existsSync(dir)) return [];
        const list = fs.readdirSync(dir);

        for (const file of list) {
            if (file.startsWith('.') || file.startsWith('_')) continue;
            const fullPath = path.join(dir, file);
            try {
                const stat = fs.statSync(fullPath);
                if (stat.isDirectory()) {
                    results = results.concat(findAudioFiles(fullPath));
                } else if (AUDIO_EXTENSIONS.test(file)) {
                    results.push(fullPath);
                }
            } catch (e) {}
        }
    } catch (e) {}
    return results;
}

/**
 * 从文件名解析歌曲信息
 */
function parseFileName(filePath) {
    let name = path.basename(filePath, path.extname(filePath));

    // 去掉常见前缀 (序号等)
    name = name.replace(/^\d+[\.\-_\s]+/, '');
    name = name.replace(/^\[\d+\]\s*/, '');

    // 尝试各种分隔符拆分
    const separators = [' - ', ' – ', ' — ', '-'];
    let artist = null;
    let title = null;

    for (const sep of separators) {
        if (name.includes(sep)) {
            const parts = name.split(sep).map(s => s.trim()).filter(s => s);
            if (parts.length >= 2) {
                // 常见格式: "歌名-歌手" 或 "歌手-歌名"
                // 尝试判断哪个是歌手
                title = parts[0];
                artist = parts.slice(1).join(' ');
                break;
            }
        }
    }

    if (!title) {
        title = name.trim();
    }

    return { title, artist, original: name };
}

/**
 * 读取音频元数据
 */
async function getMetadata(filePath) {
    try {
        const metadata = await mm.parseFile(filePath, { duration: false });
        const ext = path.extname(filePath).slice(1).toLowerCase();

        return {
            path: filePath,
            title: metadata.common.title || parseFileName(filePath).title,
            artist: metadata.common.artist || parseFileName(filePath).artist || '',
            album: metadata.common.album || '',
            format: ext,
            sampleRate: metadata.format.sampleRate || 0,
            bitsPerSample: metadata.format.bitsPerSample || 0,
            bitrate: metadata.format.bitrate || 0
        };
    } catch (e) {
        const parsed = parseFileName(filePath);
        const ext = path.extname(filePath).slice(1).toLowerCase();
        return {
            path: filePath,
            title: parsed.title,
            artist: parsed.artist || '',
            album: '',
            format: ext,
            sampleRate: 0,
            bitsPerSample: 0,
            bitrate: 0
        };
    }
}

/**
 * 标准化字符串 (用于比较)
 */
function normalize(str) {
    if (!str) return '';
    return str
        .toLowerCase()
        .replace(/[（(]\s*feat\.?[^)）]*[)）]/gi, '') // 移除 feat
        .replace(/[\s\-_\.·]+/g, '')  // 移除空格和标点
        .replace(/['"「」『』""'']/g, ''); // 移除引号
}

/**
 * 清理标题 (用于模糊匹配)
 */
function cleanTitle(title) {
    if (!title) return '';
    let cleaned = title;
    for (const pattern of IGNORE_PATTERNS) {
        cleaned = cleaned.replace(pattern, '');
    }
    return cleaned.trim();
}

/**
 * 计算字符串相似度 (Levenshtein)
 */
function similarity(s1, s2) {
    const a = normalize(s1);
    const b = normalize(s2);

    if (a === b) return 1;
    if (!a || !b) return 0;

    const matrix = [];

    for (let i = 0; i <= b.length; i++) {
        matrix[i] = [i];
    }
    for (let j = 0; j <= a.length; j++) {
        matrix[0][j] = j;
    }

    for (let i = 1; i <= b.length; i++) {
        for (let j = 1; j <= a.length; j++) {
            if (b.charAt(i - 1) === a.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(
                    matrix[i - 1][j - 1] + 1,
                    matrix[i][j - 1] + 1,
                    matrix[i - 1][j] + 1
                );
            }
        }
    }

    const maxLen = Math.max(a.length, b.length);
    return 1 - matrix[b.length][a.length] / maxLen;
}

/**
 * 计算音频质量分数
 */
function qualityScore(meta) {
    let score = 0;

    // 格式分数
    score += (FORMAT_PRIORITY[meta.format] || 0) * 1000;

    // 采样率分数 (96kHz = 96, 44.1kHz = 44)
    score += (meta.sampleRate / 1000) * 10;

    // 位深分数 (24bit = 240, 16bit = 160)
    score += (meta.bitsPerSample || 16) * 10;

    // 比特率分数 (320kbps = 32)
    score += (meta.bitrate / 10000);

    return score;
}

/**
 * 匹配类型
 */
const MATCH_TYPE = {
    EXACT: 'exact',      // 精确匹配
    STANDARD: 'standard', // 标准匹配
    FUZZY: 'fuzzy',       // 模糊匹配
    NONE: 'none'          // 未匹配
};

/**
 * 在库中查找匹配的歌曲
 */
function findMatch(sourceMeta, libraryIndex) {
    const sourceTitle = normalize(sourceMeta.title);
    const sourceArtist = normalize(sourceMeta.artist);
    const sourceCleanTitle = normalize(cleanTitle(sourceMeta.title));

    let candidates = [];

    // 1. 精确匹配: 标题 + 艺术家
    for (const [key, items] of libraryIndex.entries()) {
        for (const item of items) {
            const libTitle = normalize(item.title);
            const libArtist = normalize(item.artist);

            if (sourceTitle === libTitle && sourceArtist && libArtist &&
                (sourceArtist === libArtist || sourceArtist.includes(libArtist) || libArtist.includes(sourceArtist))) {
                candidates.push({ ...item, matchType: MATCH_TYPE.EXACT });
            }
        }
    }

    if (candidates.length > 0) {
        return selectBest(candidates);
    }

    // 2. 标准匹配: 仅标题
    for (const [key, items] of libraryIndex.entries()) {
        for (const item of items) {
            const libTitle = normalize(item.title);
            if (sourceTitle === libTitle) {
                candidates.push({ ...item, matchType: MATCH_TYPE.STANDARD });
            }
        }
    }

    if (candidates.length > 0) {
        return selectBest(candidates);
    }

    // 3. 模糊匹配: 相似度 >= 80%
    for (const [key, items] of libraryIndex.entries()) {
        for (const item of items) {
            const libCleanTitle = normalize(cleanTitle(item.title));
            const sim = similarity(sourceCleanTitle, libCleanTitle);

            if (sim >= 0.8) {
                candidates.push({ ...item, matchType: MATCH_TYPE.FUZZY, similarity: sim });
            }
        }
    }

    if (candidates.length > 0) {
        // 模糊匹配时，优先选相似度最高的
        candidates.sort((a, b) => (b.similarity || 0) - (a.similarity || 0));
        const topSim = candidates[0].similarity;
        const topCandidates = candidates.filter(c => c.similarity === topSim);
        return selectBest(topCandidates);
    }

    return null;
}

/**
 * 从候选中选择质量最好的
 */
function selectBest(candidates) {
    if (candidates.length === 0) return null;
    if (candidates.length === 1) return candidates[0];

    // 按质量分数排序
    candidates.sort((a, b) => qualityScore(b) - qualityScore(a));
    return candidates[0];
}

/**
 * 构建库索引
 */
async function buildLibraryIndex(libraryPath, onProgress) {
    const index = new Map();
    const files = findAudioFiles(libraryPath);

    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const meta = await getMetadata(file);
        const key = normalize(meta.title);

        if (!index.has(key)) {
            index.set(key, []);
        }
        index.get(key).push(meta);

        if (onProgress && i % 100 === 0) {
            onProgress(i + 1, files.length);
        }
    }

    if (onProgress) {
        onProgress(files.length, files.length);
    }

    return index;
}

/**
 * 生成 m3u 播放列表
 */
function generateM3U(name, tracks, libraryPath) {
    let content = '#EXTM3U\n';
    content += `#PLAYLIST:${name}\n`;

    for (const track of tracks) {
        // 使用相对于音乐库的路径
        const relativePath = path.relative(libraryPath, track.path);
        content += `#EXTINF:-1,${track.artist ? track.artist + ' - ' : ''}${track.title}\n`;
        content += `${relativePath}\n`;
    }

    return content;
}

// ---------------------------------------------------------
// 主逻辑
// ---------------------------------------------------------

async function main() {
    const args = parseArgs();

    if (args.help) {
        printHelp();
        return;
    }

    // 验证参数
    if (!args.source || !args.library || !args.name) {
        console.error('❌ 缺少必要参数');
        console.log('   使用方法: node playlist_from_dir.js -s <源目录> -l <音乐库> -n <歌单名>');
        console.log('   使用 --help 查看帮助');
        process.exit(1);
    }

    if (!fs.existsSync(args.source)) {
        console.error(`❌ 源目录不存在: ${args.source}`);
        process.exit(1);
    }

    if (!fs.existsSync(args.library)) {
        console.error(`❌ 音乐库不存在: ${args.library}`);
        process.exit(1);
    }

    console.log(`\n🎵 目录歌单生成器\n`);
    console.log(`📂 源目录: ${args.source}`);
    console.log(`📚 音乐库: ${args.library}`);
    console.log(`📝 歌单名: ${args.name}`);
    console.log('─'.repeat(60));

    // 1. 扫描源目录
    console.log('\n⏳ 扫描源目录...');
    const sourceFiles = findAudioFiles(args.source);
    console.log(`   发现 ${sourceFiles.length} 个音频文件`);

    if (sourceFiles.length === 0) {
        console.log('\n❌ 源目录中没有音频文件');
        return;
    }

    // 2. 读取源文件元数据
    console.log('\n⏳ 读取源文件信息...');
    const sourceTracks = [];
    for (let i = 0; i < sourceFiles.length; i++) {
        const meta = await getMetadata(sourceFiles[i]);
        sourceTracks.push(meta);
        process.stdout.write(`\r   进度: ${i + 1}/${sourceFiles.length}`);
    }
    console.log('\n');

    // 3. 构建音乐库索引
    console.log('⏳ 扫描音乐库 (首次可能较慢)...');
    const libraryIndex = await buildLibraryIndex(args.library, (current, total) => {
        process.stdout.write(`\r   进度: ${current}/${total}`);
    });
    console.log(`\n   索引完成: ${libraryIndex.size} 个标题\n`);

    // 4. 匹配
    console.log('⏳ 匹配歌曲...');
    const results = {
        exact: [],
        standard: [],
        fuzzy: [],
        notFound: []
    };

    const matchedTracks = [];

    for (const source of sourceTracks) {
        const match = findMatch(source, libraryIndex);

        if (match) {
            matchedTracks.push(match);

            switch (match.matchType) {
                case MATCH_TYPE.EXACT:
                    results.exact.push({ source, match });
                    break;
                case MATCH_TYPE.STANDARD:
                    results.standard.push({ source, match });
                    break;
                case MATCH_TYPE.FUZZY:
                    results.fuzzy.push({ source, match });
                    break;
            }
        } else {
            results.notFound.push(source);
        }
    }

    // 5. 输出报告
    console.log('\n' + '═'.repeat(60));
    console.log('📊 匹配结果');
    console.log('═'.repeat(60));
    console.log(`   ✓ 精确匹配: ${results.exact.length} 首`);
    console.log(`   ✓ 标准匹配: ${results.standard.length} 首`);
    console.log(`   ✓ 模糊匹配: ${results.fuzzy.length} 首`);
    console.log(`   ✗ 未匹配:   ${results.notFound.length} 首`);

    // 显示模糊匹配详情
    if (results.fuzzy.length > 0) {
        console.log('\n📋 模糊匹配详情:');
        results.fuzzy.slice(0, 10).forEach(({ source, match }) => {
            console.log(`   "${source.title}" → "${match.title}" (${(match.similarity * 100).toFixed(0)}%)`);
        });
        if (results.fuzzy.length > 10) {
            console.log(`   ... 还有 ${results.fuzzy.length - 10} 首`);
        }
    }

    // 显示未匹配
    if (results.notFound.length > 0) {
        console.log('\n📋 未匹配歌曲:');
        results.notFound.slice(0, 10).forEach(source => {
            console.log(`   - ${source.title}${source.artist ? ` (${source.artist})` : ''}`);
        });
        if (results.notFound.length > 10) {
            console.log(`   ... 还有 ${results.notFound.length - 10} 首`);
        }
    }

    console.log('\n' + '═'.repeat(60));
    console.log(`📊 总计: ${matchedTracks.length}/${sourceTracks.length} 首匹配成功`);
    console.log('═'.repeat(60));

    // 6. 生成播放列表
    if (matchedTracks.length === 0) {
        console.log('\n❌ 没有匹配到任何歌曲，无法生成播放列表');
        return;
    }

    if (args.dryRun) {
        console.log('\n🔍 [预览模式] 未生成文件');
        return;
    }

    const outputDir = args.output || path.join(args.library, 'playlists');
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    const m3uContent = generateM3U(args.name, matchedTracks, args.library);
    const outputPath = path.join(outputDir, `${args.name}.m3u`);

    fs.writeFileSync(outputPath, m3uContent, 'utf-8');

    console.log(`\n✅ 播放列表已生成!`);
    console.log(`   📁 文件: ${outputPath}`);
    console.log(`   🎵 歌曲: ${matchedTracks.length} 首`);
}

main().catch(e => {
    console.error('❌ 错误:', e.message);
    process.exit(1);
});
