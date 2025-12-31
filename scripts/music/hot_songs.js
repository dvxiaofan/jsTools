/**
 * 脚本名称: Hot Songs (热门歌曲查询工具)
 * 功能描述: 整合查询单个歌手热门、批量歌手热门、地区榜单
 *
 * 使用方法:
 *   # 模式1: 查询单个歌手热门
 *   node hot_songs.js --artist "周杰伦" -n 20
 *
 *   # 模式2: 批量查询目录下所有歌手
 *   node hot_songs.js --dir "/Volumes/Music/歌手分类" -n 10
 *
 *   # 模式3: 查询地区热门榜单
 *   node hot_songs.js --chart cn -n 50
 *   node hot_songs.js --chart tw,hk,cn -n 100
 *
 * 参数:
 *   -n, --limit    返回数量 (默认 20)
 *   -o, --output   输出到文件
 *   --json         输出 JSON 格式
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

// ---------------------------------------------------------
// 1. 配置
// ---------------------------------------------------------

const DEFAULT_LIMIT = 20;
const DEFAULT_COUNTRY = 'cn';

// 支持的地区代码
const SUPPORTED_REGIONS = ['cn', 'tw', 'hk', 'sg', 'us', 'jp', 'kr', 'gb'];

// ---------------------------------------------------------
// 2. 工具函数
// ---------------------------------------------------------

/**
 * HTTPS GET 请求
 */
function httpGet(url) {
    return new Promise((resolve, reject) => {
        https.get(url, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve(data));
        }).on('error', reject);
    });
}

/**
 * 延时函数
 */
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 解析命令行参数
 */
function parseArgs() {
    const args = process.argv.slice(2);
    const result = {
        mode: null,
        artist: null,
        dir: null,
        charts: [],
        limit: DEFAULT_LIMIT,
        output: null,
        json: false
    };

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        const next = args[i + 1];

        switch (arg) {
            case '--artist':
            case '-a':
                result.mode = 'artist';
                result.artist = next;
                i++;
                break;
            case '--dir':
            case '-d':
                result.mode = 'dir';
                result.dir = next;
                i++;
                break;
            case '--chart':
            case '-c':
                result.mode = 'chart';
                result.charts = next ? next.split(',').map(s => s.trim().toLowerCase()) : [DEFAULT_COUNTRY];
                i++;
                break;
            case '--limit':
            case '-n':
                result.limit = parseInt(next, 10) || DEFAULT_LIMIT;
                i++;
                break;
            case '--output':
            case '-o':
                result.output = next;
                i++;
                break;
            case '--json':
                result.json = true;
                break;
            case '--help':
            case '-h':
                printHelp();
                process.exit(0);
        }
    }

    return result;
}

/**
 * 打印帮助信息
 */
function printHelp() {
    console.log(`
🎵 热门歌曲查询工具

使用方法:
  node hot_songs.js --artist "歌手名" [-n 数量]
  node hot_songs.js --dir "目录路径" [-n 数量]
  node hot_songs.js --chart 地区代码 [-n 数量]

模式:
  --artist, -a    查询单个歌手热门歌曲
  --dir, -d       批量查询目录下所有歌手
  --chart, -c     查询地区热门榜单 (支持: ${SUPPORTED_REGIONS.join(', ')})

参数:
  -n, --limit     返回数量 (默认 ${DEFAULT_LIMIT})
  -o, --output    输出到文件
  --json          输出 JSON 格式
  -h, --help      显示帮助

示例:
  node hot_songs.js --artist "周杰伦" -n 30
  node hot_songs.js --dir "/Volumes/Music/歌手分类" -n 10 -o report.txt
  node hot_songs.js --chart cn,tw -n 50
`);
}

// ---------------------------------------------------------
// 3. iTunes Search API (单个歌手/批量歌手)
// ---------------------------------------------------------

/**
 * 查询单个歌手的热门歌曲
 */
async function fetchArtistTopSongs(artistName, limit = 20, country = 'cn') {
    // API 多取一些用于去重
    const apiLimit = Math.min(limit + 30, 100);
    const url = `https://itunes.apple.com/search?term=${encodeURIComponent(artistName)}&country=${country}&entity=song&limit=${apiLimit}`;

    try {
        const data = await httpGet(url);
        const response = JSON.parse(data);

        if (!response.results || response.resultCount === 0) {
            return [];
        }

        // 过滤并去重
        const uniqueSongs = [];
        const seenNames = new Set();

        for (const item of response.results) {
            // 确保是该歌手的歌
            const itemArtist = item.artistName.toLowerCase();
            const searchArtist = artistName.toLowerCase();

            if (itemArtist.includes(searchArtist) || searchArtist.includes(itemArtist)) {
                const trackName = item.trackName.trim();
                const trackKey = trackName.toLowerCase();

                if (!seenNames.has(trackKey)) {
                    seenNames.add(trackKey);
                    uniqueSongs.push({
                        name: trackName,
                        artist: item.artistName,
                        album: item.collectionName,
                        year: item.releaseDate ? item.releaseDate.substring(0, 4) : 'Unknown'
                    });
                }

                if (uniqueSongs.length >= limit) break;
            }
        }

        return uniqueSongs;
    } catch (e) {
        console.error(`   ❌ 查询失败: ${e.message}`);
        return [];
    }
}

// ---------------------------------------------------------
// 4. Apple Music RSS (地区榜单)
// ---------------------------------------------------------

/**
 * 查询地区热门榜单 (iTunes RSS Feed)
 */
async function fetchChartSongs(region = 'us', limit = 100) {
    const apiLimit = Math.min(limit, 200);
    const url = `https://itunes.apple.com/${region}/rss/topsongs/limit=${apiLimit}/json`;

    try {
        const data = await httpGet(url);
        const response = JSON.parse(data);

        if (!response.feed || !response.feed.entry) {
            return [];
        }

        // 处理 entry 可能是数组或单个对象的情况
        let entries = response.feed.entry;
        if (!Array.isArray(entries)) {
            entries = [entries];
        }

        return entries.map(item => ({
            name: item['im:name']?.label || '',
            artist: item['im:artist']?.label || '',
            album: item['im:collection']?.['im:name']?.label || '',
            category: item.category?.attributes?.label || ''
        }));
    } catch (e) {
        console.error(`   ❌ 获取 ${region.toUpperCase()} 榜单失败: ${e.message}`);
        return [];
    }
}

// ---------------------------------------------------------
// 5. 主逻辑
// ---------------------------------------------------------

/**
 * 模式1: 单个歌手
 */
async function runArtistMode(artistName, limit, outputFile, jsonFormat) {
    console.log(`\n🔍 查询 "${artistName}" 的热门歌曲 (Top ${limit})...\n`);

    const songs = await fetchArtistTopSongs(artistName, limit);

    if (songs.length === 0) {
        console.log(`❌ 未找到 "${artistName}" 的歌曲`);
        return;
    }

    // 输出
    if (jsonFormat) {
        const output = JSON.stringify({ artist: artistName, songs }, null, 2);
        if (outputFile) {
            fs.writeFileSync(outputFile, output);
            console.log(`✅ 已保存到: ${outputFile}`);
        } else {
            console.log(output);
        }
    } else {
        const lines = [];
        lines.push(`🎤 ${artistName} - 热门歌曲 Top ${songs.length}`);
        lines.push('─'.repeat(50));

        songs.forEach((song, idx) => {
            const rank = String(idx + 1).padStart(2, ' ');
            lines.push(`${rank}. ${song.name}`);
            lines.push(`    💿 ${song.album} (${song.year})`);
        });

        lines.push('─'.repeat(50));
        lines.push('数据来源: iTunes API');

        const output = lines.join('\n');
        if (outputFile) {
            fs.writeFileSync(outputFile, output);
            console.log(output);
            console.log(`\n✅ 已保存到: ${outputFile}`);
        } else {
            console.log(output);
        }
    }
}

/**
 * 模式2: 批量目录
 */
async function runDirMode(dirPath, limit, outputFile, jsonFormat) {
    console.log(`\n📂 批量查询目录: ${dirPath}`);
    console.log(`   每位歌手获取 Top ${limit}\n`);

    if (!fs.existsSync(dirPath)) {
        console.error('❌ 目录不存在');
        return;
    }

    // 获取所有子目录作为歌手名
    const items = fs.readdirSync(dirPath, { withFileTypes: true });
    const artists = items
        .filter(item => item.isDirectory() && !item.name.startsWith('.') && !item.name.startsWith('_'))
        .map(item => item.name);

    console.log(`📋 发现 ${artists.length} 位歌手\n`);

    const allResults = [];
    const lines = [];
    lines.push(`生成时间: ${new Date().toLocaleString()}`);
    lines.push(`数据来源: iTunes API`);
    lines.push(`目录: ${dirPath}`);
    lines.push('═'.repeat(50));

    for (let i = 0; i < artists.length; i++) {
        const artist = artists[i];
        process.stdout.write(`\r⏳ [${i + 1}/${artists.length}] 查询: ${artist}...          `);

        const songs = await fetchArtistTopSongs(artist, limit);

        allResults.push({ artist, songs });

        lines.push(`\n### ${artist} (${songs.length} 首)`);
        if (songs.length === 0) {
            lines.push('   (未找到)');
        } else {
            songs.forEach((song, idx) => {
                lines.push(`   ${String(idx + 1).padStart(2, '0')}. ${song.name}`);
            });
        }

        // 避免请求过快
        await delay(300);
    }

    console.log('\n');

    // 输出
    if (jsonFormat) {
        const output = JSON.stringify(allResults, null, 2);
        if (outputFile) {
            fs.writeFileSync(outputFile, output);
        } else {
            console.log(output);
        }
    } else {
        const output = lines.join('\n');
        const file = outputFile || 'artist_top_songs.txt';
        fs.writeFileSync(file, output);
        console.log(`✅ 报告已生成: ${file}`);
    }

    // 统计
    const totalSongs = allResults.reduce((sum, r) => sum + r.songs.length, 0);
    const artistsWithSongs = allResults.filter(r => r.songs.length > 0).length;

    console.log(`\n📊 统计:`);
    console.log(`   歌手总数: ${artists.length}`);
    console.log(`   有结果的歌手: ${artistsWithSongs}`);
    console.log(`   歌曲总数: ${totalSongs}`);
}

/**
 * 模式3: 地区榜单
 */
async function runChartMode(regions, limit, outputFile, jsonFormat) {
    console.log(`\n📊 查询热门榜单: ${regions.map(r => r.toUpperCase()).join(', ')}`);
    console.log(`   每个地区获取 Top ${limit}\n`);

    const allSongs = new Map(); // 用于去重合并
    const regionResults = {};

    for (const region of regions) {
        if (!SUPPORTED_REGIONS.includes(region)) {
            console.log(`   ⚠️ 不支持的地区: ${region}`);
            continue;
        }

        process.stdout.write(`   🌐 获取 ${region.toUpperCase()} 榜单...`);
        const songs = await fetchChartSongs(region, limit);
        console.log(` ${songs.length} 首`);

        regionResults[region] = songs;

        // 合并去重
        songs.forEach(song => {
            const key = `${song.artist} - ${song.name}`;
            if (!allSongs.has(key)) {
                allSongs.set(key, { ...song, regions: [region] });
            } else {
                allSongs.get(key).regions.push(region);
            }
        });

        await delay(200);
    }

    const mergedSongs = Array.from(allSongs.values());

    console.log(`\n   📝 合并去重后: ${mergedSongs.length} 首\n`);

    // 输出
    if (jsonFormat) {
        const output = JSON.stringify({
            regions,
            total: mergedSongs.length,
            songs: mergedSongs
        }, null, 2);

        if (outputFile) {
            fs.writeFileSync(outputFile, output);
            console.log(`✅ 已保存到: ${outputFile}`);
        } else {
            console.log(output);
        }
    } else {
        const lines = [];
        lines.push(`🎵 热门榜单 - ${regions.map(r => r.toUpperCase()).join(', ')}`);
        lines.push(`生成时间: ${new Date().toLocaleString()}`);
        lines.push(`数据来源: Apple Music RSS`);
        lines.push('═'.repeat(50));

        mergedSongs.forEach((song, idx) => {
            const rank = String(idx + 1).padStart(3, ' ');
            const regionTag = song.regions.length > 1 ? ` [${song.regions.join(',')}]` : '';
            lines.push(`${rank}. ${song.artist} - ${song.name}${regionTag}`);
        });

        lines.push('═'.repeat(50));
        lines.push(`共 ${mergedSongs.length} 首`);

        const output = lines.join('\n');
        if (outputFile) {
            fs.writeFileSync(outputFile, output);
            console.log(output.split('\n').slice(0, 20).join('\n'));
            console.log(`... (共 ${mergedSongs.length} 首)`);
            console.log(`\n✅ 完整榜单已保存到: ${outputFile}`);
        } else {
            console.log(output);
        }
    }
}

// ---------------------------------------------------------
// 6. 入口
// ---------------------------------------------------------

async function main() {
    const args = parseArgs();

    if (!args.mode) {
        printHelp();
        return;
    }

    switch (args.mode) {
        case 'artist':
            if (!args.artist) {
                console.error('❌ 请提供歌手名: --artist "歌手名"');
                return;
            }
            await runArtistMode(args.artist, args.limit, args.output, args.json);
            break;

        case 'dir':
            if (!args.dir) {
                console.error('❌ 请提供目录路径: --dir "/path/to/artists"');
                return;
            }
            await runDirMode(args.dir, args.limit, args.output, args.json);
            break;

        case 'chart':
            if (args.charts.length === 0) {
                args.charts = [DEFAULT_COUNTRY];
            }
            await runChartMode(args.charts, args.limit, args.output, args.json);
            break;

        default:
            printHelp();
    }
}

main().catch(e => {
    console.error('❌ 错误:', e.message);
    process.exit(1);
});
