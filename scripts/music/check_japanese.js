/**
 * 脚本名称: Check Japanese (日语歌曲检测)
 * 功能描述: 扫描指定目录，通过假名识别日语歌曲，生成清理脚本
 * 使用方法:
 *    node check_japanese.js [目标目录]
 * 示例:
 *    node check_japanese.js "/Volumes/CCSSD/Media/齐秦"
 *
 * 识别原理:
 *   检测文件名中是否包含日语特有的字符:
 *   - 平假名 (Hiragana): \u3040-\u309F
 *   - 片假名 (Katakana): \u30A0-\u30FF
 *   - 片假名扩展: \u31F0-\u31FF
 *
 * 注意: 仅包含汉字的日语歌名无法与中文区分，但绝大多数日语文件名都会包含假名
 */

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------
// 1. 配置
// ---------------------------------------------------------

const AUDIO_EXTENSIONS = /\.(mp3|m4a|flac|wav|wma|ape|aac|ogg|dff|dsf)$/i;
const LRC_EXTENSION = /\.lrc$/i;

// 日语字符正则 (平假名 + 片假名 + 扩展片假名)
const JAPANESE_REGEX = /[\u3040-\u309F\u30A0-\u30FF\u31F0-\u31FF]/;

// ---------------------------------------------------------
// 2. 工具函数
// ---------------------------------------------------------

/**
 * 递归查找目录下的所有文件
 */
function findAllFiles(dir, visited = new Set()) {
    let results = [];

    // 防止循环引用
    let realPath;
    try {
        realPath = fs.realpathSync(dir);
    } catch (e) {
        return results;
    }
    if (visited.has(realPath)) return results;
    visited.add(realPath);

    try {
        const list = fs.readdirSync(dir);

        list.forEach(file => {
            // 跳过隐藏文件
            if (file.startsWith('.')) return;
            // 跳过临时目录
            if (file.startsWith('_')) return;

            const fullPath = path.join(dir, file);
            try {
                const stat = fs.statSync(fullPath);
                if (stat.isDirectory()) {
                    results = results.concat(findAllFiles(fullPath, visited));
                } else {
                    results.push({
                        path: fullPath,
                        name: file,
                        size: stat.size
                    });
                }
            } catch (e) {}
        });
    } catch (e) {}

    return results;
}

/**
 * 查找同目录下的同名歌词文件
 */
function findAssociatedLrc(audioPath, lrcIndex) {
    const dir = path.dirname(audioPath);
    const baseName = path.basename(audioPath, path.extname(audioPath));
    const lrcPath = path.join(dir, baseName + '.lrc');

    if (lrcIndex.has(lrcPath)) {
        return lrcPath;
    }
    return null;
}

// ---------------------------------------------------------
// 3. 主逻辑
// ---------------------------------------------------------

function run() {
    const targetDir = process.argv[2] || process.cwd();

    console.log(`\n🇯🇵 日语歌曲检测工具`);
    console.log(`📂 扫描目录: ${targetDir}`);
    console.log('─'.repeat(50));

    if (!fs.existsSync(targetDir)) {
        console.error('❌ 目标目录不存在');
        process.exit(1);
    }

    // 扫描所有文件
    console.log('\n⏳ 正在扫描文件...');
    const allFiles = findAllFiles(targetDir);

    // 分类：音频 vs 歌词
    const audioFiles = [];
    const lrcIndex = new Map();

    allFiles.forEach(f => {
        if (AUDIO_EXTENSIONS.test(f.name)) {
            audioFiles.push(f);
        } else if (LRC_EXTENSION.test(f.name)) {
            lrcIndex.set(f.path, true);
        }
    });

    console.log(`   音频文件: ${audioFiles.length} 个`);
    console.log(`   歌词文件: ${lrcIndex.size} 个`);

    if (audioFiles.length === 0) {
        console.log('\n✨ 未找到音频文件');
        return;
    }

    // 检测日语歌曲
    console.log('\n🎵 检测日语歌曲 (假名匹配)...');

    const japaneseFiles = [];

    audioFiles.forEach(f => {
        const nameWithoutExt = path.parse(f.name).name;

        if (JAPANESE_REGEX.test(nameWithoutExt)) {
            const lrcPath = findAssociatedLrc(f.path, lrcIndex);
            japaneseFiles.push({
                path: f.path,
                name: f.name,
                size: f.size,
                lrcPath: lrcPath
            });
        }
    });

    console.log(`   完成！发现 ${japaneseFiles.length} 首日语歌曲`);

    // ---------------------------------------------------------
    // 输出报告
    // ---------------------------------------------------------
    console.log('\n' + '═'.repeat(50));
    console.log('📊 检测报告');
    console.log('═'.repeat(50));

    if (japaneseFiles.length === 0) {
        console.log('\n✨ 完美！未发现日语歌曲文件。');
        return;
    }

    console.log(`\n🌸 日语歌曲 (${japaneseFiles.length} 首)`);

    japaneseFiles.forEach((f, idx) => {
        const relPath = path.relative(targetDir, f.path);
        const sizeMB = (f.size / 1024 / 1024).toFixed(2);
        console.log(`   ${idx + 1}. ${relPath} (${sizeMB}MB)`);
        if (f.lrcPath) {
            console.log(`      📝 歌词: ${path.basename(f.lrcPath)}`);
        }
    });

    // ---------------------------------------------------------
    // 生成清理脚本
    // ---------------------------------------------------------
    console.log('\n' + '═'.repeat(50));
    console.log('📝 生成清理脚本');
    console.log('═'.repeat(50));

    const scriptPath = path.join(targetDir, '_cleanup_japanese.sh');
    const tempDir = '_japanese_temp';
    const lines = [];

    lines.push('#!/bin/bash');
    lines.push('# 日语歌曲清理脚本 (自动生成)');
    lines.push(`# 生成时间: ${new Date().toLocaleString()}`);
    lines.push(`# 扫描目录: ${targetDir}`);
    lines.push('#');
    lines.push('# ⚠️  此脚本将文件移动到 _japanese_temp 目录，不会删除');
    lines.push('# 请检查后手动删除临时目录');
    lines.push('');
    lines.push('set -e');
    lines.push('');
    lines.push(`cd "${targetDir}"`);
    lines.push(`mkdir -p "./${tempDir}"`);
    lines.push('');

    lines.push('# ═══════════════════════════════════════');
    lines.push(`# 日语歌曲 (${japaneseFiles.length} 首)`);
    lines.push('# ═══════════════════════════════════════');
    lines.push('');

    japaneseFiles.forEach(f => {
        const relPath = path.relative(targetDir, f.path);
        lines.push(`mv "./${relPath}" "./${tempDir}/" 2>/dev/null || true`);
        if (f.lrcPath) {
            const lrcRelPath = path.relative(targetDir, f.lrcPath);
            lines.push(`mv "./${lrcRelPath}" "./${tempDir}/" 2>/dev/null || true`);
        }
    });

    lines.push('');
    lines.push('echo ""');
    lines.push('echo "✅ 清理完成！"');
    lines.push(`echo "📁 日语歌曲已移动到: ${tempDir}"`);
    lines.push('echo "请检查后手动删除临时目录"');

    fs.writeFileSync(scriptPath, lines.join('\n'), { mode: 0o755 });
    console.log(`\n✅ 清理脚本已生成: ${scriptPath}`);
    console.log('\n执行清理:');
    console.log(`   cd "${targetDir}"`);
    console.log('   bash _cleanup_japanese.sh');

    // 统计
    const lrcCount = japaneseFiles.filter(f => f.lrcPath).length;
    console.log(`\n📊 统计:`);
    console.log(`   日语歌曲: ${japaneseFiles.length} 首`);
    console.log(`   关联歌词: ${lrcCount} 个`);
    console.log(`   待移动文件: ${japaneseFiles.length + lrcCount} 个`);
}

// ---------------------------------------------------------
// 执行
// ---------------------------------------------------------
run();
