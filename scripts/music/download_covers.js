/**
 * 脚本名称: Download Covers (封面下载工具)
 * 功能描述: 为音频文件下载同名封面图片，适用于 WAV 等不支持内嵌封面的格式
 * 数据源:
 *    - QQ音乐（优先，封面质量高）
 *    - 网易云音乐
 *    - iTunes
 * 特点:
 *    - 下载同名 .jpg 封面（如 歌曲.wav → 歌曲.jpg）
 *    - 支持多种格式: MP3/FLAC/M4A/WAV/OGG/AAC/DFF/DSF
 *    - 智能解析文件名匹配歌曲
 *    - 不覆盖已有封面
 * 使用方法:
 *    node download_covers.js [目标目录] [选项]
 * 选项:
 *    --apply      直接执行模式（跳过确认）
 *    --overwrite  覆盖已有的封面文件
 *    --limit N    只处理前 N 个文件
 *    -y           自动确认执行
 * 示例:
 *    node download_covers.js "/path/to/music"              # 检查并询问
 *    node download_covers.js "/path/to/music" -y           # 自动确认执行
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const readline = require('readline');

// ---------------------------------------------------------
// 1. 配置
// ---------------------------------------------------------

const AUDIO_EXTENSIONS = /\.(mp3|m4a|flac|wav|ogg|aac|ape|wma|dff|dsf)$/i;
const IMAGE_EXTENSIONS = /\.(jpg|jpeg|png|webp)$/i;

// 解析命令行参数
const args = process.argv.slice(2);
const targetDir = args.find(a => !a.startsWith('--') && !a.startsWith('-')) || process.cwd();
const forceApply = args.includes('--apply');
const overwrite = args.includes('--overwrite');
const autoYes = args.includes('-y');
const limitArg = args.find(a => a.startsWith('--limit'));
const limit = limitArg ? parseInt(args[args.indexOf(limitArg) + 1]) || 0 : 0;

// ---------------------------------------------------------
// 2. 工具函数
// ---------------------------------------------------------

function createRL() {
    return readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });
}

function ask(rl, question) {
    return new Promise(resolve => {
        rl.question(question, answer => resolve(answer.trim().toLowerCase()));
    });
}

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

function hasCoverFile(audioPath) {
    const dir = path.dirname(audioPath);
    const baseName = path.basename(audioPath, path.extname(audioPath));

    // 检查同名封面
    const extensions = ['.jpg', '.jpeg', '.png', '.webp'];
    for (const ext of extensions) {
        if (fs.existsSync(path.join(dir, `${baseName}${ext}`))) {
            return true;
        }
    }
    return false;
}

function getCoverPath(audioPath) {
    const dir = path.dirname(audioPath);
    const baseName = path.basename(audioPath, path.extname(audioPath));
    return path.join(dir, `${baseName}.jpg`);
}

// 已知歌手列表（用于智能识别文件名格式）
const KNOWN_ARTISTS = [
    '周杰伦', '林俊杰', '陈奕迅', '王菲', '邓紫棋', '薛之谦', '李荣浩',
    '张学友', '刘德华', '蔡依林', '五月天', '齐秦', '费玉清', '邓丽君',
    '许嵩', '汪苏泷', '张惠妹', '萧敬腾', '杨丞琳', '潘玮柏', '王力宏',
    '李宗盛', '罗大佑', '周华健', '陶喆', '孙燕姿', '梁静茹', '莫文蔚',
    '那英', '张靓颖', '李健', '毛不易', '华晨宇', '鹿晗', '张杰', '谭咏麟',
    'Beyond', 'S.H.E', 'Taylor Swift', 'Ed Sheeran', 'Adele', 'Coldplay',
    '刀郎', '张宇', '任贤齐', '孟庭苇', '伍佰', '张信哲', '张国荣'
];

function looksLikeArtist(str) {
    if (!str) return false;
    if (KNOWN_ARTISTS.some(a => a.toLowerCase() === str.toLowerCase())) return true;
    return false;
}

function parseFileName(fileName) {
    let name = path.basename(fileName, path.extname(fileName));
    const original = name;

    // 去掉常见前缀
    name = name.replace(/^\d+[\.\-_\s]+/, '');
    name = name.replace(/^\[\d+\]\s*/, '');

    // 去掉常见后缀标记
    const suffixPatterns = [
        /\s*[\(\[【（]?(live|现场|演唱会|伴奏|纯音乐|remix|cover|翻唱|高清|无损|flac|mp3|320k|128k)[\)\]】）]?\s*$/gi,
        /\s*-\s*(live|现场|伴奏)$/gi
    ];
    suffixPatterns.forEach(p => { name = name.replace(p, ''); });

    // 去掉括号内容
    name = name.replace(/\s*[\(\[【（](?!feat|ft)[^\)\]】）]*[\)\]】）]\s*/gi, ' ');
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

                if (looksLikeArtist(last) && !looksLikeArtist(first)) {
                    artist = last;
                    title = parts.slice(0, -1).join(' ');
                } else {
                    artist = first;
                    title = parts.slice(1).join(' ');
                }
                break;
            }
        }
    }

    if (!title) {
        title = name.trim();
    }

    title = title?.replace(/\s+/g, ' ').trim();
    artist = artist?.replace(/\s+/g, ' ').trim();

    return { title, artist, original };
}

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
            if (res.statusCode !== 200) {
                file.close();
                fs.unlink(destPath, () => {});
                return reject(new Error(`HTTP ${res.statusCode}`));
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

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ---------------------------------------------------------
// 3. 搜索 API
// ---------------------------------------------------------

async function searchQQMusic(query, artist = null) {
    try {
        let searchTerm = query;
        if (artist) searchTerm = `${artist} ${query}`;

        const url = `https://c.y.qq.com/soso/fcgi-bin/client_search_cp?w=${encodeURIComponent(searchTerm)}&format=json&n=5`;
        const response = await httpGet(url);

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
            albummid: s.albummid,
            coverUrl: s.albummid ? `https://y.gtimg.cn/music/photo_new/T002R500x500M000${s.albummid}.jpg` : null
        }));
    } catch (e) {
        return [];
    }
}

async function searchNetease(query, artist = null) {
    try {
        let searchTerm = query;
        if (artist) searchTerm = `${artist} ${query}`;

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
            coverUrl: s.album?.picUrl ? `${s.album.picUrl}?param=500y500` : null
        }));
    } catch (e) {
        return [];
    }
}

async function searchItunes(query, artist = null) {
    try {
        let searchTerm = query;
        if (artist) searchTerm = `${artist} ${query}`;

        const url = `https://itunes.apple.com/search?term=${encodeURIComponent(searchTerm)}&media=music&limit=5`;
        const response = await httpGet(url);
        const data = JSON.parse(response);

        if (data.resultCount > 0) {
            return data.results.map(r => ({
                source: 'iTunes',
                title: r.trackName,
                artist: r.artistName,
                album: r.collectionName,
                coverUrl: r.artworkUrl100?.replace('100x100', '600x600')
            }));
        }
        return [];
    } catch (e) {
        return [];
    }
}

async function searchAllSources(query, artist = null) {
    const [qqResults, neteaseResults, itunesResults] = await Promise.all([
        searchQQMusic(query, artist),
        searchNetease(query, artist),
        searchItunes(query, artist)
    ]);

    return [...qqResults, ...neteaseResults, ...itunesResults];
}

// 艺术家别名
const ARTIST_ALIASES = {
    '周杰伦': ['jay chou', 'jaychou'],
    '林俊杰': ['jj lin'],
    '陈奕迅': ['eason chan'],
    '王菲': ['faye wong'],
    '邓紫棋': ['gem', 'g.e.m.'],
    '张学友': ['jacky cheung'],
    '刘德华': ['andy lau'],
    '蔡依林': ['jolin tsai'],
    '五月天': ['mayday'],
    '齐秦': ['chyi chin']
};

function artistMatches(artist1, artist2) {
    if (!artist1 || !artist2) return false;
    const normalize = (s) => s.toLowerCase().replace(/[^\w\u4e00-\u9fa5]/g, '');
    const a1 = normalize(artist1);
    const a2 = normalize(artist2);

    if (a1 === a2) return true;
    if (a1.includes(a2) || a2.includes(a1)) return true;

    for (const [cn, aliases] of Object.entries(ARTIST_ALIASES)) {
        const cnNorm = normalize(cn);
        const isA1Match = a1 === cnNorm || aliases.some(al => normalize(al) === a1);
        const isA2Match = a2 === cnNorm || aliases.some(al => normalize(al) === a2);
        if (isA1Match && isA2Match) return true;
    }

    return false;
}

function calculateMatchScore(parsed, result) {
    let score = 0;
    const normalize = (s) => s?.toLowerCase().replace(/[^\w\u4e00-\u9fa5]/g, '') || '';

    const parsedTitle = normalize(parsed.title);
    const parsedArtist = normalize(parsed.artist);
    const resultTitle = normalize(result.title);
    const resultArtist = normalize(result.artist);

    if (parsedTitle && resultTitle) {
        if (parsedTitle === resultTitle) score += 50;
        else if (resultTitle.includes(parsedTitle) || parsedTitle.includes(resultTitle)) score += 30;
    }

    if (artistMatches(parsed.artist, result.artist)) {
        score += 40;
    } else if (parsedArtist && resultArtist) {
        if (resultArtist.includes(parsedArtist) || parsedArtist.includes(resultArtist)) score += 20;
    }

    if (score >= 40 && score < 50) {
        score += 10;
    }

    return score;
}

// ---------------------------------------------------------
// 4. 主逻辑
// ---------------------------------------------------------

async function run() {
    console.log(`\n🖼️  封面下载工具`);
    console.log(`📂 扫描目录: ${targetDir}`);
    if (overwrite) console.log(`⚠️  覆盖模式: 将覆盖已有封面文件`);
    console.log('─'.repeat(60));

    if (!fs.existsSync(targetDir)) {
        console.error('❌ 目标目录不存在');
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

    // 筛选缺少封面的文件
    console.log('\n⏳ 正在检查封面文件...');
    const needCovers = [];

    for (const file of audioFiles) {
        const hasCover = hasCoverFile(file);
        if (!hasCover || overwrite) {
            needCovers.push({
                file,
                hasExisting: hasCover,
                parsed: parseFileName(file)
            });
        }
    }

    if (needCovers.length === 0) {
        console.log('\n✨ 所有音频文件都已有封面');
        return;
    }

    console.log(`   发现 ${needCovers.length} 个文件需要下载封面`);

    // 搜索封面
    console.log('\n⏳ 正在搜索封面...');
    const plans = [];
    let searchCount = 0;

    for (const item of needCovers) {
        const { file, parsed } = item;

        if (!parsed.title) {
            searchCount++;
            continue;
        }

        const results = await searchAllSources(parsed.title, parsed.artist);

        if (results.length > 0) {
            let bestMatch = results[0];
            let bestScore = calculateMatchScore(parsed, results[0]);

            for (let i = 1; i < results.length; i++) {
                const score = calculateMatchScore(parsed, results[i]);
                if (score > bestScore || (score === bestScore && results[i].source === 'QQ音乐')) {
                    bestScore = score;
                    bestMatch = results[i];
                }
            }

            if (bestScore >= 20 && bestMatch.coverUrl) {
                plans.push({
                    file,
                    coverPath: getCoverPath(file),
                    hasExisting: item.hasExisting,
                    coverUrl: bestMatch.coverUrl,
                    matchScore: bestScore,
                    matchSource: bestMatch.source,
                    matchInfo: `${bestMatch.artist} - ${bestMatch.title}`
                });
            }
        }

        await delay(100);

        searchCount++;
        if (searchCount % 5 === 0 || searchCount === needCovers.length) {
            process.stdout.write(`\r   已搜索: ${searchCount}/${needCovers.length}`);
        }
    }
    console.log('\n');

    if (plans.length === 0) {
        console.log('😕 未能匹配到任何封面');
        return;
    }

    // 输出计划
    console.log('═'.repeat(60));
    console.log('📋 下载计划');
    console.log('═'.repeat(60));

    plans.slice(0, 20).forEach((plan, idx) => {
        const relPath = path.relative(targetDir, plan.file);
        const coverName = path.basename(plan.coverPath);
        console.log(`\n${idx + 1}. ${relPath}`);
        console.log(`   🔍 匹配: ${plan.matchInfo}`);
        console.log(`   📡 来源: ${plan.matchSource} | 分数: ${plan.matchScore}`);
        console.log(`   🖼️  保存: ${coverName}${plan.hasExisting ? ' (覆盖)' : ''}`);
    });

    if (plans.length > 20) {
        console.log(`\n   ... 还有 ${plans.length - 20} 个文件`);
    }

    // 询问确认或直接执行
    console.log('\n' + '═'.repeat(60));
    console.log(`📊 统计: 将下载 ${plans.length} 个封面文件`);
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

    // 执行下载
    console.log('\n⏳ 正在下载封面...');
    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < plans.length; i++) {
        const plan = plans[i];
        const coverName = path.basename(plan.coverPath);

        process.stdout.write(`\r   下载中: ${i + 1}/${plans.length}`);

        try {
            await downloadFile(plan.coverUrl, plan.coverPath);

            // 验证文件大小（太小可能是错误页面）
            const stats = fs.statSync(plan.coverPath);
            if (stats.size < 1000) {
                fs.unlinkSync(plan.coverPath);
                throw new Error('文件太小');
            }

            successCount++;
        } catch (e) {
            failCount++;
        }

        await delay(50);
    }

    console.log('\n\n' + '═'.repeat(60));
    console.log('✅ 下载完成!');
    console.log('═'.repeat(60));
    console.log(`   成功: ${successCount} 个文件`);
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
