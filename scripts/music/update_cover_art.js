
const path = require('path');
const fs = require('fs').promises;
const os = require('os');
const { exec } = require('child_process');
const axios = require('axios');
const musicMetadata = require('music-metadata');
const NodeID3 = require('node-id3');
const minimist = require('minimist');

const SUPPORTED_EXTENSIONS = ['.mp3', '.flac'];

// --- 1. 文件遍历 ---
async function findAudioFiles(dir) {
    let results = [];
    const list = await fs.readdir(dir);
    for (const file of list) {
        const filePath = path.join(dir, file);
        const stat = await fs.stat(filePath);
        if (stat && stat.isDirectory()) {
            if (file.startsWith('CD')) {
                results = results.concat(await findAudioFiles(filePath));
            }
        } else {
            if (SUPPORTED_EXTENSIONS.includes(path.extname(filePath).toLowerCase())) {
                results.push(filePath);
            }
        }
    }
    return results;
}

// --- 2. 信息提取 (增强版) ---
async function parseSongInfo(filePath) {
    let fromMeta = null;
    let fromFilename = null;

    // 1. 尝试从元数据读取 (作为保底)
    try {
        const metadata = await musicMetadata.parseFile(filePath);
        if (metadata.common.artist && metadata.common.title) {
            fromMeta = {
                artist: metadata.common.artist,
                title: metadata.common.title
            };
            console.log(`  > 从元数据解析: ${fromMeta.artist} - ${fromMeta.title}`);
        }
    } catch (e) {
        console.log(`  > 读取元数据失败: ${e.message}`);
    }

    // 2. 尝试从文件名解析 (优先)
    const baseName = path.basename(filePath, path.extname(filePath));
    const cleanedName = baseName.replace(/^\d+[\s\.\-]*/, '');

    // 定义多种匹配模式和对应的解析函数
    const patterns = [
        {
            regex: /(.+?)\s*-\s*(.+)/, // 格式: 歌手 - 歌名
            parser: (match) => ({ artist: match[1].trim(), title: match[2].trim() })
        },
        {
            regex: /(.+?)\s*[\(（](.+?)[\)）]/, // 格式: 歌名 (歌手)
            parser: (match) => ({ title: match[1].trim(), artist: match[2].trim() })
        },
        {
            regex: /(.+?)\s*—\s*(.+)/, // 格式: 歌手 — 歌名
            parser: (match) => ({ artist: match[1].trim(), title: match[2].trim() })
        },
        {
            regex: /(.+?)\s+(.+)/, // 格式: 歌手 歌名 (作为最后的宽泛匹配)
            parser: (match) => ({ artist: match[1].trim(), title: match[2].trim() })
        }
    ];

    for (const pattern of patterns) {
        const match = cleanedName.match(pattern.regex);
        if (match && match.length === 3) {
            fromFilename = pattern.parser(match);
            console.log(`  > 从文件名解析 (规则: ${pattern.regex}): ${fromFilename.artist} - ${fromFilename.title}`);
            break; // 找到一个匹配就停止
        }
    }

    // 3. 决策
    if (fromFilename) {
        console.log('  > 决策: 使用文件名信息进行搜索。');
        return fromFilename;
    }
    if (fromMeta) {
        console.log('  > 决策: 文件名解析失败，使用元数据信息。');
        return fromMeta;
    }

    console.log('  > 无法从文件名或元数据解析出歌曲信息。');
    return null;
}

// --- 3. API 搜索 (QQ音乐 + iTunes) ---
async function searchCoverArt(artist, title) {
    const searchTerm = `${artist} ${title}`;
    console.log(`[API搜索] 正在为 "${searchTerm}" 搜索封面...`);

    // 优先尝试QQ音乐
    try {
        console.log('  > 正在尝试 QQ音乐...');
        const qqSearchUrl = `https://c.y.qq.com/soso/fcgi-bin/client_search_cp?p=1&n=1&w=${encodeURIComponent(searchTerm)}&format=json`;
        const response = await axios.get(qqSearchUrl);
        const callback = (data) => data;
        const data = eval(response.data);

        if (data.data.song.list.length > 0) {
            const song = data.data.song.list[0];
            const albummid = song.albummid;
            const imageUrl = `https://y.gtimg.cn/music/photo_new/T002R800x800M000${albummid}.jpg`;
            
            // 验证图片是否存在
            try {
                await axios.head(imageUrl);
                console.log(`  > QQ音乐搜索成功，找到封面: ${imageUrl}`);
                return imageUrl;
            } catch (e) {
                console.log('  > QQ音乐封面链接无效，继续尝试...');
            }
        }
    } catch (error) {
        console.log(`  > QQ音乐搜索失败: ${error.message}`);
    }

    // 如果QQ音乐失败，则尝试iTunes
    try {
        console.log('  > 正在尝试 iTunes...');
        const itunesSearchUrl = `https://itunes.apple.com/search?term=${encodeURIComponent(searchTerm)}&entity=song&limit=1`;
        const response = await axios.get(itunesSearchUrl);
        const data = response.data;

        if (data.resultCount > 0) {
            const result = data.results[0];
            let imageUrl = result.artworkUrl100; // 默认100x100
            
            // 尝试获取更高分辨率的图片
            if (imageUrl) {
                imageUrl = imageUrl.replace('100x100', '1000x1000');
                
                // 检查图片尺寸是否为方形
                const imageResponse = await axios.get(imageUrl, { responseType: 'arraybuffer' });
                const dimensions = require('image-size')(imageResponse.data);
                if (dimensions.width === dimensions.height) {
                    console.log(`  > iTunes搜索成功，找到高质量方形封面: ${imageUrl}`);
                    return imageUrl;
                } else {
                    console.log(`  > iTunes封面尺寸不为方形 (${dimensions.width}x${dimensions.height})，放弃使用。`);
                }
            }
        }
    } catch (error) {
        console.log(`  > iTunes搜索失败: ${error.message}`);
    }

    console.log('  > 所有API源都未找到匹配结果。');
    return null;
}


// --- 4. 图片下载 ---
async function downloadImage(url) {
    try {
        const response = await axios.get(url, { responseType: 'arraybuffer' });
        return Buffer.from(response.data, 'binary');
    } catch (error) {
        console.error(`  > 下载图片失败: ${error.message}`);
        return null;
    }
}

// --- 5. 封面嵌入 ---
async function embedCover(filePath, imageBuffer) {
    const ext = path.extname(filePath).toLowerCase();
    const cover = {
        mime: 'image/jpeg',
        type: { id: 3, name: 'front cover' },
        description: 'Cover',
        imageBuffer: imageBuffer,
    };

    if (ext === '.mp3') {
        try {
            const success = NodeID3.update({ image: cover }, filePath);
            if (success) {
                console.log('  > 成功嵌入 MP3 封面。');
            } else {
                console.error('  > 嵌入 MP3 封面失败。');
            }
            return success;
        } catch (error) {
            console.error(`  > 写入 MP3 标签时出错: ${error.message}`);
            return false;
        }
    } else if (ext === '.flac') {
        const tempImagePath = path.join(os.tmpdir(), `cover-${Date.now()}.jpg`);
        try {
            await fs.writeFile(tempImagePath, imageBuffer);
            
            const command = `metaflac --remove --block-type=PICTURE --dont-use-padding "${filePath}" && metaflac --import-picture-from="${tempImagePath}" --dont-use-padding "${filePath}"`;

            await new Promise((resolve, reject) => {
                exec(command, (error, stdout, stderr) => {
                    if (error) {
                        // stderr 包含 metaflac 的具体错误信息
                        console.error(`  > 执行 metaflac 失败: ${stderr}`);
                        reject(error);
                        return;
                    }
                    console.log('  > 成功嵌入 FLAC 封面。');
                    resolve(true);
                });
            });
            return true;
        } catch (error) {
            // 这个 catch 会捕获 writeFile 的错误，或者 exec Promise 的 reject
            console.error(`  > 处理 FLAC 文件时出错: ${error.message}`);
            return false;
        } finally {
            // 无论成功还是失败，最后都清理临时文件
            await fs.unlink(tempImagePath).catch(err => console.error(`  > 删除临时文件失败: ${err.message}`));
        }
    }
    return false;
}


// --- 主逻辑 ---
async function main() {
    const args = minimist(process.argv.slice(2));
    const targetDir = args._[0];
    const isDryRun = args['dry-run'] || false;

    if (isDryRun) {
        console.log('*** 演习模式 (Dry Run) 开启，不会修改任何文件。 ***\n');
    }

    if (!targetDir) {
        console.error('错误: 请提供一个目标目录路径。');
        console.log('用法: node update_cover_art.js <目录路径> [--dry-run]');
        return;
    }

    console.log(`正在扫描目录: ${targetDir}`);
    const audioFiles = await findAudioFiles(targetDir);
    console.log(`找到了 ${audioFiles.length} 个支持的音频文件。`);

    for (const file of audioFiles) {
        console.log(`\n处理文件: ${path.basename(file)}`);
        const songInfo = await parseSongInfo(file);

        if (songInfo) {
            console.log(`  > 解析信息: 歌手 - ${songInfo.artist}, 歌名 - ${songInfo.title}`);
            const imageUrl = await searchCoverArt(songInfo.artist, songInfo.title);
            if (imageUrl) {
                if (isDryRun) {
                    console.log(`  > [演习] 将会下载并嵌入封面: ${imageUrl}`);
                } else {
                    console.log('  > 正在下载封面...');
                    const imageBuffer = await downloadImage(imageUrl);
                    if (imageBuffer) {
                        console.log(`  > 下载成功 (${(imageBuffer.length / 1024).toFixed(2)} KB)，正在嵌入...`);
                        await embedCover(file, imageBuffer);
                    }
                }
            }
        } else {
            console.log('  > 无法从文件名或元数据解析出歌曲信息。');
        }
    }
}

main().catch(console.error);
