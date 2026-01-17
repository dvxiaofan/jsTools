const { execSync } = require('child_process');
const path = require('path');

async function queryArtist(artistName, limit) {
    return new Promise((resolve) => {
        try {
            const scriptPath = path.join(__dirname, 'scripts/music/hot_songs.js');
            const cmd = `node "${scriptPath}" --artist "${artistName}" -n ${limit} --json`;

            const output = execSync(cmd, {
                encoding: 'utf-8',
                stdio: ['pipe', 'pipe', 'pipe']
            });

            try {
                // 改进的 JSON 解析逻辑
                const lines = output.split('\n');
                let jsonLines = [];
                let inJson = false;
                let braceCount = 0;

                for (const line of lines) {
                    if (!inJson && line.includes('{')) {
                        inJson = true;
                    }

                    if (inJson) {
                        jsonLines.push(line);
                        braceCount += (line.match(/\{/g) || []).length;
                        braceCount -= (line.match(/\}/g) || []).length;

                        if (braceCount === 0 && jsonLines.length > 0) {
                            break;
                        }
                    }
                }

                if (jsonLines.length > 0) {
                    const jsonStr = jsonLines.join('\n');
                    const data = JSON.parse(jsonStr);
                    resolve(data);
                } else {
                    resolve(null);
                }
            } catch (e) {
                console.error('解析错误:', e.message);
                resolve(null);
            }
        } catch (e) {
            console.error('执行错误:', e.message);
            resolve(null);
        }
    });
}

// 测试
(async () => {
    const result = await queryArtist('周深', 10);
    if (result && result.songs) {
        console.log(`✅ 成功找到 ${result.songs.length} 首歌曲`);
        console.log('前3首:');
        result.songs.slice(0, 3).forEach((s, i) => {
            console.log(`  ${i+1}. ${s.name}`);
        });
    } else {
        console.log('❌ 未找到歌曲');
    }
})();
