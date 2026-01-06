/**
 * 脚本名称: Embed Lyrics (歌词嵌入工具)
 * 功能描述: 将同名 .lrc 歌词嵌入到 WAV 音频文件中
 * 技术实现: 使用 RIFF "ID3 " 子块嵌入 ID3v2.4 标签 (USLT 帧)
 * 使用方法:
 *    node embed_lyrics.js [目标目录] [选项]
 * 选项:
 *    -y           自动确认执行
 *    --limit N    只处理前 N 个文件
 *    --overwrite  覆盖已有嵌入歌词
 * 示例:
 *    node embed_lyrics.js "/path/to/music"       # 检查并询问
 *    node embed_lyrics.js "/path/to/music" -y    # 自动确认执行
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');

// ---------------------------------------------------------
// 配置
// ---------------------------------------------------------

const AUDIO_EXTENSIONS = /\.(wav)$/i;

const args = process.argv.slice(2);
const targetDir = args.find(a => !a.startsWith('--') && !a.startsWith('-')) || process.cwd();
const autoYes = args.includes('-y');
const overwrite = args.includes('--overwrite');
const limitArg = args.find(a => a.startsWith('--limit'));
const limit = limitArg ? parseInt(args[args.indexOf(limitArg) + 1]) || 0 : 0;

// ---------------------------------------------------------
// 工具函数
// ---------------------------------------------------------

function createRL() {
    return readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });
}

function ask(rl, question) {
    return new Promise(resolve => {
        rl.question(question, answer => resolve(answer.trim().toLowerCase()));
    });
}

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

function findLrcFile(audioPath) {
    const dir = path.dirname(audioPath);
    const baseName = path.basename(audioPath, path.extname(audioPath));
    const lrcPath = path.join(dir, `${baseName}.lrc`);

    if (fs.existsSync(lrcPath)) {
        return lrcPath;
    }
    return null;
}

/**
 * 检查 WAV 文件是否已有嵌入歌词
 * 通过查找 RIFF "ID3 " 子块中的 USLT 帧来判断
 */
function hasEmbeddedLyrics(audioPath) {
    try {
        const buf = fs.readFileSync(audioPath);

        // 检查 RIFF 头
        if (buf.toString('ascii', 0, 4) !== 'RIFF') return false;

        // 遍历 RIFF 块查找 ID3 子块
        let offset = 12; // 跳过 RIFF 头 (RIFF + size + WAVE)
        while (offset < buf.length - 8) {
            const chunkId = buf.toString('ascii', offset, offset + 4);
            const chunkSize = buf.readUInt32LE(offset + 4);

            if (chunkId === 'ID3 ') {
                // 检查 ID3 数据中是否有 USLT 帧
                const id3Start = offset + 8;
                if (buf.toString('ascii', id3Start, id3Start + 3) === 'ID3') {
                    const id3Data = buf.slice(id3Start, id3Start + chunkSize);
                    return id3Data.includes(Buffer.from('USLT'));
                }
            }

            offset += 8 + chunkSize;
            // RIFF 块需要 2 字节对齐
            if (chunkSize % 2 !== 0) offset++;
        }
        return false;
    } catch (e) {
        return false;
    }
}

/**
 * 从 WAV 文件中提取现有的 ID3 帧 (如 APIC)
 * 返回所有非 USLT 帧的 Buffer
 */
function extractExistingFrames(wavBuf) {
    const frames = [];

    // 检查 RIFF 头
    if (wavBuf.toString('ascii', 0, 4) !== 'RIFF') return frames;

    // 遍历 RIFF 块查找 ID3 子块
    let offset = 12;
    while (offset < wavBuf.length - 8) {
        const chunkId = wavBuf.toString('ascii', offset, offset + 4);
        const chunkSize = wavBuf.readUInt32LE(offset + 4);

        const isValidChunk = /^[\x20-\x7e]{4}$/.test(chunkId);
        if (!isValidChunk || chunkSize > wavBuf.length - offset) break;

        if (chunkId === 'ID3 ') {
            const id3Start = offset + 8;
            if (wavBuf.toString('ascii', id3Start, id3Start + 3) === 'ID3') {
                // 解析 ID3 大小 (syncsafe)
                const id3Size = (wavBuf[id3Start + 6] << 21) |
                               (wavBuf[id3Start + 7] << 14) |
                               (wavBuf[id3Start + 8] << 7) |
                               wavBuf[id3Start + 9];

                // 遍历 ID3 帧
                let frameOffset = id3Start + 10;
                while (frameOffset < id3Start + 10 + id3Size - 10) {
                    const frameId = wavBuf.toString('ascii', frameOffset, frameOffset + 4);

                    // 检查帧 ID 是否有效
                    if (!/^[A-Z0-9]{4}$/.test(frameId)) break;

                    // 读取帧大小 (syncsafe)
                    const frameSize = (wavBuf[frameOffset + 4] << 21) |
                                     (wavBuf[frameOffset + 5] << 14) |
                                     (wavBuf[frameOffset + 6] << 7) |
                                     wavBuf[frameOffset + 7];

                    if (frameSize <= 0 || frameSize > id3Size) break;

                    // 保留非 USLT 帧
                    if (frameId !== 'USLT') {
                        const frameData = wavBuf.slice(frameOffset, frameOffset + 10 + frameSize);
                        frames.push(frameData);
                    }

                    frameOffset += 10 + frameSize;
                }
            }
            break;
        }

        offset += 8 + chunkSize;
        if (chunkSize % 2 !== 0) offset++;
    }

    return frames;
}

/**
 * 创建 USLT 帧 (Unsynchronized Lyrics)
 */
function createUSLTFrame(lyrics) {
    // USLT 帧数据格式:
    // - 1 byte: 文本编码 (0x03 = UTF-8)
    // - 3 bytes: 语言代码 (例如 "chi" 或 "XXX")
    // - null-terminated: 内容描述符 (空字符串)
    // - 歌词文本 (UTF-8)

    const encoding = Buffer.from([0x03]); // UTF-8
    const language = Buffer.from('XXX'); // 未指定语言
    const descriptor = Buffer.from([0x00]); // 空描述符
    const lyricsBuffer = Buffer.from(lyrics, 'utf-8');

    const frameData = Buffer.concat([encoding, language, descriptor, lyricsBuffer]);

    // 帧头
    const frameId = Buffer.from('USLT');
    const frameSize = Buffer.alloc(4);
    // ID3v2.4 使用 syncsafe 整数
    const size = frameData.length;
    frameSize[0] = (size >> 21) & 0x7F;
    frameSize[1] = (size >> 14) & 0x7F;
    frameSize[2] = (size >> 7) & 0x7F;
    frameSize[3] = size & 0x7F;
    const frameFlags = Buffer.from([0x00, 0x00]);

    return Buffer.concat([frameId, frameSize, frameFlags, frameData]);
}

/**
 * 创建 ID3v2.4 标签
 */
function createID3v24Tag(frames) {
    const allFrames = Buffer.concat(frames);

    // ID3 头
    const id3Header = Buffer.alloc(10);
    id3Header.write('ID3');
    id3Header[3] = 0x04; // 版本 2.4
    id3Header[4] = 0x00; // 修订版
    id3Header[5] = 0x00; // 标志

    // ID3 大小 (syncsafe)
    const totalSize = allFrames.length;
    id3Header[6] = (totalSize >> 21) & 0x7F;
    id3Header[7] = (totalSize >> 14) & 0x7F;
    id3Header[8] = (totalSize >> 7) & 0x7F;
    id3Header[9] = totalSize & 0x7F;

    return Buffer.concat([id3Header, allFrames]);
}

/**
 * 移除 WAV 文件中已有的 ID3 数据
 */
function removeExistingID3Chunk(wavBuf) {
    // 情况1: 检查是否以 ID3 开头 (被破坏的情况)
    if (wavBuf.toString('ascii', 0, 3) === 'ID3') {
        const size = (wavBuf[6] << 21) | (wavBuf[7] << 14) | (wavBuf[8] << 7) | wavBuf[9];
        const totalID3Size = 10 + size;
        if (wavBuf.toString('ascii', totalID3Size, totalID3Size + 4) === 'RIFF') {
            wavBuf = wavBuf.slice(totalID3Size);
        }
    }

    // 验证 RIFF 格式
    if (wavBuf.toString('ascii', 0, 4) !== 'RIFF') {
        return wavBuf;
    }

    // 遍历 RIFF 块，收集非 ID3 块
    const chunks = [];
    let offset = 12;

    while (offset < wavBuf.length - 8) {
        const chunkId = wavBuf.toString('ascii', offset, offset + 4);
        const chunkSize = wavBuf.readUInt32LE(offset + 4);

        const isValidChunk = /^[\x20-\x7e]{4}$/.test(chunkId);
        if (!isValidChunk || chunkSize > wavBuf.length - offset) {
            break;
        }

        if (chunkId !== 'ID3 ') {
            let chunkEnd = offset + 8 + chunkSize;
            if (chunkSize % 2 !== 0) chunkEnd++;
            chunks.push(wavBuf.slice(offset, Math.min(chunkEnd, wavBuf.length)));
        }

        offset += 8 + chunkSize;
        if (chunkSize % 2 !== 0) offset++;
    }

    // 重建 WAV 文件
    const header = wavBuf.slice(0, 12);
    const newData = Buffer.concat([header, ...chunks]);
    newData.writeUInt32LE(newData.length - 8, 4);

    return newData;
}

/**
 * 将歌词嵌入 WAV 文件
 * 保留已有的 APIC 等帧
 */
function embedLyrics(audioPath, lrcPath) {
    try {
        let wavBuf = fs.readFileSync(audioPath);
        const lrcContent = fs.readFileSync(lrcPath, 'utf-8');

        // 提取已有的帧 (如 APIC)
        const existingFrames = extractExistingFrames(wavBuf);

        // 移除已有的 ID3 块
        wavBuf = removeExistingID3Chunk(wavBuf);

        // 验证 RIFF/WAVE 格式
        if (wavBuf.toString('ascii', 0, 4) !== 'RIFF' ||
            wavBuf.toString('ascii', 8, 12) !== 'WAVE') {
            return { success: false, error: '不是有效的 WAV 文件' };
        }

        // 创建 USLT 帧
        const usltFrame = createUSLTFrame(lrcContent);

        // 合并所有帧 (保留的帧 + 新的 USLT)
        const allFrames = [...existingFrames, usltFrame];

        // 创建 ID3v2.4 标签
        const id3Tag = createID3v24Tag(allFrames);

        // 创建 RIFF "ID3 " 子块
        const id3ChunkId = Buffer.from('ID3 ');
        const id3ChunkSize = Buffer.alloc(4);
        id3ChunkSize.writeUInt32LE(id3Tag.length);
        const id3Chunk = Buffer.concat([id3ChunkId, id3ChunkSize, id3Tag]);

        // 合并 WAV + ID3 块
        let newBuf = Buffer.concat([wavBuf, id3Chunk]);

        // 更新 RIFF 头的大小字段
        const newRiffSize = newBuf.length - 8;
        newBuf.writeUInt32LE(newRiffSize, 4);

        // 写入文件
        fs.writeFileSync(audioPath, newBuf);

        return {
            success: true,
            lrcSize: lrcContent.length,
            preservedFrames: existingFrames.length
        };
    } catch (e) {
        return { success: false, error: e.message };
    }
}

// ---------------------------------------------------------
// 主逻辑
// ---------------------------------------------------------

async function run() {
    console.log(`\n🎤 歌词嵌入工具 (RIFF ID3 子块方式)`);
    console.log(`📂 扫描目录: ${targetDir}`);
    if (overwrite) console.log(`⚠️  覆盖模式: 将覆盖已有嵌入歌词`);
    console.log('─'.repeat(60));

    if (!fs.existsSync(targetDir)) {
        console.error('❌ 目标目录不存在');
        process.exit(1);
    }

    // 扫描音频文件
    console.log('\n⏳ 正在扫描 WAV 文件...');
    let audioFiles = findAudioFiles(targetDir);

    if (limit > 0) {
        audioFiles = audioFiles.slice(0, limit);
        console.log(`   限制处理前 ${limit} 个文件`);
    }

    if (audioFiles.length === 0) {
        console.log('\n✨ 未找到 WAV 文件');
        return;
    }

    console.log(`   发现 ${audioFiles.length} 个 WAV 文件`);

    // 筛选需要处理的文件
    console.log('\n⏳ 正在检查歌词...');
    const tasks = [];

    for (const file of audioFiles) {
        const lrcPath = findLrcFile(file);
        const hasEmbedded = hasEmbeddedLyrics(file);

        if (lrcPath && (!hasEmbedded || overwrite)) {
            const lrcContent = fs.readFileSync(lrcPath, 'utf-8');
            tasks.push({
                file,
                lrcPath,
                lrcSize: lrcContent.length,
                lrcLines: lrcContent.split('\n').filter(l => l.trim()).length,
                hasExisting: hasEmbedded
            });
        }
    }

    if (tasks.length === 0) {
        console.log('\n✨ 所有文件都已嵌入歌词，或没有可用的 .lrc 文件');
        return;
    }

    console.log(`   发现 ${tasks.length} 个文件需要嵌入歌词`);

    // 输出计划
    console.log('\n' + '═'.repeat(60));
    console.log('📋 嵌入计划');
    console.log('═'.repeat(60));

    tasks.slice(0, 15).forEach((task, idx) => {
        const relPath = path.relative(targetDir, task.file);
        const lrcName = path.basename(task.lrcPath);
        console.log(`${idx + 1}. ${relPath}`);
        console.log(`   🎤 ${lrcName} (${task.lrcLines} 行)${task.hasExisting ? ' (覆盖)' : ''}`);
    });

    if (tasks.length > 15) {
        console.log(`\n   ... 还有 ${tasks.length - 15} 个文件`);
    }

    console.log('\n' + '═'.repeat(60));
    console.log(`📊 统计: 将为 ${tasks.length} 个 WAV 文件嵌入歌词`);
    console.log('═'.repeat(60));

    // 询问确认
    let shouldExecute = autoYes;

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

    // 执行嵌入
    console.log('\n⏳ 正在嵌入歌词...');
    let successCount = 0;
    let failCount = 0;
    const errors = [];

    for (let i = 0; i < tasks.length; i++) {
        const task = tasks[i];

        process.stdout.write(`\r   处理中: ${i + 1}/${tasks.length}`);

        const result = embedLyrics(task.file, task.lrcPath);

        if (result.success) {
            successCount++;
        } else {
            failCount++;
            errors.push({ file: task.file, error: result.error });
        }
    }

    console.log('\n\n' + '═'.repeat(60));
    console.log('✅ 嵌入完成!');
    console.log('═'.repeat(60));
    console.log(`   成功: ${successCount} 个文件`);
    if (failCount > 0) {
        console.log(`   失败: ${failCount} 个文件`);
        if (errors.length <= 5) {
            errors.forEach(e => {
                console.log(`      - ${path.basename(e.file)}: ${e.error}`);
            });
        }
    }
}

// ---------------------------------------------------------
// 执行
// ---------------------------------------------------------
run().catch(err => {
    console.error('❌ 运行出错:', err.message);
    process.exit(1);
});
