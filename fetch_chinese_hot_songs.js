const https = require('https');
const fs = require('fs');
const path = require('path');

const regions = ['cn', 'tw', 'hk', 'sg', 'my']; // 华语主要地区
const limit = 100; // API 单次最大通常为 100
const outputFile = path.join(__dirname, 'top_chinese_songs_500.txt');

// 补充一些经典华语歌手，用于 RSS 无法凑齐 500 首时补充
const backupArtists = [
    '周杰伦', '陈奕迅', '林俊杰', '五月天', '孙燕姿', '蔡依林', '王力宏', '陶喆', '张学友', '刘德华',
    '王菲', '李荣浩', '邓紫棋', '薛之谦', '毛不易', '张惠妹', '田馥甄', '苏打绿', '莫文蔚', '张韶涵',
    '杨丞琳', '王心凌', '伍佰', '李宗盛', '罗大佑', '许巍', '朴树', '汪峰', '那英', '萧亚轩',
    '林宥嘉', '萧敬腾', '张国荣', '梅艳芳', 'Beyond', '陈百强', '谭咏麟', '李克勤', '容祖儿', 'Twins',
    '徐佳莹', '周深', '华晨宇', '任贤齐', '刘若英', '梁静茹', '许嵩', '汪苏泷', '凤凰传奇', '筷子兄弟'
];

function fetchUrl(url) {
    return new Promise((resolve, reject) => {
        https.get(url, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => resolve(data));
        }).on('error', reject);
    });
}

// 1. 获取 RSS 榜单
async function fetchRSS(region) {
    const url = `https://rss.applemarketingtools.com/api/v2/${region}/music/most-played/${limit}/songs.json`;
    console.log(`🌐 Fetching RSS for ${region.toUpperCase()}...`);
    try {
        const data = await fetchUrl(url);
        const json = JSON.parse(data);
        return json.feed.results || [];
    } catch (e) {
        console.error(`❌ Error fetching ${region}: ${e.message}`);
        return [];
    }
}

// 2. 搜索特定歌手 Top 歌曲
async function fetchArtistTopSongs(term) {
    const url = `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&entity=song&limit=10&country=CN`;
    // console.log(`🎵 Fetching top songs for ${term}...`);
    try {
        const data = await fetchUrl(url);
        const json = JSON.parse(data);
        return json.results || [];
    } catch (e) {
        return [];
    }
}

// 简单的延时函数，避免触发 API 限制
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function run() {
    let allSongs = new Map(); // Key: "Artist - Track" -> SongObject

    // 1. 抓取各地区 RSS
    for (const region of regions) {
        const songs = await fetchRSS(region);
        songs.forEach(song => {
            const key = `${song.artistName} - ${song.name}`;
            if (!allSongs.has(key)) {
                allSongs.set(key, {
                    artist: song.artistName,
                    name: song.name,
                    source: `RSS-${region.toUpperCase()}`
                });
            }
        });
    }

    console.log(`📊 RSS 获取去重后数量: ${allSongs.size}`);

    // 2. 如果不足 500 首，或者为了丰富度，补充经典歌手热歌
    if (allSongs.size < 600) { // 目标是生成 500，多抓点备选
        console.log('⚡️ 补充经典歌手热门歌曲...');
        for (const artist of backupArtists) {
            const songs = await fetchArtistTopSongs(artist);
            songs.forEach(song => {
                const key = `${song.artistName} - ${song.trackName}`;
                if (!allSongs.has(key)) {
                    allSongs.set(key, {
                        artist: song.artistName,
                        name: song.trackName,
                        source: `Search-${artist}`
                    });
                }
            });
            process.stdout.write('.'); // 进度条效果
            await delay(200); // 稍微延时
        }
        console.log('\n');
    }

    // 3. 过滤非中文歌曲 (简单过滤：如果 Artist 是纯英文且不在我们的白名单里，或者 Genre 不对)
    // 但 RSS 榜单里肯定混杂了欧美流行 (Taylor Swift, etc.)
    // 我们需要尽量保留华语。
    // 策略：优先保留 backupArtists 里的歌手，以及 RSS 里名字包含中文的歌手/歌曲
    
    const chineseRegex = /[\u4e00-\u9fa5]/;
    
    let filteredSongs = Array.from(allSongs.values()).filter(song => {
        // 1. 歌手名或歌名包含中文 -> 保留
        if (chineseRegex.test(song.artist) || chineseRegex.test(song.name)) return true;
        // 2. 歌手在我们的白名单里 -> 保留 (处理像 S.H.E, JJ Lin 这种可能没中文名的)
        if (backupArtists.some(a => song.artist.includes(a))) return true;
        
        return false; // 剔除纯英文歌 (大概率是欧美日韩)
    });

    console.log(`🧹 过滤非华语歌曲后数量: ${filteredSongs.length}`);

    // 4. 截取前 500
    const finalTop500 = filteredSongs.slice(0, 500);

    // 5. 写入文件
    const fileContent = finalTop500.map((s, index) => 
        `${(index + 1).toString().padStart(3, '0')}. ${s.artist} - ${s.name}`
    ).join('\n');

    fs.writeFileSync(outputFile, fileContent);
    console.log(`✅ 已生成榜单文件: ${outputFile}`);
    console.log(`📝 共收录: ${finalTop500.length} 首`);
}

run();
