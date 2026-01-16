/**
 * 脚本名称: Batch Query Artists (批量查询歌手热门歌曲)
 * 功能描述: 扫描指定目录下的所有歌手子目录，逐个查询热门歌曲，保存到各自目录
 *
 * 使用方法:
 *   node batch_query_artists.js "/Volumes/Music/歌手分类" [-n 30]
 *
 * 参数:
 *   -n, --limit        每个歌手的热门歌曲数量 (默认 30)
 *   --skip             跳过的歌手，逗号分隔
 *   --resume           是否跳过已有 hot_songs.txt 的歌手
 *   -h, --help         显示帮助
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// ---------------------------------------------------------
// 1. 配置
// ---------------------------------------------------------

const DEFAULT_LIMIT = 30;
const DEFAULT_OUTPUT_FILE = 'hot_songs.txt';
const DELAY_BETWEEN_REQUESTS = 2000; // 每个请求之间的延迟（毫秒）
const NOT_FOUND_FILE = 'not_found.txt'; // 未找到的歌手记录文件（根目录）

// ---------------------------------------------------------
// 2. 工具函数
// ---------------------------------------------------------

/**
 * 记录未找到的歌手
 */
function recordNotFound(rootDir, artistName) {
    const notFoundPath = path.join(rootDir, NOT_FOUND_FILE);
    try {
        const timestamp = new Date().toLocaleString();
        const line = `${artistName}\n`;
        fs.appendFileSync(notFoundPath, line, 'utf-8');
        return true;
    } catch (e) {
        console.error(`   ❌ 记录未找到歌手失败: ${e.message}`);
        return false;
    }
}

function parseArgs() {
    const args = process.argv.slice(2);
    const result = {
        dir: null,
        limit: DEFAULT_LIMIT,
        skip: [],
        resume: false
    };

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        const next = args[i + 1];

        if (arg.startsWith('-')) {
            switch (arg) {
                case '--limit':
                case '-n':
                    result.limit = parseInt(next, 10) || DEFAULT_LIMIT;
                    i++;
                    break;
                case '--skip':

                    result.skip = next ? next.split(',').map(s => s.trim()) : [];
                    i++;
                    break;
                case '--resume':
                    result.resume = true;
                    break;
                case '--help':
                case '-h':
                    printHelp();
                    process.exit(0);
            }
        } else if (!result.dir) {
            result.dir = arg;
        }
    }

    return result;
}

function printHelp() {
    console.log(`
🎵 批量查询歌手热门歌曲

使用方法:
  node batch_query_artists.js "/path/to/artists/dir" [选项]

选项:
  -n, --limit        每个歌手的热门歌曲数量 (默认 ${DEFAULT_LIMIT})
  --skip "a,b,c"     跳过的歌手名，逗号分隔
  --resume           跳过已有 ${DEFAULT_OUTPUT_FILE} 的歌手
  -h, --help         显示帮助

示例:
  node batch_query_artists.js "/Volumes/Music/歌手分类" -n 30
  node batch_query_artists.js "/Volumes/Music/歌手分类" -n 30 --skip "Unknown,Various"
  node batch_query_artists.js "/Volumes/Music/歌手分类" --resume
`);
}

/**
 * 获取目录下的所有子目录
 */
function getSubDirs(dirPath) {
    try {
        if (!fs.existsSync(dirPath)) {
            console.error(`❌ 目录不存在: ${dirPath}`);
            return [];
        }

        const items = fs.readdirSync(dirPath, { withFileTypes: true });
        return items
            .filter(item => item.isDirectory() && !item.name.startsWith('.') && !item.name.startsWith('_'))
            .map(item => item.name)
            .sort();
    } catch (e) {
        console.error(`❌ 读取目录失败: ${e.message}`);
        return [];
    }
}

/**
 * 调用 hot_songs.js 查询歌手的热门歌曲
 */
async function queryArtist(artistName, limit) {
    return new Promise((resolve) => {
        try {
            const scriptPath = path.join(__dirname, 'hot_songs.js');
            // 构建命令：使用 --json 格式返回结果便于处理
            const cmd = `node "${scriptPath}" --artist "${artistName}" -n ${limit} --json`;

            const output = execSync(cmd, {
                encoding: 'utf-8',
                stdio: ['pipe', 'pipe', 'pipe'] // 捕获 stdout/stderr
            });

            try {
                const jsonMatch = output.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                    const data = JSON.parse(jsonMatch[0]);
                    resolve(data);
                } else {
                    resolve(null);
                }
            } catch (e) {
                resolve(null);
            }
        } catch (e) {
            resolve(null);
        }
    });
}

/**
 * 格式化结果为文本输出
 */
function formatResultAsText(artistName, songs) {
    const lines = [];
    lines.push(`🎤 ${artistName} - 热门歌曲 Top ${songs.length}`);
    lines.push('─'.repeat(60));

    songs.forEach((song, idx) => {
        const rank = String(idx + 1).padStart(2, ' ');
        lines.push(`${rank}. ${song.artist} - ${song.name}`);
    });

    lines.push('─'.repeat(60));
    lines.push(`生成时间: ${new Date().toLocaleString()}`);
    lines.push(`数据来源: iTunes API`);

    return lines.join('\n');
}

/**
 * 保存结果到文件
 */
function saveResult(artistDir, artistName, songs) {
    const outputPath = path.join(artistDir, DEFAULT_OUTPUT_FILE);
    const content = formatResultAsText(artistName, songs);

    try {
        fs.writeFileSync(outputPath, content, 'utf-8');
        return true;
    } catch (e) {
        console.error(`   ❌ 保存失败: ${e.message}`);
        return false;
    }
}

/**
 * 检查是否已有结果文件
 */
function hasResult(artistDir) {
    const outputPath = path.join(artistDir, DEFAULT_OUTPUT_FILE);
    return fs.existsSync(outputPath);
}

// ---------------------------------------------------------
// 3. 主函数
// ---------------------------------------------------------

/**
 * 延时函数
 */
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ---------------------------------------------------------
// 3. 主函数
// ---------------------------------------------------------

async function main() {
    const args = parseArgs();

    if (!args.dir) {
        console.error('❌ 请提供目录路径');
        printHelp();
        return;
    }

    // 获取所有歌手目录
    const artists = getSubDirs(args.dir);

    if (artists.length === 0) {
        console.log('❌ 未找到任何歌手目录');
        return;
    }

    // 过滤跳过的歌手
    const skipSet = new Set(args.skip);
    const toProcess = artists.filter(a => !skipSet.has(a));

    // 如果启用 resume，跳过已有结果的歌手
    let finalList = toProcess;
    if (args.resume) {
        finalList = toProcess.filter(a => {
            const artistDir = path.join(args.dir, a);
            return !hasResult(artistDir);
        });

        if (finalList.length === 0) {
            console.log('✅ 所有歌手都已查询过');
            return;
        }

        console.log(`⏭️  跳过已有结果的歌手，剩余 ${finalList.length} 个需要查询`);
    }

    console.log(`\n📂 开始批量查询歌手热门歌曲`);
    console.log(`📍 目录: ${args.dir}`);
    console.log(`👥 歌手总数: ${artists.length}`);
    console.log(`🔄 待查询: ${finalList.length}`);
    console.log(`⏱️  每个请求间隔: ${DELAY_BETWEEN_REQUESTS / 1000}s`);
    console.log(`🎵 每个歌手获取: Top ${args.limit}\n`);

    let successCount = 0;
    let failureCount = 0;
    const results = [];
    const startTime = Date.now();

    // 串行执行：逐个查询，每个完成后等待 2 秒
    for (let i = 0; i < finalList.length; i++) {
        const artist = finalList[i];
        const artistDir = path.join(args.dir, artist);

        const progress = `[${String(i + 1).padStart(String(finalList.length).length, ' ')}/${finalList.length}]`;
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

        process.stdout.write(`${progress} 查询: ${artist.padEnd(30)}... `);

        const data = await queryArtist(artist, args.limit);

        if (data && data.songs && data.songs.length > 0) {
            const saved = saveResult(artistDir, artist, data.songs);
            if (saved) {
                console.log(`✅ ${data.songs.length} 首 [${elapsed}s]`);
                successCount++;
                results.push({ artist, count: data.songs.length, status: 'success' });
            } else {
                console.log(`❌ 保存失败 [${elapsed}s]`);
                failureCount++;
                results.push({ artist, count: 0, status: 'save_failed' });
            }
        } else {
            console.log(`⚠️  未找到 [${elapsed}s]`);
            failureCount++;
            recordNotFound(args.dir, artist); // 记录未找到的歌手
            results.push({ artist, count: 0, status: 'not_found' });
        }

        // 在发起下一个请求前等待 2 秒
        if (i < finalList.length - 1) {
            await delay(DELAY_BETWEEN_REQUESTS);
        }
    }

    const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);

    // 输出统计
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`\n📊 处理完成!\n`);
    console.log(`✅ 成功: ${successCount}`);
    console.log(`❌ 失败/未找到: ${failureCount}`);
    console.log(`📈 成功率: ${((successCount / finalList.length) * 100).toFixed(1)}%`);
    console.log(`⏱️  总耗时: ${totalTime}s`);
    console.log(`⚡ 平均速度: ${(finalList.length / parseFloat(totalTime)).toFixed(1)} 个/秒\n`);

    // 统计各种状态
    const notFoundList = results.filter(r => r.status === 'not_found');
    const saveFailedList = results.filter(r => r.status === 'save_failed');

    if (notFoundList.length > 0) {
        console.log(`⚠️  未找到的歌手 (${notFoundList.length}):`);
        notFoundList.slice(0, 10).forEach(r => {
            console.log(`   • ${r.artist}`);
        });
        if (notFoundList.length > 10) {
            console.log(`   ... 和 ${notFoundList.length - 10} 个`);
        }
        console.log(`📝 已记录到: /Volumes/Music/${NOT_FOUND_FILE}\n`);
    }

    if (saveFailedList.length > 0) {
        console.log(`❌ 保存失败的歌手 (${saveFailedList.length}):`);
        saveFailedList.slice(0, 5).forEach(r => {
            console.log(`   • ${r.artist}`);
        });
        if (saveFailedList.length > 5) {
            console.log(`   ... 和 ${saveFailedList.length - 5} 个`);
        }
    }

    console.log(`\n✨ 所有结果已保存到各歌手目录的 ${DEFAULT_OUTPUT_FILE}\n`);
}

main().catch(e => {
    console.error('❌ 错误:', e.message);
    process.exit(1);
});
