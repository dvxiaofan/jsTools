/**
 * 脚本名称: Fix Audio Tags (音频标签补全)
 * 功能描述: 扫描目录，检测缺少标签的音频文件，从多个数据源获取信息自动补全
 * 数据源:
 *    - QQ音乐（优先，中文歌曲最准）
 *    - 网易云音乐
 *    - iTunes（国际歌曲备选）
 * 特点:
 *    - 支持多种格式: MP3/FLAC/M4A/WAV/OGG/AAC
 *    - 智能解析文件名（支持多种命名格式）
 *    - 只补缺的，不覆盖已有标签
 *    - 自动识别占位符标签（如 "track", "album"）
 *    - 交互式确认，检查后直接执行
 * 使用方法:
 *    node fix_audio_tags.js [目标目录] [选项]
 * 选项:
 *    --apply      直接执行模式（跳过确认）
 *    --no-cover   不补全封面
 *    --with-lrc   同时下载 .lrc 歌词文件
 *    --limit N    只处理前 N 个文件
 *    -y           自动确认执行
 * 示例:
 *    node fix_audio_tags.js "/path/to/music"              # 检查并询问
 *    node fix_audio_tags.js "/path/to/music" --apply      # 直接执行
 *    node fix_audio_tags.js "/path/to/music" --with-lrc   # 同时下载歌词
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const readline = require('readline');
const { execSync, spawnSync } = require('child_process');
const mm = require('music-metadata');

// ---------------------------------------------------------
// 1. 配置
// ---------------------------------------------------------

const AUDIO_EXTENSIONS = /\.(mp3|m4a|flac|wav|ogg|aac|ape|wma|dff|dsf)$/i;

// 解析命令行参数
const args = process.argv.slice(2);
const targetDir = args.find(a => !a.startsWith('--') && !a.startsWith('-')) || process.cwd();
const forceApply = args.includes('--apply');
const skipCover = args.includes('--no-cover');
const withLrc = args.includes('--with-lrc');
const autoYes = args.includes('-y');
const limitArg = args.find(a => a.startsWith('--limit'));
const limit = limitArg ? parseInt(args[args.indexOf(limitArg) + 1]) || 0 : 0;

// ---------------------------------------------------------
// 2. 工具函数
// ---------------------------------------------------------

/**
 * 创建 readline 接口
 */
function createRL() {
    return readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });
}

/**
 * 异步询问用户
 */
function ask(rl, question) {
    return new Promise(resolve => {
        rl.question(question, answer => resolve(answer.trim().toLowerCase()));
    });
}

/**
 * 递归查找目录下的所有音频文件
 */
function findAudioFiles(dir) {
    let results = [];
    try {
        if (!fs.existsSync(dir)) return [];
        const list = fs.readdirSync(dir);

        list.forEach(file => {
            if (file.startsWith('.')) return;
            const fullPath = path.join(dir, file);
            try {
                const stat = fs.statSync(fullPath);
                if (stat.isDirectory()) {
                    if (file.startsWith('_')) return;
                    results = results.concat(findAudioFiles(fullPath));
                } else if (AUDIO_EXTENSIONS.test(file)) {
                    results.push(fullPath);
                }
            } catch (e) {}
        });
    } catch (e) {}
    return results;
}

/**
 * 检查标签值是否是无效的占位符
 */
function isPlaceholder(value) {
    if (!value) return true;
    const placeholders = [
        'track', 'title', 'album', 'artist', 'unknown', 'untitled',
        '未知', '无', '无标题', '无专辑', '未知艺术家',
        'test', 'temp', 'demo'
    ];
    const normalized = value.toLowerCase().trim();
    return placeholders.includes(normalized) || normalized.length <= 1;
}

/**
 * 解析音频文件的现有标签
 */
async function parseExistingTags(filePath) {
    try {
        const metadata = await mm.parseFile(filePath, { duration: false });
        const common = metadata.common;

        // 过滤掉占位符标签
        const title = isPlaceholder(common.title) ? null : common.title;
        const artist = isPlaceholder(common.artist) ? null : common.artist;
        const album = isPlaceholder(common.album) ? null : common.album;

        return {
            title,
            artist,
            album,
            year: common.year || null,
            hasCover: !!(common.picture && common.picture.length > 0),
            genre: common.genre?.[0] || null,
            trackNumber: common.track?.no || null
        };
    } catch (e) {
        return { error: e.message };
    }
}

/**
 * 检查是否有同名 .lrc 文件
 */
function hasLrcFile(audioPath) {
    const dir = path.dirname(audioPath);
    const baseName = path.basename(audioPath, path.extname(audioPath));
    const lrcPath = path.join(dir, `${baseName}.lrc`);
    return fs.existsSync(lrcPath);
}

/**
 * 获取 .lrc 文件路径
 */
function getLrcPath(audioPath) {
    const dir = path.dirname(audioPath);
    const baseName = path.basename(audioPath, path.extname(audioPath));
    return path.join(dir, `${baseName}.lrc`);
}

/**
 * 判断是否像艺术家名（用于识别文件名格式）
 */
function looksLikeArtist(str) {
    if (!str) return false;
    // 优先检查常见歌手名（精确匹配）
    const knownArtists = [
        '周杰伦', '林俊杰', '陈奕迅', '王菲', '邓紫棋', '薛之谦', '李荣浩',
        '张学友', '刘德华', '蔡依林', '五月天', '齐秦', '费玉清', '邓丽君',
        '许嵩', '汪苏泷', '张惠妹', '萧敬腾', '杨丞琳', '潘玮柏', '王力宏',
        '李宗盛', '罗大佑', '周华健', '陶喆', '孙燕姿', '梁静茹', '莫文蔚',
        '那英', '张靓颖', '李健', '毛不易', '华晨宇', '鹿晗', '张杰', '谭咏麟',
        'Beyond', 'Taylor Swift', 'Ed Sheeran', 'Adele', 'Bruno Mars', 'Coldplay', 'Maroon 5'
    ];
    if (knownArtists.some(a => a.toLowerCase() === str.toLowerCase())) return true;
    // 不再用字符数量判断，避免误判歌曲名
    return false;
}

/**
 * 智能解析文件名，提取歌曲名和艺术家
 */
function parseFileName(fileName) {
    // 去掉扩展名
    let name = path.basename(fileName, path.extname(fileName));

    // 保存原始名称
    const original = name;

    // 去掉常见前缀（数字编号）
    name = name.replace(/^\d+[\.\-_\s]+/, '');
    name = name.replace(/^\[\d+\]\s*/, '');

    // 先提取括号内容（可能包含 feat. 信息）
    const featMatch = name.match(/[\(\[【（](feat\.?|ft\.?)[^\)\]】）]*[\)\]】）]/i);

    // 去掉常见后缀标记（但保留 feat）
    const suffixPatterns = [
        /\s*[\(\[【（]?(live|现场|演唱会|伴奏|纯音乐|remix|cover|翻唱|原唱|高清|无损|flac|mp3|320k|128k)[\)\]】）]?\s*$/gi,
        /\s*-\s*(live|现场|伴奏)$/gi
    ];
    suffixPatterns.forEach(p => { name = name.replace(p, ''); });

    // 去掉括号内容（feat 除外）
    if (!name.match(/^[\(\[【（].*[\)\]】）]$/)) {
        name = name.replace(/\s*[\(\[【（](?!feat|ft)[^\)\]】）]*[\)\]】）]\s*/gi, ' ');
    }
    // 再去掉 feat 括号
    name = name.replace(/\s*[\(\[【（](feat\.?|ft\.?)[^\)\]】）]*[\)\]】）]\s*/gi, ' ');

    // 尝试各种分隔符拆分
    const separators = [' - ', ' – ', ' — ', '-', '_'];
    let artist = null;
    let title = null;

    for (const sep of separators) {
        if (name.includes(sep)) {
            const parts = name.split(sep).map(s => s.trim()).filter(s => s);
            if (parts.length >= 2) {
                const first = parts[0];
                const last = parts[parts.length - 1];

                // 智能判断格式：
                // 如果最后一部分像艺术家名，则是「歌曲名-艺术家」格式
                // 否则是「艺术家-歌曲名」格式
                if (looksLikeArtist(last) && !looksLikeArtist(first)) {
                    // 格式：歌曲名 - 艺术家
                    artist = last;
                    title = parts.slice(0, -1).join(' ');
                } else {
                    // 格式：艺术家 - 歌曲名
                    artist = first;
                    title = parts.slice(1).join(' ');
                }
                break;
            }
        }
    }

    // 如果没有分隔符，整个作为歌曲名
    if (!title) {
        title = name.trim();
    }

    // 清理多余空格
    title = title?.replace(/\s+/g, ' ').trim();
    artist = artist?.replace(/\s+/g, ' ').trim();

    return { title, artist, original };
}

/**
 * HTTP GET 请求（支持自定义 headers）
 */
function httpGet(url, headers = {}) {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        const client = urlObj.protocol === 'https:' ? https : http;

        const options = {
            hostname: urlObj.hostname,
            port: urlObj.port,
            path: urlObj.pathname + urlObj.search,
            method: 'GET',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
                ...headers
            }
        };

        const req = client.request(options, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                // 跟随重定向
                return httpGet(res.headers.location, headers).then(resolve).catch(reject);
            }
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve(data));
            res.on('error', reject);
        });

        req.on('error', reject);
        req.end();
    });
}

/**
 * 下载文件到本地
 */
function downloadFile(url, destPath) {
    return new Promise((resolve, reject) => {
        const client = url.startsWith('https') ? https : http;
        const file = fs.createWriteStream(destPath);
        client.get(url, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                file.close();
                fs.unlinkSync(destPath);
                return downloadFile(res.headers.location, destPath).then(resolve).catch(reject);
            }
            res.pipe(file);
            file.on('finish', () => {
                file.close();
                resolve(destPath);
            });
        }).on('error', (err) => {
            fs.unlink(destPath, () => {});
            reject(err);
        });
    });
}

/**
 * 搜索 QQ音乐 API（优先，中文歌曲最准）
 */
async function searchQQMusic(query, artist = null) {
    try {
        let searchTerm = query;
        if (artist) {
            searchTerm = `${artist} ${query}`;
        }

        const url = `https://c.y.qq.com/soso/fcgi-bin/client_search_cp?w=${encodeURIComponent(searchTerm)}&format=json&n=5`;
        const response = await httpGet(url);

        // QQ音乐可能返回 callback(json) 格式
        let data;
        if (response.startsWith('callback')) {
            data = JSON.parse(response.slice(9, -1));
        } else {
            data = JSON.parse(response);
        }

        const songs = data?.data?.song?.list || [];
        return songs.map(s => ({
            source: 'QQ音乐',
            title: s.songname,
            artist: s.singer?.map(x => x.name).join('/') || '',
            album: s.albumname || '',
            year: null, // QQ音乐搜索结果不含年份
            genre: null,
            songmid: s.songmid,
            albummid: s.albummid,
            // QQ音乐封面 URL
            coverUrl: s.albummid ? `https://y.gtimg.cn/music/photo_new/T002R500x500M000${s.albummid}.jpg` : null
        }));
    } catch (e) {
        return [];
    }
}

/**
 * 搜索网易云音乐 API
 */
async function searchNetease(query, artist = null) {
    try {
        let searchTerm = query;
        if (artist) {
            searchTerm = `${artist} ${query}`;
        }

        const url = `https://music.163.com/api/search/get?s=${encodeURIComponent(searchTerm)}&type=1&limit=5`;
        const response = await httpGet(url, { 'Referer': 'https://music.163.com' });
        const data = JSON.parse(response);

        if (data.code !== 200) return [];

        const songs = data?.result?.songs || [];
        return songs.map(s => ({
            source: '网易云',
            title: s.name,
            artist: s.artists?.map(a => a.name).join('/') || '',
            album: s.album?.name || '',
            year: null,
            genre: null,
            songId: s.id,
            albumId: s.album?.id,
            // 网易云封面需要额外请求，暂用专辑图
            coverUrl: s.album?.picUrl ? `${s.album.picUrl}?param=500y500` : null
        }));
    } catch (e) {
        return [];
    }
}

/**
 * 搜索 iTunes API（国际歌曲备选）
 */
async function searchItunes(query, artist = null) {
    try {
        let searchTerm = query;
        if (artist) {
            searchTerm = `${artist} ${query}`;
        }

        const url = `https://itunes.apple.com/search?term=${encodeURIComponent(searchTerm)}&media=music&limit=5`;
        const response = await httpGet(url);
        const data = JSON.parse(response);

        if (data.resultCount > 0) {
            return data.results.map(r => ({
                source: 'iTunes',
                title: r.trackName,
                artist: r.artistName,
                album: r.collectionName,
                year: r.releaseDate ? new Date(r.releaseDate).getFullYear() : null,
                genre: r.primaryGenreName,
                trackNumber: r.trackNumber,
                coverUrl: r.artworkUrl100?.replace('100x100', '600x600'),
                previewUrl: r.previewUrl
            }));
        }
        return [];
    } catch (e) {
        return [];
    }
}

/**
 * 多数据源搜索（智能合并结果）
 */
async function searchAllSources(query, artist = null) {
    // 并行搜索所有数据源
    const [qqResults, neteaseResults, itunesResults] = await Promise.all([
        searchQQMusic(query, artist),
        searchNetease(query, artist),
        searchItunes(query, artist)
    ]);

    // 合并结果，QQ音乐优先
    const allResults = [
        ...qqResults,
        ...neteaseResults,
        ...itunesResults
    ];

    return allResults;
}

/**
 * 艺术家中英文名映射
 */
const ARTIST_ALIASES = {
    '周杰伦': ['jay chou', 'jaychou'],
    '林俊杰': ['jj lin', 'lin junjie'],
    '陈奕迅': ['eason chan'],
    '王菲': ['faye wong'],
    '邓紫棋': ['gem', 'g.e.m.'],
    '张学友': ['jacky cheung'],
    '刘德华': ['andy lau'],
    '蔡依林': ['jolin tsai'],
    '五月天': ['mayday'],
    '齐秦': ['chyi chin'],
    '李宗盛': ['jonathan lee'],
    '罗大佑': ['lo ta-yu'],
    '许嵩': ['vae'],
    '汪苏泷': ['silence wang'],
    '薛之谦': ['joker xue'],
    '李荣浩': ['li ronghao'],
    '张惠妹': ['a-mei', 'chang hui-mei'],
    '萧敬腾': ['jam hsiao'],
    '杨丞琳': ['rainie yang'],
    '潘玮柏': ['wilber pan'],
    '王力宏': ['leehom wang', 'wang leehom']
};

/**
 * 检查艺术家是否匹配（支持中英文别名）
 */
function artistMatches(artist1, artist2) {
    if (!artist1 || !artist2) return false;
    const normalize = (s) => s.toLowerCase().replace(/[^\w\u4e00-\u9fa5]/g, '');
    const a1 = normalize(artist1);
    const a2 = normalize(artist2);

    // 直接匹配
    if (a1 === a2) return true;
    if (a1.includes(a2) || a2.includes(a1)) return true;

    // 别名匹配
    for (const [cn, aliases] of Object.entries(ARTIST_ALIASES)) {
        const cnNorm = normalize(cn);
        const isA1Match = a1 === cnNorm || aliases.some(al => normalize(al) === a1);
        const isA2Match = a2 === cnNorm || aliases.some(al => normalize(al) === a2);
        if (isA1Match && isA2Match) return true;
    }

    return false;
}

/**
 * 计算匹配分数
 */
function calculateMatchScore(parsed, result) {
    let score = 0;

    const normalize = (s) => s?.toLowerCase().replace(/[^\w\u4e00-\u9fa5]/g, '') || '';

    const parsedTitle = normalize(parsed.title);
    const parsedArtist = normalize(parsed.artist);
    const resultTitle = normalize(result.title);
    const resultArtist = normalize(result.artist);

    // 标题匹配
    if (parsedTitle && resultTitle) {
        if (parsedTitle === resultTitle) score += 50;
        else if (resultTitle.includes(parsedTitle) || parsedTitle.includes(resultTitle)) score += 30;
    }

    // 艺术家匹配（支持中英文别名）
    if (artistMatches(parsed.artist, result.artist)) {
        score += 40;
    } else if (parsedArtist && resultArtist) {
        if (resultArtist.includes(parsedArtist) || parsedArtist.includes(resultArtist)) score += 20;
    }

    // 如果艺术家匹配了，给一个基础分（允许即使标题不匹配也能采用）
    if (score >= 40 && score < 50) {
        score += 10; // 至少达到阈值
    }

    return score;
}

/**
 * 使用 ffmpeg 写入标签
 */
function writeTagsWithFFmpeg(filePath, tags, coverPath = null) {
    const ext = path.extname(filePath).toLowerCase();
    const dir = path.dirname(filePath);
    const baseName = path.basename(filePath, ext);
    const tempFile = path.join(dir, `_temp_${Date.now()}${ext}`);

    try {
        const args = ['-i', filePath];

        // 如果有封面，添加封面输入
        if (coverPath && fs.existsSync(coverPath)) {
            args.push('-i', coverPath);
        }

        // 元数据参数
        const metaArgs = [];
        if (tags.title) metaArgs.push('-metadata', `title=${tags.title}`);
        if (tags.artist) metaArgs.push('-metadata', `artist=${tags.artist}`);
        if (tags.album) metaArgs.push('-metadata', `album=${tags.album}`);
        if (tags.year) metaArgs.push('-metadata', `date=${tags.year}`);
        if (tags.genre) metaArgs.push('-metadata', `genre=${tags.genre}`);
        if (tags.trackNumber) metaArgs.push('-metadata', `track=${tags.trackNumber}`);

        // 构建完整命令
        if (coverPath && fs.existsSync(coverPath)) {
            // 有封面：映射音频和封面
            args.push(
                '-map', '0:a',
                '-map', '1:v',
                '-c:a', 'copy',
                '-c:v', 'mjpeg',
                '-disposition:v', 'attached_pic',
                ...metaArgs,
                '-y',
                tempFile
            );
        } else {
            // 无封面：只复制
            args.push(
                '-c', 'copy',
                ...metaArgs,
                '-y',
                tempFile
            );
        }

        const result = spawnSync('ffmpeg', args, {
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'pipe']
        });

        if (result.status === 0 && fs.existsSync(tempFile)) {
            // 替换原文件
            fs.unlinkSync(filePath);
            fs.renameSync(tempFile, filePath);
            return { success: true };
        } else {
            if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
            return { success: false, error: result.stderr };
        }
    } catch (e) {
        if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
        return { success: false, error: e.message };
    }
}

// ---------------------------------------------------------
// 3. 歌词相关函数
// ---------------------------------------------------------

/**
 * QQ音乐获取歌词
 */
async function getQQLyrics(songmid) {
    try {
        const url = `https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg?songmid=${songmid}&format=json&nobase64=1`;
        const response = await httpGet(url, {
            'Referer': 'https://y.qq.com/'
        });

        let data;
        if (response.startsWith('MusicJsonCallback')) {
            const jsonStr = response.replace(/^MusicJsonCallback\(/, '').replace(/\)$/, '');
            data = JSON.parse(jsonStr);
        } else {
            data = JSON.parse(response);
        }

        if (data.lyric) {
            let lyric = data.lyric;
            if (!lyric.startsWith('[')) {
                try {
                    lyric = Buffer.from(lyric, 'base64').toString('utf-8');
                } catch (e) {}
            }
            return lyric;
        }
        return null;
    } catch (e) {
        return null;
    }
}

/**
 * 网易云获取歌词
 */
async function getNeteaseLyrics(songId) {
    try {
        const url = `https://music.163.com/api/song/lyric?id=${songId}&lv=1&tv=1`;
        const response = await httpGet(url, { 'Referer': 'https://music.163.com' });
        const data = JSON.parse(response);

        if (data.lrc && data.lrc.lyric) {
            return data.lrc.lyric;
        }
        return null;
    } catch (e) {
        return null;
    }
}

/**
 * 验证歌词有效性
 */
function isValidLyric(lyric) {
    if (!lyric) return false;
    if (!lyric.includes('[')) return false;
    if (lyric.includes('纯音乐') && lyric.length < 100) return false;
    if (lyric.includes('此歌曲为没有填词的纯音乐')) return false;
    const lines = lyric.split('\n').filter(l => l.match(/\[\d+:\d+/));
    return lines.length >= 3;
}

/**
 * 清理歌词格式
 */
function cleanLyric(lyric) {
    if (!lyric) return null;
    lyric = lyric
        .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(code))
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'");
    lyric = lyric.replace(/\n{3,}/g, '\n\n');
    return lyric.trim();
}

// ---------------------------------------------------------
// 4. 主逻辑
// ---------------------------------------------------------

async function run() {
    console.log(`\n🔧 音频标签补全工具`);
    console.log(`📂 扫描目录: ${targetDir}`);
    if (withLrc) console.log(`📝 同时下载: .lrc 歌词文件`);
    console.log('─'.repeat(60));

    if (!fs.existsSync(targetDir)) {
        console.error('❌ 目标目录不存在');
        process.exit(1);
    }

    // 检查 ffmpeg
    try {
        execSync('which ffmpeg', { stdio: 'pipe' });
    } catch {
        console.error('❌ 未安装 ffmpeg，请先执行: brew install ffmpeg');
        process.exit(1);
    }

    // 扫描音频文件
    console.log('\n⏳ 正在扫描音频文件...');
    let audioFiles = findAudioFiles(targetDir);

    if (limit > 0) {
        audioFiles = audioFiles.slice(0, limit);
        console.log(`   限制处理前 ${limit} 个文件`);
    }

    if (audioFiles.length === 0) {
        console.log('\n✨ 未找到音频文件');
        return;
    }

    console.log(`   发现 ${audioFiles.length} 个音频文件`);

    // 分析每个文件
    console.log('\n⏳ 正在分析标签...');
    const tasks = [];
    let processed = 0;

    for (const file of audioFiles) {
        const existing = await parseExistingTags(file);

        if (existing.error) {
            processed++;
            continue;
        }

        // 检查缺失的标签
        const missing = {
            title: !existing.title,
            artist: !existing.artist,
            album: !existing.album,
            cover: !existing.hasCover && !skipCover,
            lrc: withLrc && !hasLrcFile(file)
        };

        const hasMissing = missing.title || missing.artist || missing.album || missing.cover || missing.lrc;

        if (hasMissing) {
            const parsed = parseFileName(file);
            tasks.push({
                file,
                existing,
                missing,
                parsed
            });
        }

        processed++;
        if (processed % 20 === 0 || processed === audioFiles.length) {
            process.stdout.write(`\r   已分析: ${processed}/${audioFiles.length}`);
        }
    }
    console.log('\n');

    if (tasks.length === 0) {
        console.log('✨ 所有文件标签完整，无需补全');
        return;
    }

    console.log(`📋 发现 ${tasks.length} 个文件需要处理`);
    console.log('\n⏳ 正在搜索歌曲信息...');

    // 搜索并匹配
    const plans = [];
    let searchCount = 0;

    for (const task of tasks) {
        const { file, existing, missing, parsed } = task;

        // 使用现有标签或解析的名称搜索
        const searchTitle = existing.title || parsed.title;
        const searchArtist = existing.artist || parsed.artist;

        if (!searchTitle) {
            searchCount++;
            continue;
        }

        // 多数据源搜索
        const results = await searchAllSources(searchTitle, searchArtist);

        // 延迟避免请求过快
        await new Promise(r => setTimeout(r, 100));

        if (results.length > 0) {
            // 计算匹配分数，选最佳
            let bestMatch = results[0];
            let bestScore = calculateMatchScore(parsed, results[0]);

            for (let i = 1; i < results.length; i++) {
                const score = calculateMatchScore(parsed, results[i]);
                // 同分时优先选中文结果
                if (score > bestScore || (score === bestScore && results[i].source === 'QQ音乐')) {
                    bestScore = score;
                    bestMatch = results[i];
                }
            }

            // 只有分数足够才采用
            if (bestScore >= 20) {
                // 构建补全计划（只补缺的）
                const updates = {};
                if (missing.title && bestMatch.title) updates.title = bestMatch.title;
                if (missing.artist && bestMatch.artist) updates.artist = bestMatch.artist;
                if (missing.album && bestMatch.album) updates.album = bestMatch.album;
                if (!existing.year && bestMatch.year) updates.year = bestMatch.year;
                if (!existing.genre && bestMatch.genre) updates.genre = bestMatch.genre;

                const plan = {
                    file,
                    existing,
                    missing,
                    updates,
                    coverUrl: missing.cover ? bestMatch.coverUrl : null,
                    matchScore: bestScore,
                    matchSource: bestMatch.source,
                    matchInfo: `${bestMatch.artist} - ${bestMatch.title}`,
                    bestMatch
                };

                // 如果需要下载歌词
                if (missing.lrc) {
                    plan.needLrc = true;
                    plan.lrcPath = getLrcPath(file);
                }

                plans.push(plan);
            }
        }

        searchCount++;
        if (searchCount % 5 === 0 || searchCount === tasks.length) {
            process.stdout.write(`\r   已搜索: ${searchCount}/${tasks.length}`);
        }
    }
    console.log('\n');

    if (plans.length === 0) {
        console.log('😕 未能匹配到任何歌曲信息');
        return;
    }

    // ---------------------------------------------------------
    // 输出补全计划
    // ---------------------------------------------------------
    console.log('═'.repeat(60));
    console.log('📋 补全计划');
    console.log('═'.repeat(60));

    plans.forEach((plan, idx) => {
        const relPath = path.relative(targetDir, plan.file);
        console.log(`\n${idx + 1}. ${relPath}`);
        console.log(`   🔍 匹配: ${plan.matchInfo}`);
        console.log(`   📡 来源: ${plan.matchSource} | 分数: ${plan.matchScore}`);

        const updates = [];
        if (plan.updates.title) updates.push(`标题: "${plan.updates.title}"`);
        if (plan.updates.artist) updates.push(`艺术家: "${plan.updates.artist}"`);
        if (plan.updates.album) updates.push(`专辑: "${plan.updates.album}"`);
        if (plan.updates.year) updates.push(`年份: ${plan.updates.year}`);
        if (plan.updates.genre) updates.push(`流派: "${plan.updates.genre}"`);
        if (plan.coverUrl) updates.push(`封面: 将下载`);
        if (plan.needLrc) updates.push(`歌词: 将下载 .lrc`);

        if (updates.length > 0) {
            console.log(`   📝 补全: ${updates.join(', ')}`);
        }
    });

    // ---------------------------------------------------------
    // 询问确认或直接执行
    // ---------------------------------------------------------
    console.log('\n' + '═'.repeat(60));
    console.log(`📊 统计: 将处理 ${plans.length} 个文件`);
    console.log('═'.repeat(60));

    let shouldExecute = forceApply || autoYes;

    if (!shouldExecute) {
        const rl = createRL();
        const answer = await ask(rl, '\n是否执行以上操作? [Y/n]: ');
        rl.close();

        shouldExecute = answer === '' || answer === 'y' || answer === 'yes';

        if (!shouldExecute) {
            console.log('\n❌ 已取消操作');
            return;
        }
    }

    // ---------------------------------------------------------
    // 执行补全
    // ---------------------------------------------------------
    console.log('\n⏳ 正在处理...');
    let successCount = 0;
    let failCount = 0;
    let lrcCount = 0;

    for (let i = 0; i < plans.length; i++) {
        const plan = plans[i];
        const relPath = path.relative(targetDir, plan.file);

        process.stdout.write(`\r   处理中: ${i + 1}/${plans.length} - ${relPath.slice(0, 40)}...`);

        // 下载封面（如果需要）
        let coverPath = null;
        if (plan.coverUrl) {
            try {
                coverPath = path.join(targetDir, `_temp_cover_${Date.now()}.jpg`);
                await downloadFile(plan.coverUrl, coverPath);
            } catch (e) {
                coverPath = null;
            }
        }

        // 写入标签（如果有更新）
        let tagSuccess = true;
        if (Object.keys(plan.updates).length > 0 || coverPath) {
            const result = writeTagsWithFFmpeg(plan.file, plan.updates, coverPath);
            tagSuccess = result.success;
        }

        // 清理临时封面
        if (coverPath && fs.existsSync(coverPath)) {
            fs.unlinkSync(coverPath);
        }

        // 下载歌词（如果需要）
        if (plan.needLrc && plan.bestMatch) {
            try {
                let lyric = null;
                if (plan.bestMatch.source === 'QQ音乐' && plan.bestMatch.songmid) {
                    lyric = await getQQLyrics(plan.bestMatch.songmid);
                } else if (plan.bestMatch.source === '网易云' && plan.bestMatch.songId) {
                    lyric = await getNeteaseLyrics(plan.bestMatch.songId);
                }

                if (isValidLyric(lyric)) {
                    fs.writeFileSync(plan.lrcPath, cleanLyric(lyric), 'utf-8');
                    lrcCount++;
                }
            } catch (e) {}
        }

        if (tagSuccess) {
            successCount++;
        } else {
            failCount++;
            console.log(`\n   ❌ 失败: ${relPath}`);
        }
    }

    console.log('\n\n' + '═'.repeat(60));
    console.log('✅ 处理完成!');
    console.log('═'.repeat(60));
    console.log(`   标签补全: ${successCount} 个文件`);
    if (lrcCount > 0) {
        console.log(`   歌词下载: ${lrcCount} 个文件`);
    }
    if (failCount > 0) {
        console.log(`   失败: ${failCount} 个文件`);
    }
}

// ---------------------------------------------------------
// 执行
// ---------------------------------------------------------
run().catch(err => {
    console.error('❌ 运行出错:', err.message);
    process.exit(1);
});
