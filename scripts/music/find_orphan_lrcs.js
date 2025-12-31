/**
 * 脚本名称: Find Orphan LRCs (孤立歌词检测)
 * 功能描述: 扫描指定目录，检测没有对应音频文件的孤立歌词文件，生成清理脚本
 * 使用方法:
 *    node find_orphan_lrcs.js [目标目录]
 * 示例:
 *    node find_orphan_lrcs.js "/Volumes/CCSSD/Media/齐秦"
 */

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------
// 1. 配置
// ---------------------------------------------------------

const AUDIO_EXTENSIONS = new Set([
    '.mp3', '.flac', '.wav', '.m4a', '.ape', '.wma',
    '.dff', '.dsf', '.ogg', '.aac'
]);

// ---------------------------------------------------------
// 2. 工具函数
// ---------------------------------------------------------

/**
 * 扫描目录，检测孤立歌词文件
 * 规则：同目录下没有同名音频文件的 .lrc 文件视为孤立
 */
function findOrphanLrcs(dir, targetDir, results = [], visited = new Set()) {
    // 防止循环引用
    let realPath;
    try {
        realPath = fs.realpathSync(dir);
    } catch (e) {
        return results;
    }
    if (visited.has(realPath)) return results;
    visited.add(realPath);

    let items = [];
    try {
        items = fs.readdirSync(dir);
    } catch (e) {
        return results;
    }

    const lrcFiles = [];
    const audioBasenames = new Set();
    const subDirs = [];

    // 1. 遍历当前目录，分类文件
    items.forEach(item => {
        // 跳过隐藏文件
        if (item.startsWith('.')) return;
        // 跳过临时目录
        if (item.startsWith('_')) return;

        const fullPath = path.join(dir, item);
        try {
            const stat = fs.statSync(fullPath);
            if (stat.isDirectory()) {
                subDirs.push(fullPath);
            } else {
                const ext = path.extname(item).toLowerCase();
                const basename = path.basename(item, ext);

                if (ext === '.lrc') {
                    lrcFiles.push({
                        path: fullPath,
                        name: item,
                        basename: basename
                    });
                } else if (AUDIO_EXTENSIONS.has(ext)) {
                    // 存入小写以支持忽略大小写匹配
                    audioBasenames.add(basename.toLowerCase());
                }
            }
        } catch (e) {}
    });

    // 2. 检查 LRC 是否孤立（同目录下没有同名音频）
    lrcFiles.forEach(lrc => {
        if (!audioBasenames.has(lrc.basename.toLowerCase())) {
            results.push({
                path: lrc.path,
                name: lrc.name,
                relPath: path.relative(targetDir, lrc.path)
            });
        }
    });

    // 3. 递归处理子目录
    subDirs.forEach(subDir => {
        findOrphanLrcs(subDir, targetDir, results, visited);
    });

    return results;
}

// ---------------------------------------------------------
// 3. 主逻辑
// ---------------------------------------------------------

function run() {
    const targetDir = process.argv[2] || process.cwd();

    console.log(`\n🔍 孤立歌词检测工具`);
    console.log(`📂 扫描目录: ${targetDir}`);
    console.log('─'.repeat(50));

    if (!fs.existsSync(targetDir)) {
        console.error('❌ 目标目录不存在');
        process.exit(1);
    }

    console.log('\n⏳ 正在扫描文件...');

    const orphanLrcs = findOrphanLrcs(targetDir, targetDir);

    console.log(`   完成！发现 ${orphanLrcs.length} 个孤立歌词文件`);

    // ---------------------------------------------------------
    // 输出报告
    // ---------------------------------------------------------
    console.log('\n' + '═'.repeat(50));
    console.log('📊 检测报告');
    console.log('═'.repeat(50));

    if (orphanLrcs.length === 0) {
        console.log('\n✨ 完美！未发现孤立歌词文件。');
        return;
    }

    // 按目录分组显示
    const byDir = new Map();
    orphanLrcs.forEach(lrc => {
        const dir = path.dirname(lrc.relPath);
        if (!byDir.has(dir)) byDir.set(dir, []);
        byDir.get(dir).push(lrc);
    });

    console.log(`\n📄 孤立歌词文件 (${orphanLrcs.length} 个)`);

    let displayCount = 0;
    const MAX_DISPLAY = 30;

    for (const [dir, lrcs] of byDir) {
        if (displayCount >= MAX_DISPLAY) {
            console.log(`\n   ... 等 ${orphanLrcs.length - displayCount} 个更多文件`);
            break;
        }

        console.log(`\n   📁 ${dir || '(根目录)'}`);
        lrcs.forEach(lrc => {
            if (displayCount < MAX_DISPLAY) {
                console.log(`      ${lrc.name}`);
                displayCount++;
            }
        });
    }

    // ---------------------------------------------------------
    // 生成清理脚本
    // ---------------------------------------------------------
    console.log('\n' + '═'.repeat(50));
    console.log('📝 生成清理脚本');
    console.log('═'.repeat(50));

    const scriptPath = path.join(targetDir, '_cleanup_orphan_lrcs.sh');
    const tempDir = '_orphan_lrcs_temp';
    const lines = [];

    lines.push('#!/bin/bash');
    lines.push('# 孤立歌词清理脚本 (自动生成)');
    lines.push(`# 生成时间: ${new Date().toLocaleString()}`);
    lines.push(`# 扫描目录: ${targetDir}`);
    lines.push('#');
    lines.push('# ⚠️  此脚本将文件移动到 _orphan_lrcs_temp 目录，不会删除');
    lines.push('# 请检查后手动删除临时目录');
    lines.push('');
    lines.push('set -e');
    lines.push('');
    lines.push(`cd "${targetDir}"`);
    lines.push(`mkdir -p "./${tempDir}"`);
    lines.push('');

    lines.push('# ═══════════════════════════════════════');
    lines.push(`# 孤立歌词文件 (${orphanLrcs.length} 个)`);
    lines.push('# ═══════════════════════════════════════');
    lines.push('');

    orphanLrcs.forEach(lrc => {
        lines.push(`mv "./${lrc.relPath}" "./${tempDir}/" 2>/dev/null || true`);
    });

    lines.push('');
    lines.push('echo ""');
    lines.push('echo "✅ 清理完成！"');
    lines.push(`echo "📁 孤立歌词已移动到: ${tempDir}"`);
    lines.push(`echo "   共移动 ${orphanLrcs.length} 个文件"`);
    lines.push('echo "请检查后手动删除临时目录"');

    fs.writeFileSync(scriptPath, lines.join('\n'), { mode: 0o755 });
    console.log(`\n✅ 清理脚本已生成: ${scriptPath}`);
    console.log('\n执行清理:');
    console.log(`   cd "${targetDir}"`);
    console.log('   bash _cleanup_orphan_lrcs.sh');

    // 统计
    console.log(`\n📊 统计:`);
    console.log(`   孤立歌词: ${orphanLrcs.length} 个`);
    console.log(`   涉及目录: ${byDir.size} 个`);
}

// ---------------------------------------------------------
// 执行
// ---------------------------------------------------------
run();
