const fs = require('fs');

function parseHotSongsList(filePath) {
    try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const lines = content.split('\n');
        const songs = [];

        lines.forEach((line, idx) => {
            // 匹配格式: "数字. 歌手 - 歌曲名"
            const match = line.match(/^\s*\d+\.\s+(.+?)\s+-\s+(.+?)$/);
            if (match) {
                console.log(`[Line ${idx}] ✅ 匹配成功`);
                console.log(`  原文: "${line}"`);
                console.log(`  歌手: "${match[1].trim()}"`);
                console.log(`  歌曲: "${match[2].trim()}"`);
                songs.push({
                    artist: match[1].trim(),
                    name: match[2].trim()
                });
            } else if (line.trim() && !line.includes('────') && !line.includes('🎤') && !line.includes('生成') && !line.includes('数据')) {
                console.log(`[Line ${idx}] ❌ 未匹配: "${line}"`);
            }
        });

        return songs;
    } catch (e) {
        console.error(`❌ 读取文件失败: ${e.message}`);
        return [];
    }
}

const songs = parseHotSongsList('/Volumes/Music/歌手分类/周深/hot_songs.txt');
console.log(`\n总计找到: ${songs.length} 首歌曲`);
