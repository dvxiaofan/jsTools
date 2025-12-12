/**
 * 🎵 批量提取热门歌曲工具 (Batch Top Songs Collector)
 *
 * 作用:
 * 1. 遍历目标目录下的所有子文件夹，将子文件夹名视为“歌手名”。
 * 2. 自动查询该歌手在 iTunes 上的 Top 20 热门歌曲。
 * 3. 在该歌手目录下查找匹配这些热门歌曲的音频文件。
 * 4. 生成脚本，将找到的热门歌曲文件移动到统一的 `topSongs` 目录中。
 *
 * 使用方法:
 * node collect_top_songs.js "/path/to/downloads"
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

// 获取命令行参数
const args = process.argv.slice(2);

let targetDir = '';
let topLimit = 20; // 默认前 20 首

// 解析参数
args.forEach(arg => {
    // 匹配 -数字 格式，例如 -50
    if (/^-\d+$/.test(arg)) {
        topLimit = Math.abs(parseInt(arg, 10));
    } else if (!targetDir) {
        // 第一个非数字参数视为目录路径
        targetDir = arg;
    }
});

if (!targetDir) {
    console.error('❌ 请提供目标目录路径。');
    console.error('用法: node collect_top_songs.js "/path/to/downloads" [-数量]');
    console.error('示例: node collect_top_songs.js "/Users/ccfun/Downloads" -50');
    process.exit(1);
}

const absoluteTargetDir = path.resolve(targetDir);
const topSongsDirName = 'topSongs'; // 统一存放目录名
const supportedExts = new Set(['.mp3', '.flac', '.wav', '.m4a', '.ape', '.wma', '.aac', '.ogg']);

console.log(`\n🚀 开始批量扫描热门歌曲: ${absoluteTargetDir}`);
console.log(`   配置: 获取 Top ${topLimit} 热门歌曲`);
console.log(`   匹配到的歌曲将被移动到: ${path.join(absoluteTargetDir, topSongsDirName)}\n`);

// 辅助函数：获取 iTunes Top 歌曲 (Promise 封装)
function fetchTopSongs(artistName, limit) {
    return new Promise((resolve) => {
        // API limit 设为请求数量 + 10，作为去重缓冲
        const apiLimit = limit + 10;
        const url = `https://itunes.apple.com/search?term=${encodeURIComponent(artistName)}&country=CN&entity=song&limit=${apiLimit}`;

        https.get(url, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const response = JSON.parse(data);
                    if (!response.results || response.resultCount === 0) {
                        resolve([]);
                        return;
                    }

                    const uniqueSongs = new Set();
                    const topList = [];

                    response.results.forEach(item => {
                        // 确保歌手名大致匹配
                        if (item.artistName.toLowerCase().includes(artistName.toLowerCase()) ||
                            artistName.toLowerCase().includes(item.artistName.toLowerCase())) {

                            const cleanName = item.trackName.trim();
                            if (!uniqueSongs.has(cleanName)) {
                                uniqueSongs.add(cleanName);
                                topList.push(cleanName);
                            }
                        }
                    });

                    // 取前 limit 首
                    resolve(topList.slice(0, limit));
                } catch (e) {
                    console.error(`   ❌ [API Error] 解析 ${artistName} 数据失败`);
                    resolve([]);
                }
            });
        }).on('error', (e) => {
            console.error(`   ❌ [Network Error] 连接失败: ${e.message}`);
            resolve([]);
        });
    });
}

// 辅助函数：递归扫描目录下的音频文件
function scanAudioFiles(dir) {
    let results = [];
    try {
        const files = fs.readdirSync(dir);
        files.forEach(file => {
            const fullPath = path.join(dir, file);
            const stat = fs.statSync(fullPath);
            if (stat.isDirectory()) {
                if (file !== topSongsDirName) { // 避开目标目录
                    results = results.concat(scanAudioFiles(fullPath));
                }
            } else {
                const ext = path.extname(file).toLowerCase();
                if (supportedExts.has(ext)) {
                    results.push({
                        name: file,
                        path: fullPath,
                        basename: path.basename(file, ext) // 无后缀名
                    });
                }
            }
        });
    } catch (e) {
        // ignore access errors
    }
    return results;
}

// 辅助函数：简单的字符串匹配
// 检查 localFile 是否包含 songName
function isMatch(localFilename, songName) {
    const normalize = (s) => s.toLowerCase().replace(/[^\w\u4e00-\u9fa5]/g, ''); // 去除标点
    const nLocal = normalize(localFilename);
    const nSong = normalize(songName);

    // 如果歌名太短（比如少于2个字），要求完全匹配
    if (nSong.length <= 2) {
        return nLocal === nSong;
    }
    return nLocal.includes(nSong);
}

// 主逻辑
async function main() {
    // 1. 获取所有歌手目录
    let artistDirs = [];
    try {
        const items = fs.readdirSync(absoluteTargetDir);
        items.forEach(item => {
            const fullPath = path.join(absoluteTargetDir, item);
            if (fs.statSync(fullPath).isDirectory() && item !== topSongsDirName && !item.startsWith('.')) {
                artistDirs.push({ name: item, path: fullPath });
            }
        });
    } catch (e) {
        console.error(`❌ 无法读取目录: ${e.message}`);
        return;
    }

    if (artistDirs.length === 0) {
        console.log('⚠️ 目标目录下没有找到子文件夹。');
        return;
    }

    console.log(`📂 发现 ${artistDirs.length} 个歌手文件夹，准备开始查询...`);

    const moveCommands = [];
    let totalFound = 0;

    // 2. 串行处理每个歌手（避免并发过高）
    for (const artist of artistDirs) {
        process.stdout.write(`🔍 [${artist.name}] 查询中... `);

        const topSongs = await fetchTopSongs(artist.name, topLimit);

        if (topSongs.length === 0) {
            console.log('未找到热门歌曲数据。');
            continue;
        }

        console.log(`获取到 ${topSongs.length} 首热门歌。开始本地匹配...`);

        // 扫描该歌手目录下的本地文件
        const localFiles = scanAudioFiles(artist.path);

        if (localFiles.length === 0) {
            console.log(`   ⚠️ 本地没有音频文件。`);
            continue;
        }

        let foundForArtist = 0;
        const matchedFiles = new Set(); // 防止同一文件匹配多个歌名

        // 匹配逻辑
        topSongs.forEach(songName => {
            localFiles.forEach(file => {
                if (matchedFiles.has(file.path)) return;

                if (isMatch(file.basename, songName)) {
                    // 找到匹配！
                    foundForArtist++;
                    totalFound++;
                    matchedFiles.add(file.path);

                    // 构建移动路径： topSongs/歌手名 - 文件名 (平铺模式)
                    const destDir = topSongsDirName;

                    let newFilename = file.name;
                    // 如果文件名不包含歌手名，则加上前缀，防止冲突并方便识别
                    if (!newFilename.includes(artist.name)) {
                        newFilename = `${artist.name} - ${newFilename}`;
                    }

                    if (process.platform === 'win32') {
                        moveCommands.push(`if not exist "${path.join(absoluteTargetDir, destDir)}" mkdir "${path.join(absoluteTargetDir, destDir)}"`);
                        moveCommands.push(`move "${file.path}" "${path.join(absoluteTargetDir, destDir, newFilename)}"`);
                    } else {
                        // Bash
                        const absoluteDestDir = path.join(absoluteTargetDir, destDir);
                        moveCommands.push(`mkdir -p "${absoluteDestDir}"`);
                        moveCommands.push(`mv "${file.path}" "${path.join(absoluteDestDir, newFilename)}"`);
                    }

                    console.log(`   ✅ 匹配: "${songName}" -> ${file.name}`);
                }
            });
        });

        if (foundForArtist === 0) {
            console.log(`   ⭕ 无本地匹配。`);
        }
    }

    // 3. 生成脚本
    if (moveCommands.length > 0) {
        const scriptName = process.platform === 'win32' ? 'move_top_songs.bat' : 'move_top_songs.sh';
        const scriptPath = path.join(process.cwd(), scriptName);

        // 去重 mkdir 命令 (可选优化，这里简单处理)
        const uniqueCommands = Array.from(new Set(moveCommands));

        let scriptContent = '';
        if (process.platform === 'win32') {
            scriptContent = `@echo off\nchcp 65001\n${uniqueCommands.join('\n')}`;
        } else {
            scriptContent = `#!/bin/bash\n${uniqueCommands.join('\n')}`;
        }

        fs.writeFileSync(scriptPath, scriptContent, { mode: 0o755 });

        console.log(`\n--------------------------------------------------`);
        console.log(`🎉 扫描完成！共匹配到 ${totalFound} 个文件。`);
        console.log(`🛡️  已生成移动脚本: ${scriptPath}`);
        console.log(`   请检查脚本内容，确认无误后运行它。`);
        console.log(`   (文件将被移动到: ${path.join(absoluteTargetDir, topSongsDirName)} 及其子目录中)`);
    } else {
        console.log(`\n--------------------------------------------------`);
        console.log(`🏁 扫描完成，未发现任何匹配的热门歌曲文件。`);
    }
}

main();
