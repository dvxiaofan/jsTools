/**
 * 脚本名称: Embed Covers (封面嵌入工具)
 * 功能描述: 将同名 .jpg 封面嵌入到 WAV 音频文件中
 * 技术实现: 使用 RIFF "ID3 " 子块嵌入 ID3v2.4 标签
 * 使用方法:
 *    node embed_covers.js [目标目录] [选项]
 * 选项:
 *    -y           自动确认执行
 *    --limit N    只处理前 N 个文件
 *    --overwrite  覆盖已有封面
 * 示例:
 *    node embed_covers.js "/path/to/music"       # 检查并询问
 *    node embed_covers.js "/path/to/music" -y    # 自动确认执行
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');

// ---------------------------------------------------------
// 配置
// ---------------------------------------------------------

const AUDIO_EXTENSIONS = /\.(wav)$/i;
const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png'];

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

function findCoverFile(audioPath) {
    const dir = path.dirname(audioPath);
    const baseName = path.basename(audioPath, path.extname(audioPath));

    for (const ext of IMAGE_EXTENSIONS) {
        const coverPath = path.join(dir, `${baseName}${ext}`);
        if (fs.existsSync(coverPath)) {
            return coverPath;
        }
    }
    return null;
}

/**
 * 检查 WAV 文件是否已有嵌入封面
 * 通过查找 RIFF "ID3 " 子块来判断
 */
function hasEmbeddedCover(audioPath) {
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
                // 检查 ID3 数据中是否有 APIC 帧
                const id3Start = offset + 8;
                if (buf.toString('ascii', id3Start, id3Start + 3) === 'ID3') {
                    // 简单检查是否包含 APIC
                    const id3Data = buf.slice(id3Start, id3Start + chunkSize);
                    return id3Data.includes(Buffer.from('APIC'));
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
 * 创建 ID3v2.4 标签 (仅包含 APIC 帧)
 */
function createID3v24Tag(coverBuffer) {
    // APIC 帧数据: 4 字节填充 + 图片数据
    // 简化版本: 直接使用 4 字节前缀 + 图片数据
    const apicData = Buffer.concat([
        Buffer.from([0x00, 0x00, 0x00, 0x00]), // 简化的 APIC 前缀
        coverBuffer
    ]);

    // APIC 帧头
    const frameId = Buffer.from('APIC');
    const frameSize = Buffer.alloc(4);
    // ID3v2.4 使用 syncsafe 整数
    const size = apicData.length;
    frameSize[0] = (size >> 21) & 0x7F;
    frameSize[1] = (size >> 14) & 0x7F;
    frameSize[2] = (size >> 7) & 0x7F;
    frameSize[3] = size & 0x7F;
    const frameFlags = Buffer.from([0x00, 0x00]);

    const apicFrame = Buffer.concat([frameId, frameSize, frameFlags, apicData]);

    // ID3 头
    const id3Header = Buffer.alloc(10);
    id3Header.write('ID3');
    id3Header[3] = 0x04; // 版本 2.4
    id3Header[4] = 0x00; // 修订版
    id3Header[5] = 0x00; // 标志

    // ID3 大小 (syncsafe)
    const totalSize = apicFrame.length;
    id3Header[6] = (totalSize >> 21) & 0x7F;
    id3Header[7] = (totalSize >> 14) & 0x7F;
    id3Header[8] = (totalSize >> 7) & 0x7F;
    id3Header[9] = totalSize & 0x7F;

    return Buffer.concat([id3Header, apicFrame]);
}

/**
 * 移除 WAV 文件中已有的 ID3 数据
 * 处理多种情况：
 * 1. ID3 在文件开头（node-id3 破坏的情况）
 * 2. ID3 作为 RIFF 子块
 * 3. ID3 直接追加在文件末尾（不在 RIFF 块内）
 */
function removeExistingID3Chunk(wavBuf) {
    // 情况1: 检查是否以 ID3 开头 (被 node-id3 破坏的情况)
    if (wavBuf.toString('ascii', 0, 3) === 'ID3') {
        // 解析 ID3 大小 (syncsafe integer)
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

    // 遍历 RIFF 块，找到 data 块结束位置，并收集非 ID3 块
    const chunks = [];
    let offset = 12;
    let dataChunkEnd = 0;

    while (offset < wavBuf.length - 8) {
        const chunkId = wavBuf.toString('ascii', offset, offset + 4);
        const chunkSize = wavBuf.readUInt32LE(offset + 4);

        // 检查是否是有效的 RIFF 块（块 ID 应该是可打印 ASCII）
        const isValidChunk = /^[\x20-\x7e]{4}$/.test(chunkId);
        if (!isValidChunk || chunkSize > wavBuf.length - offset) {
            // 遇到无效块，停止解析（可能是追加的原始 ID3 数据）
            break;
        }

        if (chunkId !== 'ID3 ') {
            // 保留非 ID3 块
            let chunkEnd = offset + 8 + chunkSize;
            if (chunkSize % 2 !== 0) chunkEnd++; // 2 字节对齐
            chunks.push(wavBuf.slice(offset, Math.min(chunkEnd, wavBuf.length)));

            if (chunkId === 'data') {
                dataChunkEnd = chunkEnd;
            }
        }

        offset += 8 + chunkSize;
        if (chunkSize % 2 !== 0) offset++;
    }

    // 重建 WAV 文件（只保留有效的 RIFF 块）
    const header = wavBuf.slice(0, 12); // RIFF + size + WAVE
    const newData = Buffer.concat([header, ...chunks]);

    // 更新 RIFF 大小
    newData.writeUInt32LE(newData.length - 8, 4);

    return newData;
}

/**
 * 将封面嵌入 WAV 文件
 * 使用 RIFF "ID3 " 子块格式
 */
function embedCover(audioPath, coverPath) {
    try {
        let wavBuf = fs.readFileSync(audioPath);
        const coverBuf = fs.readFileSync(coverPath);

        // 移除已有的 ID3 块
        wavBuf = removeExistingID3Chunk(wavBuf);

        // 验证 RIFF/WAVE 格式
        if (wavBuf.toString('ascii', 0, 4) !== 'RIFF' ||
            wavBuf.toString('ascii', 8, 12) !== 'WAVE') {
            return { success: false, error: '不是有效的 WAV 文件' };
        }

        // 创建 ID3v2.4 标签
        const id3Tag = createID3v24Tag(coverBuf);

        // 创建 RIFF "ID3 " 子块
        const id3ChunkId = Buffer.from('ID3 '); // 4 字节，包含尾随空格
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

        return { success: true, coverSize: coverBuf.length };
    } catch (e) {
        return { success: false, error: e.message };
    }
}

// ---------------------------------------------------------
// 主逻辑
// ---------------------------------------------------------

async function run() {
    console.log(`\n🖼️  封面嵌入工具 (RIFF ID3 子块方式)`);
    console.log(`📂 扫描目录: ${targetDir}`);
    if (overwrite) console.log(`⚠️  覆盖模式: 将覆盖已有封面`);
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
    console.log('\n⏳ 正在检查封面...');
    const tasks = [];

    for (const file of audioFiles) {
        const coverPath = findCoverFile(file);
        const hasEmbedded = hasEmbeddedCover(file);

        if (coverPath && (!hasEmbedded || overwrite)) {
            tasks.push({
                file,
                coverPath,
                coverSize: fs.statSync(coverPath).size,
                hasExisting: hasEmbedded
            });
        }
    }

    if (tasks.length === 0) {
        console.log('\n✨ 所有文件都已嵌入封面，或没有可用的封面文件');
        return;
    }

    console.log(`   发现 ${tasks.length} 个文件需要嵌入封面`);

    // 输出计划
    console.log('\n' + '═'.repeat(60));
    console.log('📋 嵌入计划');
    console.log('═'.repeat(60));

    tasks.slice(0, 15).forEach((task, idx) => {
        const relPath = path.relative(targetDir, task.file);
        const coverName = path.basename(task.coverPath);
        const sizeKB = (task.coverSize / 1024).toFixed(1);
        console.log(`${idx + 1}. ${relPath}`);
        console.log(`   🖼️  ${coverName} (${sizeKB} KB)${task.hasExisting ? ' (覆盖)' : ''}`);
    });

    if (tasks.length > 15) {
        console.log(`\n   ... 还有 ${tasks.length - 15} 个文件`);
    }

    console.log('\n' + '═'.repeat(60));
    console.log(`📊 统计: 将为 ${tasks.length} 个 WAV 文件嵌入封面`);
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
    console.log('\n⏳ 正在嵌入封面...');
    let successCount = 0;
    let failCount = 0;
    const errors = [];

    for (let i = 0; i < tasks.length; i++) {
        const task = tasks[i];

        process.stdout.write(`\r   处理中: ${i + 1}/${tasks.length}`);

        const result = embedCover(task.file, task.coverPath);

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
