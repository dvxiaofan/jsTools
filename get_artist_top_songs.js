const fs = require('fs');
const path = require('path');
const https = require('https');

const musicDir = '/Volumes/Music';
const exclude = ['其他合集', '.DS_Store'];
const topLimit = 30;

// 获取歌手列表
let artists = [];
try {
    artists = fs.readdirSync(musicDir, { withFileTypes: true })
        .filter(dirent => dirent.isDirectory() && !exclude.includes(dirent.name))
        .map(dirent => dirent.name);
} catch (e) {
    console.error(`无法读取目录 ${musicDir}: ${e.message}`);
    process.exit(1);
}

console.log(`找到 ${artists.length} 位歌手，开始查询 iTunes Top ${topLimit} 歌曲...\n`);

// 辅助函数：请求 iTunes
function fetchTopSongs(artist) {
    return new Promise((resolve) => {
        // limit 稍微多取一点，用于后续去重
        const fetchLimit = topLimit + 20;
        const url = `https://itunes.apple.com/search?term=${encodeURIComponent(artist)}&country=CN&entity=song&limit=${fetchLimit}`;

        https.get(url, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);

                    if (!json.results) {
                         resolve({ artist, songs: [] });
                         return;
                    }

                    // 过滤并提取歌名
                    const uniqueSongs = new Set();
                    const songs = [];

                    for (const item of json.results) {
                        // 简单的歌手名匹配检查，防止搜索出完全不相关的
                        // 比如搜 "A-Lin" 可能会出一些其他的，这里做一个宽松匹配
                        const artistLower = artist.toLowerCase();
                        const itemArtistLower = (item.artistName || '').toLowerCase();

                        if (itemArtistLower.includes(artistLower) || artistLower.includes(itemArtistLower)) {
                            const songName = item.trackName;
                            // 去除重复 (忽略大小写差异)
                            if (!uniqueSongs.has(songName.toLowerCase())) {
                                uniqueSongs.add(songName.toLowerCase());
                                songs.push(songName);
                            }
                        }

                        if (songs.length >= topLimit) break;
                    }

                    resolve({ artist, songs });
                } catch (e) {
                    console.error(`   ❌ 解析错误 ${artist}: ${e.message}`);
                    resolve({ artist, songs: [] });
                }
            });
        }).on('error', (e) => {
            console.error(`   ❌ 网络错误 ${artist}: ${e.message}`);
            resolve({ artist, songs: [] });
        });
    });
}

async function run() {
    const results = [];
    const outputFile = path.join(__dirname, 'artist_top30_songs.txt');

    // 写入文件头
    fs.writeFileSync(outputFile, `生成时间: ${new Date().toLocaleString()}\n数据来源: iTunes API (CN)\n\n`);

    for (let i = 0; i < artists.length; i++) {
        const artist = artists[i];
        process.stdout.write(`[${i + 1}/${artists.length}] 正在查询: ${artist} ... `);

        const result = await fetchTopSongs(artist);
        results.push(result);

        console.log(`找到 ${result.songs.length} 首`);

        // 实时追加写入文件，防止程序中断
        let outputChunk = `### ${result.artist}\n`;
        if (result.songs.length === 0) {
            outputChunk += `(未找到相关热门歌曲)\n`;
        } else {
            result.songs.forEach((song, index) => {
                outputChunk += `${String(index + 1).padStart(2, '0')}. ${song}\n`;
            });
        }
        outputChunk += `\n----------------------------------------\n\n`;

        fs.appendFileSync(outputFile, outputChunk);

        // 稍微停顿一下，防止请求过快
        await new Promise(r => setTimeout(r, 300));
    }

    console.log(`\n✅ 查询完成！结果已保存到: ${outputFile}`);
}

run();
