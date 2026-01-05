/**
 * 脚本名称: Download Lyrics (歌词下载工具)
 * 功能描述: 扫描目录，为缺少歌词的音频文件自动下载 .lrc 歌词
 * 数据源:
 *    - QQ音乐（优先，中文歌曲最准）
 *    - 网易云音乐
 * 特点:
 *    - 支持多种格式: MP3/FLAC/M4A/WAV/OGG/AAC/DFF/DSF
 *    - 智能解析文件名（支持多种命名格式）
 *    - 只下载缺失的，不覆盖已有歌词
 *    - 交互式确认，检查后直接执行
 * 使用方法:
 *    node download_lyrics.js [目标目录] [选项]
 * 选项:
 *    --apply      直接执行模式（跳过确认）
 *    --overwrite  覆盖已有的 .lrc 文件
 *    --limit N    只处理前 N 个文件
 *    -y           自动确认执行
 * 示例:
 *    node download_lyrics.js "/path/to/music"              # 检查并询问
 *    node download_lyrics.js "/path/to/music" --apply      # 直接执行
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
 * 检查音频文件是否有对应的 .lrc 文件
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

    // 去掉常见后缀标记
    const suffixPatterns = [
        /\s*[\(\[【（]?(live|现场|演唱会|伴奏|纯音乐|remix|cover|翻唱|原唱|高清|无损|flac|mp3|320k|128k)[\)\]】）]?\s*$/gi,
        /\s*-\s*(live|现场|伴奏)$/gi
    ];
    suffixPatterns.forEach(p => { name = name.replace(p, ''); });

    // 去掉括号内容（feat 除外）
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
                // 默认格式：艺术家 - 歌曲名
                artist = parts[0];
                title = parts.slice(1).join(' ');
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
 * HTTP GET 请求
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
 * 延时函数
 */
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ---------------------------------------------------------
// 3. 歌词 API
// ---------------------------------------------------------

/**
 * QQ音乐搜索歌曲
 */
async function searchQQMusic(title, artist = null) {
    try {
        let searchTerm = title;
        if (artist) {
            searchTerm = `${artist} ${title}`;
        }

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
            songmid: s.songmid
        }));
    } catch (e) {
        return [];
    }
}

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
            // QQ音乐歌词是 base64 编码的
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
 * 网易云搜索歌曲
 */
async function searchNetease(title, artist = null) {
    try {
        let searchTerm = title;
        if (artist) {
            searchTerm = `${artist} ${title}`;
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
            songId: s.id
        }));
    } catch (e) {
        return [];
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
 * 标准化字符串用于比较
 */
function normalize(s) {
    return s?.toLowerCase().replace(/[^\w\u4e00-\u9fa5]/g, '') || '';
}

/**
 * 计算匹配分数
 */
function calculateMatchScore(parsed, result) {
    let score = 0;

    const parsedTitle = normalize(parsed.title);
    const parsedArtist = normalize(parsed.artist);
    const resultTitle = normalize(result.title);
    const resultArtist = normalize(result.artist);

    // 标题匹配
    if (parsedTitle && resultTitle) {
        if (parsedTitle === resultTitle) score += 50;
        else if (resultTitle.includes(parsedTitle) || parsedTitle.includes(resultTitle)) score += 30;
    }

    // 艺术家匹配
    if (parsedArtist && resultArtist) {
        if (parsedArtist === resultArtist) score += 40;
        else if (resultArtist.includes(parsedArtist) || parsedArtist.includes(resultArtist)) score += 20;
    }

    return score;
}

/**
 * 搜索歌词（多数据源）
 */
async function searchLyrics(title, artist = null) {
    // 并行搜索
    const [qqResults, neteaseResults] = await Promise.all([
        searchQQMusic(title, artist),
        searchNetease(title, artist)
    ]);

    return [...qqResults, ...neteaseResults];
}

/**
 * 获取歌词内容
 */
async function getLyrics(song) {
    if (song.source === 'QQ音乐' && song.songmid) {
        return await getQQLyrics(song.songmid);
    } else if (song.source === '网易云' && song.songId) {
        return await getNeteaseLyrics(song.songId);
    }
    return null;
}

/**
 * 验证歌词有效性
 */
function isValidLyric(lyric) {
    if (!lyric) return false;
    // 检查是否有时间标签
    if (!lyric.includes('[')) return false;
    // 检查是否是纯音乐
    if (lyric.includes('纯音乐') && lyric.length < 100) return false;
    if (lyric.includes('此歌曲为没有填词的纯音乐')) return false;
    // 检查内容长度
    const lines = lyric.split('\n').filter(l => l.match(/\[\d+:\d+/));
    return lines.length >= 3;
}

/**
 * 清理歌词格式
 */
function cleanLyric(lyric) {
    if (!lyric) return null;

    // 解码 HTML 实体
    lyric = lyric
        .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(code))
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'");

    // 去掉多余的空行
    lyric = lyric.replace(/\n{3,}/g, '\n\n');

    return lyric.trim();
}

// ---------------------------------------------------------
// 4. 主逻辑
// ---------------------------------------------------------

async function run() {
    console.log(`\n🎵 歌词下载工具`);
    console.log(`📂 扫描目录: ${targetDir}`);
    if (overwrite) console.log(`⚠️  覆盖模式: 将覆盖已有 .lrc 文件`);
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

    // 筛选缺少歌词的文件
    console.log('\n⏳ 正在检查歌词文件...');
    const needLyrics = [];

    for (const file of audioFiles) {
        const hasLrc = hasLrcFile(file);
        if (!hasLrc || overwrite) {
            needLyrics.push({
                file,
                hasExisting: hasLrc,
                parsed: parseFileName(file)
            });
        }
    }

    if (needLyrics.length === 0) {
        console.log('\n✨ 所有音频文件都已有歌词');
        return;
    }

    console.log(`   发现 ${needLyrics.length} 个文件需要下载歌词`);

    // 搜索歌词
    console.log('\n⏳ 正在搜索歌词...');
    const plans = [];
    let searchCount = 0;

    for (const item of needLyrics) {
        const { file, parsed } = item;

        if (!parsed.title) {
            searchCount++;
            continue;
        }

        // 搜索歌曲
        const results = await searchLyrics(parsed.title, parsed.artist);

        if (results.length > 0) {
            // 计算匹配分数，选最佳
            let bestMatch = results[0];
            let bestScore = calculateMatchScore(parsed, results[0]);

            for (let i = 1; i < results.length; i++) {
                const score = calculateMatchScore(parsed, results[i]);
                if (score > bestScore || (score === bestScore && results[i].source === 'QQ音乐')) {
                    bestScore = score;
                    bestMatch = results[i];
                }
            }

            // 只有分数足够才尝试获取歌词
            if (bestScore >= 20) {
                // 获取歌词内容
                const lyric = await getLyrics(bestMatch);

                if (isValidLyric(lyric)) {
                    plans.push({
                        file,
                        lrcPath: getLrcPath(file),
                        hasExisting: item.hasExisting,
                        lyric: cleanLyric(lyric),
                        matchScore: bestScore,
                        matchSource: bestMatch.source,
                        matchInfo: `${bestMatch.artist} - ${bestMatch.title}`
                    });
                }
            }
        }

        // 延迟避免请求过快
        await delay(150);

        searchCount++;
        if (searchCount % 5 === 0 || searchCount === needLyrics.length) {
            process.stdout.write(`\r   已搜索: ${searchCount}/${needLyrics.length}`);
        }
    }
    console.log('\n');

    if (plans.length === 0) {
        console.log('😕 未能匹配到任何歌词');
        return;
    }

    // ---------------------------------------------------------
    // 输出计划
    // ---------------------------------------------------------
    console.log('═'.repeat(60));
    console.log('📋 下载计划');
    console.log('═'.repeat(60));

    plans.forEach((plan, idx) => {
        const relPath = path.relative(targetDir, plan.file);
        const lrcRelPath = path.relative(targetDir, plan.lrcPath);
        console.log(`\n${idx + 1}. ${relPath}`);
        console.log(`   🔍 匹配: ${plan.matchInfo}`);
        console.log(`   📡 来源: ${plan.matchSource} | 分数: ${plan.matchScore}`);
        console.log(`   📝 保存: ${lrcRelPath}${plan.hasExisting ? ' (覆盖)' : ''}`);

        // 显示歌词预览
        const previewLines = plan.lyric.split('\n').slice(0, 3).join(' | ');
        console.log(`   🎤 预览: ${previewLines.slice(0, 60)}...`);
    });

    // ---------------------------------------------------------
    // 执行或提示
    // ---------------------------------------------------------
    console.log('\n' + '═'.repeat(60));
    console.log(`📊 统计: 将下载 ${plans.length} 个歌词文件`);
    console.log('═'.repeat(60));

    // 询问确认或直接执行
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
    console.log('\n⏳ 正在保存歌词文件...');
    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < plans.length; i++) {
        const plan = plans[i];
        const relPath = path.relative(targetDir, plan.lrcPath);

        process.stdout.write(`\r   保存中: ${i + 1}/${plans.length}`);

        try {
            fs.writeFileSync(plan.lrcPath, plan.lyric, 'utf-8');
            successCount++;
        } catch (e) {
            failCount++;
            console.log(`\n   ❌ 失败: ${relPath} - ${e.message}`);
        }
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
