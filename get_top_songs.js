/**
 * 🎵 歌手热门歌曲查询工具 (Top Songs Finder)
 * 
 * 作用:
 * 输入歌手名字，查询该歌手在 Apple Music/iTunes 上的热门歌曲 Top 10。
 * 
 * 原理:
 * 使用公开的 iTunes Search API，不需要 API Key。
 * 默认查询中国区 (CN) 数据，以获取最准确的中文歌曲排行。
 * 
 * 使用方法:
 * node get_top_songs.js "歌手名字" [地区代码]
 * 
 * 示例:
 * node get_top_songs.js "周传雄"
 * node get_top_songs.js "Taylor Swift" US
 */

const https = require('https');

// 获取命令行参数
const args = process.argv.slice(2);
const artistName = args[0];
const country = args[1] || 'CN'; // 默认中国区

if (!artistName) {
    console.error('❌ 请提供歌手名字。');
    console.error('用法: node get_top_songs.js "歌手名字" [地区代码]');
    console.error('示例: node get_top_songs.js "周传雄"');
    process.exit(1);
}

// 构造 API URL
// entity=song: 只查歌曲
// limit=20: 获取前 20 首，我们在客户端去重（因为可能包含同一首歌的不同版本）
// sort=recent: iTunes API 的排序比较玄学，默认其实就是相关度/热度
const url = `https://itunes.apple.com/search?term=${encodeURIComponent(artistName)}&country=${country}&entity=song&limit=50`;

console.log(`\n🔍 正在查询 "${artistName}" 的热门歌曲 (地区: ${country})...\n`);

https.get(url, (res) => {
    let data = '';

    // 接收数据
    res.on('data', (chunk) => {
        data += chunk;
    });

    // 数据接收完毕
    res.on('end', () => {
        try {
            const response = JSON.parse(data);
            
            if (response.resultCount === 0) {
                console.log(`❌ 未找到关于 "${artistName}" 的歌曲。`);
                return;
            }

            // 数据清洗与去重
            // iTunes 经常返回同一首歌的多个版本（专辑版、精选集版、单曲版）
            // 我们通过 trackName 来简单去重
            const uniqueSongs = [];
            const seenNames = new Set();

            response.results.forEach(item => {
                // 确保是该歌手的歌（防止搜索 "周杰伦" 出现别人翻唱的歌）
                // 宽松匹配：只要 artistName 包含搜索词，或者搜索词包含 artistName
                if (item.artistName.toLowerCase().includes(artistName.toLowerCase()) || 
                    artistName.toLowerCase().includes(item.artistName.toLowerCase())) {
                    
                    const cleanName = item.trackName.trim();
                    // 简单去重逻辑：如果名字完全一样，就跳过
                    // 改进：忽略括号里的内容？比如 "黄昏 (Live)" 和 "黄昏"
                    // 暂时先做严格名去重，保留 Live 版作为单独条目可能更好
                    
                    if (!seenNames.has(cleanName)) {
                        seenNames.add(cleanName);
                        uniqueSongs.push(item);
                    }
                }
            });

            // 取前 10 首
            const top10 = uniqueSongs.slice(0, 10);

            if (top10.length === 0) {
                console.log(`⚠️ 找到了相关结果，但似乎不是 "${artistName}" 本人的歌曲。`);
                return;
            }

            console.log(`🎤 ${artistName} - 热门歌曲 Top ${top10.length}:`);
            console.log('--------------------------------------------------');
            
            top10.forEach((song, index) => {
                const rank = index + 1;
                const releaseYear = song.releaseDate ? song.releaseDate.substring(0, 4) : 'Unknown';
                // 对齐输出
                const rankStr = rank < 10 ? ` ${rank}` : `${rank}`;
                console.log(`${rankStr}. ${song.trackName}`);
                console.log(`    💿 专辑: ${song.collectionName} (${releaseYear})`);
                // console.log(`    🔗 试听: ${song.previewUrl}`); // 可选：显示试听链接
                console.log('');
            });
            console.log('--------------------------------------------------');
            console.log('数据来源: Apple Music / iTunes API');

        } catch (error) {
            console.error(`❌ 解析数据失败: ${error.message}`);
        }
    });

}).on('error', (err) => {
    console.error(`❌ 请求失败: ${err.message}`);
});
