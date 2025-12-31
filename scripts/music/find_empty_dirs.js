/**
 * 脚本名称: Find Empty Dirs (空目录检测)
 * 功能描述: 扫描指定目录，检测空目录和无歌曲目录，生成清理脚本
 * 使用方法:
 *    node find_empty_dirs.js [目标目录]
 * 示例:
 *    node find_empty_dirs.js "/Volumes/CCSSD/Media/齐秦"
 */

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------
// 1. 配置
// ---------------------------------------------------------

const AUDIO_EXTENSIONS = /\.(mp3|m4a|flac|wav|wma|ape)$/i;

// 忽略的隐藏文件模式（以 . 开头）
const IGNORED_FILES = /^\..+$/;

// ---------------------------------------------------------
// 2. 工具函数
// ---------------------------------------------------------

/**
 * 检查目录状态（不递归）
 * 返回: { files, dirs, hasAudio }
 */
function checkDirStatus(dir) {
    const result = {
        files: [],
        dirs: [],
        hasAudio: false
    };

    try {
        const items = fs.readdirSync(dir);

        for (const item of items) {
            // 跳过隐藏文件
            if (IGNORED_FILES.test(item)) continue;
            // 跳过临时目录
            if (item.startsWith('_')) continue;

            const fullPath = path.join(dir, item);
            try {
                const stat = fs.statSync(fullPath);

                if (stat.isDirectory()) {
                    result.dirs.push(fullPath);
                } else if (stat.isFile()) {
                    result.files.push(fullPath);
                    if (AUDIO_EXTENSIONS.test(item)) {
                        result.hasAudio = true;
                    }
                }
            } catch (e) {}
        }
    } catch (e) {}

    return result;
}

/**
 * 递归检查目录是否实际为空（子目录全空也算空）
 * 返回: { effectivelyEmpty, hasAudioDeep }
 */
function checkDirDeep(dir) {
    const status = checkDirStatus(dir);

    // 没有子目录且没有文件，是空目录
    if (status.files.length === 0 && status.dirs.length === 0) {
        return {
            effectivelyEmpty: true,
            hasAudioDeep: false
        };
    }

    // 递归检查所有子目录
    let allSubdirsEmpty = true;
    let anySubdirHasAudio = false;

    for (const subdir of status.dirs) {
        const subResult = checkDirDeep(subdir);
        if (!subResult.effectivelyEmpty) {
            allSubdirsEmpty = false;
        }
        if (subResult.hasAudioDeep) {
            anySubdirHasAudio = true;
        }
    }

    // 有文件时，不是空目录
    if (status.files.length > 0) {
        return {
            effectivelyEmpty: false,
            // 当前目录有音频 或 子目录有音频
            hasAudioDeep: status.hasAudio || anySubdirHasAudio
        };
    }

    // 只有子目录，没有文件
    return {
        effectivelyEmpty: allSubdirsEmpty,
        hasAudioDeep: anySubdirHasAudio
    };
}

/**
 * 收集所有需要处理的目录
 */
function collectDirs(dir, targetDir, emptyDirs, noAudioDirs, visited = new Set()) {
    // 防止循环引用
    let realPath;
    try {
        realPath = fs.realpathSync(dir);
    } catch (e) {
        return;
    }
    if (visited.has(realPath)) return;
    visited.add(realPath);

    const status = checkDirStatus(dir);
    const deepStatus = checkDirDeep(dir);

    // 如果是实际空目录（含子目录全空的情况）
    if (deepStatus.effectivelyEmpty) {
        emptyDirs.push({
            path: dir,
            relPath: path.relative(targetDir, dir)
        });
        return; // 整个目录会被删除，不需要继续递归
    }

    // 如果目录有文件但整个目录树都没有音频文件
    if (status.files.length > 0 && !deepStatus.hasAudioDeep) {
        noAudioDirs.push({
            path: dir,
            relPath: path.relative(targetDir, dir),
            fileCount: status.files.length
        });
        return; // 整个目录会被删除
    }

    // 递归处理子目录
    for (const subdir of status.dirs) {
        collectDirs(subdir, targetDir, emptyDirs, noAudioDirs, visited);
    }
}

// ---------------------------------------------------------
// 3. 主逻辑
// ---------------------------------------------------------

function run() {
    const targetDir = process.argv[2] || process.cwd();

    console.log(`\n🔍 空目录检测工具`);
    console.log(`📂 扫描目录: ${targetDir}`);
    console.log('─'.repeat(50));

    if (!fs.existsSync(targetDir)) {
        console.error('❌ 目标目录不存在');
        process.exit(1);
    }

    console.log('\n⏳ 正在扫描目录...');

    const emptyDirs = [];
    const noAudioDirs = [];

    // 获取一级子目录开始扫描（不扫描根目录本身）
    const rootStatus = checkDirStatus(targetDir);
    for (const subdir of rootStatus.dirs) {
        collectDirs(subdir, targetDir, emptyDirs, noAudioDirs);
    }

    console.log(`   完成！`);

    // ---------------------------------------------------------
    // 输出报告
    // ---------------------------------------------------------
    console.log('\n' + '═'.repeat(50));
    console.log('📊 检测报告');
    console.log('═'.repeat(50));

    // 空目录
    if (emptyDirs.length > 0) {
        console.log(`\n📁 空目录 (${emptyDirs.length} 个)`);
        emptyDirs.forEach((d, idx) => {
            console.log(`   ${idx + 1}. ${d.relPath}`);
        });
    }

    // 无歌曲目录
    if (noAudioDirs.length > 0) {
        console.log(`\n📁 无歌曲目录 (${noAudioDirs.length} 个)`);
        noAudioDirs.forEach((d, idx) => {
            console.log(`   ${idx + 1}. ${d.relPath} (${d.fileCount} 个文件)`);
        });
    }

    const totalFound = emptyDirs.length + noAudioDirs.length;
    if (totalFound === 0) {
        console.log('\n✨ 完美！未发现空目录或无歌曲目录。');
        return;
    }

    // ---------------------------------------------------------
    // 生成清理脚本
    // ---------------------------------------------------------
    console.log('\n' + '═'.repeat(50));
    console.log('📝 生成清理脚本');
    console.log('═'.repeat(50));

    const scriptPath = path.join(targetDir, '_cleanup_empty_dirs.sh');
    const lines = [];

    lines.push('#!/bin/bash');
    lines.push('# 空目录清理脚本 (自动生成)');
    lines.push(`# 生成时间: ${new Date().toLocaleString()}`);
    lines.push(`# 扫描目录: ${targetDir}`);
    lines.push('#');
    lines.push('# ⚠️  此脚本将直接删除目录，请确认后再执行');
    lines.push('');
    lines.push('set -e');
    lines.push('');
    lines.push(`cd "${targetDir}"`);
    lines.push('');

    // 空目录
    if (emptyDirs.length > 0) {
        lines.push('# ═══════════════════════════════════════');
        lines.push(`# 空目录 (${emptyDirs.length} 个)`);
        lines.push('# ═══════════════════════════════════════');
        lines.push('');

        emptyDirs.forEach(d => {
            lines.push(`rm -rf "./${d.relPath}"`);
        });
        lines.push('');
    }

    // 无歌曲目录
    if (noAudioDirs.length > 0) {
        lines.push('# ═══════════════════════════════════════');
        lines.push(`# 无歌曲目录 (${noAudioDirs.length} 个)`);
        lines.push('# ═══════════════════════════════════════');
        lines.push('');

        noAudioDirs.forEach(d => {
            lines.push(`rm -rf "./${d.relPath}"`);
        });
        lines.push('');
    }

    lines.push('echo ""');
    lines.push('echo "✅ 清理完成！"');
    lines.push(`echo "   删除空目录: ${emptyDirs.length} 个"`);
    lines.push(`echo "   删除无歌曲目录: ${noAudioDirs.length} 个"`);

    fs.writeFileSync(scriptPath, lines.join('\n'), { mode: 0o755 });
    console.log(`\n✅ 清理脚本已生成: ${scriptPath}`);
    console.log('\n执行清理:');
    console.log(`   cd "${targetDir}"`);
    console.log('   bash _cleanup_empty_dirs.sh');

    // 统计
    console.log(`\n📊 统计:`);
    console.log(`   空目录: ${emptyDirs.length} 个`);
    console.log(`   无歌曲目录: ${noAudioDirs.length} 个`);
    console.log(`   总计待删除: ${totalFound} 个目录`);
}

// ---------------------------------------------------------
// 执行
// ---------------------------------------------------------
run();
