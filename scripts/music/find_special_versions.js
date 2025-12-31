/**
 * 脚本名称: Find Special Versions (特殊版本检测)
 * 功能描述: 扫描指定目录，检测包含 Live/伴奏/序曲 等关键词的音乐文件，生成清理脚本
 * 使用方法:
 *    node find_special_versions.js [目标目录]
 * 示例:
 *    node find_special_versions.js "/Volumes/CCSSD/Media/齐秦"
 *    cd /Volumes/CCSSD/Media/齐秦 && node /path/to/find_special_versions.js
 */

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------
// 1. 配置
// ---------------------------------------------------------

const AUDIO_EXTENSIONS = /\.(mp3|m4a|flac|wav|wma|ape)$/i;
const LRC_EXTENSION = /\.lrc$/i;

// 关键词分类
const KEYWORDS = {
    live: {
        patterns: [
            /(?<![a-zA-Z])live(?![a-zA-Z])/i,  // live 前后不能是字母，避免匹配 Oliver/delivery
            /演唱会/,
            /现场版/,
            /现场/
        ],
        dir: 'live',
        label: '现场版'
    },
    instrumental: {
        patterns: [
            /伴奏/,
            /纯音乐/,
            /纯享/
        ],
        dir: '伴奏',
        label: '伴奏/纯音乐'
    },
    intro: {
        patterns: [
            /intro/i,              // 英文 Intro（包含匹配，不区分大小写）
            /序曲/
        ],
        dir: 'intro',
        label: '序曲'
    }
};

// ---------------------------------------------------------
// 2. 工具函数
// ---------------------------------------------------------

/**
 * 递归查找目录下的所有文件
 */
function findAllFiles(dir) {
    let results = [];
    try {
        if (!fs.existsSync(dir)) return [];
        const list = fs.readdirSync(dir);

        list.forEach(file => {
            if (file.startsWith('.')) return; // 忽略隐藏文件

            const fullPath = path.join(dir, file);
            try {
                const stat = fs.statSync(fullPath);
                if (stat.isDirectory()) {
                    // 跳过临时目录
                    if (file.startsWith('_')) return;
                    results = results.concat(findAllFiles(fullPath));
                } else {
                    results.push(fullPath);
                }
            } catch (e) {}
        });
    } catch (e) {}
    return results;
}

/**
 * 检测文件名是否匹配关键词，返回匹配的类别
 */
function detectCategory(fileName) {
    // 去扩展名检测
    const ext = path.extname(fileName);
    const nameNoExt = path.basename(fileName, ext);

    for (const [category, config] of Object.entries(KEYWORDS)) {
        for (const pattern of config.patterns) {
            if (pattern.test(nameNoExt)) {
                return {
                    category,
                    dir: config.dir,
                    label: config.label,
                    matchedPattern: pattern.toString()
                };
            }
        }
    }
    return null;
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
    // 解析目标目录
    const targetDir = process.argv[2] || process.cwd();

    console.log(`\n🔍 特殊版本检测工具`);
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
        const name = path.basename(f);
        if (AUDIO_EXTENSIONS.test(name)) {
            audioFiles.push(f);
        } else if (LRC_EXTENSION.test(name)) {
            lrcIndex.set(f, true);
        }
    });

    console.log(`   音频文件: ${audioFiles.length} 个`);
    console.log(`   歌词文件: ${lrcIndex.size} 个`);

    if (audioFiles.length === 0) {
        console.log('\n✨ 未找到音频文件');
        return;
    }

    // 检测特殊版本
    console.log('\n🎵 检测特殊版本文件...');

    const results = {
        live: [],
        instrumental: [],
        intro: []
    };

    audioFiles.forEach(f => {
        const fileName = path.basename(f);
        const match = detectCategory(fileName);

        if (match) {
            const lrcPath = findAssociatedLrc(f, lrcIndex);
            results[match.category].push({
                path: f,
                name: fileName,
                lrcPath: lrcPath,
                label: match.label
            });
        }
    });

    const totalFound = results.live.length + results.instrumental.length + results.intro.length;
    console.log(`   完成！发现 ${totalFound} 个特殊版本文件`);

    // ---------------------------------------------------------
    // 输出报告
    // ---------------------------------------------------------
    console.log('\n' + '═'.repeat(50));
    console.log('📊 检测报告');
    console.log('═'.repeat(50));

    // 现场版
    if (results.live.length > 0) {
        console.log(`\n🎤 现场版 (${results.live.length} 首)`);
        results.live.forEach((f, idx) => {
            const relPath = path.relative(targetDir, f.path);
            console.log(`   ${idx + 1}. ${relPath}`);
            if (f.lrcPath) {
                console.log(`      📝 歌词: ${path.basename(f.lrcPath)}`);
            }
        });
    }

    // 伴奏/纯音乐
    if (results.instrumental.length > 0) {
        console.log(`\n🎹 伴奏/纯音乐 (${results.instrumental.length} 首)`);
        results.instrumental.forEach((f, idx) => {
            const relPath = path.relative(targetDir, f.path);
            console.log(`   ${idx + 1}. ${relPath}`);
            if (f.lrcPath) {
                console.log(`      📝 歌词: ${path.basename(f.lrcPath)}`);
            }
        });
    }

    // 序曲
    if (results.intro.length > 0) {
        console.log(`\n🎼 序曲 (${results.intro.length} 首)`);
        results.intro.forEach((f, idx) => {
            const relPath = path.relative(targetDir, f.path);
            console.log(`   ${idx + 1}. ${relPath}`);
            if (f.lrcPath) {
                console.log(`      📝 歌词: ${path.basename(f.lrcPath)}`);
            }
        });
    }

    if (totalFound === 0) {
        console.log('\n✨ 完美！未发现特殊版本文件。');
        return;
    }

    // ---------------------------------------------------------
    // 生成清理脚本
    // ---------------------------------------------------------
    console.log('\n' + '═'.repeat(50));
    console.log('📝 生成清理脚本');
    console.log('═'.repeat(50));

    const scriptPath = path.join(targetDir, '_cleanup_special_versions.sh');
    const tempDir = '_special_versions_temp';
    const lines = [];

    lines.push('#!/bin/bash');
    lines.push('# 特殊版本清理脚本 (自动生成)');
    lines.push(`# 生成时间: ${new Date().toLocaleString()}`);
    lines.push(`# 扫描目录: ${targetDir}`);
    lines.push('#');
    lines.push('# ⚠️  此脚本将文件移动到 _special_versions_temp 目录，不会删除');
    lines.push('# 请检查后手动删除临时目录');
    lines.push('');
    lines.push('set -e');
    lines.push('');
    lines.push(`cd "${targetDir}"`);
    lines.push('');

    // 现场版
    if (results.live.length > 0) {
        lines.push('# ═══════════════════════════════════════');
        lines.push(`# 现场版 (${results.live.length} 首)`);
        lines.push('# ═══════════════════════════════════════');
        lines.push(`mkdir -p "./${tempDir}"`);
        lines.push('');

        results.live.forEach(f => {
            const relPath = path.relative(targetDir, f.path);
            lines.push(`mv "./${relPath}" "./${tempDir}/" 2>/dev/null || true`);
            if (f.lrcPath) {
                const lrcRelPath = path.relative(targetDir, f.lrcPath);
                lines.push(`mv "./${lrcRelPath}" "./${tempDir}/" 2>/dev/null || true`);
            }
        });
        lines.push('');
    }

    // 伴奏/纯音乐
    if (results.instrumental.length > 0) {
        lines.push('# ═══════════════════════════════════════');
        lines.push(`# 伴奏/纯音乐 (${results.instrumental.length} 首)`);
        lines.push('# ═══════════════════════════════════════');
        lines.push(`mkdir -p "./${tempDir}"`);
        lines.push('');

        results.instrumental.forEach(f => {
            const relPath = path.relative(targetDir, f.path);
            lines.push(`mv "./${relPath}" "./${tempDir}/" 2>/dev/null || true`);
            if (f.lrcPath) {
                const lrcRelPath = path.relative(targetDir, f.lrcPath);
                lines.push(`mv "./${lrcRelPath}" "./${tempDir}/" 2>/dev/null || true`);
            }
        });
        lines.push('');
    }

    // 序曲
    if (results.intro.length > 0) {
        lines.push('# ═══════════════════════════════════════');
        lines.push(`# 序曲 (${results.intro.length} 首)`);
        lines.push('# ═══════════════════════════════════════');
        lines.push(`mkdir -p "./${tempDir}"`);
        lines.push('');

        results.intro.forEach(f => {
            const relPath = path.relative(targetDir, f.path);
            lines.push(`mv "./${relPath}" "./${tempDir}/" 2>/dev/null || true`);
            if (f.lrcPath) {
                const lrcRelPath = path.relative(targetDir, f.lrcPath);
                lines.push(`mv "./${lrcRelPath}" "./${tempDir}/" 2>/dev/null || true`);
            }
        });
        lines.push('');
    }

    lines.push('echo ""');
    lines.push('echo "✅ 清理完成！"');
    lines.push(`echo "📁 特殊版本已移动到: ${tempDir}"`);
    lines.push('echo "请检查后手动删除临时目录"');

    fs.writeFileSync(scriptPath, lines.join('\n'), { mode: 0o755 });
    console.log(`\n✅ 清理脚本已生成: ${scriptPath}`);
    console.log('\n执行清理:');
    console.log(`   cd "${targetDir}"`);
    console.log('   bash _cleanup_special_versions.sh');

    // 统计
    console.log(`\n📊 统计:`);
    console.log(`   现场版: ${results.live.length} 首`);
    console.log(`   伴奏/纯音乐: ${results.instrumental.length} 首`);
    console.log(`   序曲: ${results.intro.length} 首`);
    console.log(`   总计待移动: ${totalFound} 个文件`);
}

// ---------------------------------------------------------
// 执行
// ---------------------------------------------------------
run();
