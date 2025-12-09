/**
 * 🎵 音乐文件查重与整理工具 (Music Duplicate Checker & Cleaner)
 *
 * 作用:
 * 1. 查重模式 (默认): 扫描指定目录，识别“实质相同”的音乐文件（忽略文件名中的修饰符、Live标记、副本后缀等）。
 *    - 智能识别: 能识别 "Song.mp3" 和 "Song (Live).flac" 为同一首，并建议保留最佳版本。
 *    - 安全机制: 不直接删除，而是生成隔离脚本 (move_duplicates.sh/bat)，供用户二次确认。
 *
 * 2. 空目录清理模式 (--empty): 扫描并删除空目录，或仅包含封面图(cover.jpg)的“伪空”目录。
 *    - 生成脚本: 生成 clean_dirs.sh/bat 执行删除操作。
 *
 * 使用方法:
 * - 查重模式:
 *   node check_duplicates.js "/path/to/music_folder"
 *
 * - 空目录清理模式:
 *   node check_duplicates.js --empty "/path/to/music_folder"
 *
 * 作者: devxiaofan
 */

const fs = require('fs');
const path = require('path');

// 检查是否为清理空目录模式
const isEmptyMode = process.argv.includes('--empty');
// 获取目标目录参数（排除 --empty 标志）
const args = process.argv.slice(2).filter(arg => arg !== '--empty');
const targetDir = args[0] || '.';
const absoluteTargetDir = path.resolve(targetDir);

// 支持的音乐格式列表
const MUSIC_EXTS = new Set([
    '.mp3', '.flac', '.wav', '.ape', '.m4a', '.wma', '.aac', '.ogg', '.dff', '.dsf'
]);

// ------------------------------------------------------------------
// 模式 2: 清理空目录模式 (--empty)
// ------------------------------------------------------------------
if (isEmptyMode) {
    console.log(`\n🧹 [清理模式] 开始扫描空目录: ${absoluteTargetDir}`);
    console.log(`   规则: 删除空目录，或仅包含 'cover.jpg' 的目录\n`);

    const emptyDirs = [];

    // 后序遍历：先子后父，这样才能正确识别“删了子目录后变空的父目录”
    function scanEmptyDirs(dir) {
        let items;
        try {
            items = fs.readdirSync(dir);
        } catch (err) {
            console.error(`❌ 无法读取目录 ${dir}: ${err.message}`);
            return false;
        }

        let hasValidFiles = false;

        items.forEach(item => {
            // 忽略系统隐藏文件 (Mac/Windows)
            if (item === '.DS_Store' || item === 'Thumbs.db' || item === 'Desktop.ini') return;

            const fullPath = path.join(dir, item);
            let stat;
            try {
                stat = fs.statSync(fullPath);
            } catch (e) { return; }

            if (stat.isDirectory()) {
                const isSubDirEmpty = scanEmptyDirs(fullPath);
                if (!isSubDirEmpty) {
                    hasValidFiles = true; // 子目录不空，父目录也就不能算空
                }
            } else {
                // 检查是否为允许残留的封面文件
                if (item.toLowerCase() === 'cover.jpg') {
                    // 忽略封面，不计入“有效文件”
                } else {
                    hasValidFiles = true; // 发现其他文件，标记为非空
                }
            }
        });

        // 如果没有有效文件（即为空，或只剩 cover.jpg），则标记为待删除
        if (!hasValidFiles) {
            // 根目录通常不删，除非用户指定的就是子目录
            if (dir !== absoluteTargetDir) {
                emptyDirs.push(dir);
            }
            return true; // 告诉父级：我是空的
        }
        return false;
    }

    scanEmptyDirs(absoluteTargetDir);

    if (emptyDirs.length === 0) {
        console.log('✅ 未发现符合删除条件的空目录。');
    } else {
        console.log(`⚠️ 发现 ${emptyDirs.length} 个空目录（含仅剩cover.jpg的目录）：`);

        const deleteCommands = [];
        if (process.platform === 'win32') {
            deleteCommands.push('@echo off');
            deleteCommands.push('echo Start deleting directories...');
        } else {
            deleteCommands.push('#!/bin/bash');
            deleteCommands.push('echo "Start deleting directories..."');
        }

        emptyDirs.forEach(d => {
            console.log(`   🗑️ ${d}`);
            if (process.platform === 'win32') {
                deleteCommands.push(`rd /s /q "${d}"`);
            } else {
                deleteCommands.push(`rm -rf "${d}"`);
            }
        });

        const scriptName = process.platform === 'win32' ? 'clean_dirs.bat' : 'clean_dirs.sh';
        const scriptPath = path.join(process.cwd(), scriptName);

        try {
            fs.writeFileSync(scriptPath, deleteCommands.join('\n'), { mode: 0o755 });
            console.log(`\n🛡️  已生成目录清理脚本: ${scriptPath}`);
            console.log(`   请检查后执行该脚本以删除目录。`);
        } catch (err) {
            console.error(`❌ 生成脚本失败: ${err.message}`);
        }
    }

    process.exit(0);
}

// ------------------------------------------------------------------
// 模式 1: 查重模式 (默认)
// ------------------------------------------------------------------

console.log(`\n🎵 开始扫描音乐目录: ${absoluteTargetDir}`);
console.log(`🎧 支持格式: ${Array.from(MUSIC_EXTS).join(', ')}\n`);

// 存储“清洗后文件名”到“原始文件列表”的映射
// Map<cleanName, Array<{ originalName, fullPath }>>
const musicMap = new Map();

/**
 * 文件名清洗标准化函数 (核心逻辑)
 * 用于提取歌曲的核心名称，忽略修饰符
 */
function getCleanName(filename) {
    // 1. 获取不带后缀的文件名
    let name = path.parse(filename).name;

    // 2. 转小写
    name = name.toLowerCase();

    // 3. 去除各类括号及其内容 (英文/中文括号, 中括号, 大括号)
    // 例如: "七里香(Live).mp3" -> "七里香"
    name = name.replace(/[\(\[\{（【][^\)\]\}）】]*[\)\]\}）】]/g, '');

    // 4. 去除常见的 Live/现场 后缀 (先去 Live，这样才能让后面的“副本”处理逻辑生效)
    // 必须小心，不能误删 "Alive" 这种词，所以严格限制前缀为 [空格 _ - (]
    const liveKeywords = ['live', 'concert', 'tour', 'unplugged', 'demo', '现场', '演唱会', '演出', '音乐会'];
    // 构造正则：允许 Live 后面跟空格、下划线、减号，而不仅是结尾
    const livePattern = new RegExp(`[\\s_\\-\\(（]+(${liveKeywords.join('|')})(?:[\\s_\\-\\)）]|$)`, 'gi');
    // 替换为空格，防止 "Song_live_副本" 变成 "Song副本" (导致无法匹配副本正则)
    name = name.replace(livePattern, ' ');

    // 5. 去除常见的“副本”、“Copy”及后续数字后缀
    // 例如: "Song_副本.mp3", "Song 副本 2.mp3", "Song copy.mp3"
    // 匹配模式：(空格或下划线)(副本|copy|拷贝)(空格或下划线或数字)* 结尾
    // 注意：因为 Live 后缀已经被去除，所以 "Song_副本_Live" 此时变成了 "Song_副本"，可以被此正则捕获
    name = name.replace(/[\s_]+(副本|copy|拷贝)[\s_\d]*$/i, '');

    // 6. 去除开头的数字序号和连接符
    // 例如: "01. 七里香" -> "七里香"
    name = name.replace(/^[\d\s\.\-]+/, '');

    // 7. 精准去除尾部的副本编号 (空格+数字, 或 括号+数字)
    // 之前的问题逻辑: name.replace(/[\s_]+\d+$/, '') 会误删正常的 Track Number (如 _01)
    // 现在的逻辑: 只删 " 2", " (1)", "(2)" 这种明确的副本标记
    name = name.replace(/(\s+\d+|\s*\(\d+\))$/g, '');

    // 8. 特殊处理：去除文件名中的 ".lrc" 字符串 (防止 "Song.lrc.flac" 无法匹配 "Song.flac")
    name = name.replace(/\.lrc/gi, '');

    // 9. 去除所有非核心字符（只保留中文、英文、数字）
    // 这一步能忽略掉空格、标点符号的差异
    name = name.replace(/[^\u4e00-\u9fa5a-z0-9]/g, '');

    return name;
}

/**
 * 格式化文件大小
 * @param {number} bytes
 * @returns {string}
 */
function formatSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * 递归遍历目录
 */
function scanDirectory(dir) {
    let files;
    try {
        files = fs.readdirSync(dir);
    } catch (err) {
        console.error(`❌ 无法读取目录 ${dir}: ${err.message}`);
        return;
    }

    files.forEach(file => {
        // 忽略隐藏文件和 node_modules
        if (file.startsWith('.') || file === 'node_modules') return;

        const fullPath = path.join(dir, file);
        let stat;

        try {
            stat = fs.statSync(fullPath);
        } catch (err) {
            console.error(`❌ 无法获取文件信息 ${fullPath}: ${err.message}`);
            return;
        }

        if (stat.isDirectory()) {
            scanDirectory(fullPath);
        } else if (stat.isFile()) {
            const ext = path.extname(file).toLowerCase();
            if (MUSIC_EXTS.has(ext)) {
                const cleanName = getCleanName(file);

                // 如果清洗后名字为空（例如文件名全是特殊符号），则用原名兜底
                const key = cleanName || file;

                if (!musicMap.has(key)) {
                    musicMap.set(key, []);
                }
                musicMap.get(key).push({
                    originalName: file,
                    fullPath: fullPath,
                    size: stat.size // 记录文件大小
                });
            }
        }
    });
}

/**
 * 检测是否为 Live/现场/演唱会 版本 (基于区间屏蔽算法)
 * @param {string} filename 原始文件名
 */
function isLiveVersion(filename) {
    const lowerName = filename.toLowerCase();

    // 1. 定义白名单短语 (这些短语中的 "Live" 不应被视为现场版标记)
    const exclusions = [
        'long live', 'live forever', 'live it up', 'love live',
        'live your life', 'live my life', 'live for', 'live a lie',
        'live to tell', 'live and let die', 'live wire', 'live high',
        'live like'
    ];

    // 2. 找出所有白名单短语的占用区间 [start, end)
    const blockedRanges = [];
    exclusions.forEach(ex => {
        let pos = lowerName.indexOf(ex);
        while (pos !== -1) {
            blockedRanges.push({ start: pos, end: pos + ex.length });
            // 继续查找下一个同名短语 (防止文件名出现两次 "long live")
            pos = lowerName.indexOf(ex, pos + 1);
        }
    });

    // 3. 定义检测函数：检查某个位置区间是否被屏蔽
    const isBlocked = (start, end) => {
        return blockedRanges.some(range => {
            // 只要关键词区间与屏蔽区间有重叠（通常是完全包含），就视为被屏蔽
            // 简单判断：关键词的中点在屏蔽区间内
            const mid = (start + end) / 2;
            return mid >= range.start && mid < range.end;
        });
    };

    // 4. 中文关键词检测 (直接匹配，但也检查是否被屏蔽 - 虽然中文白名单暂时为空)
    const cnKeywords = ['现场', '演唱会', '演出', '音乐会'];
    for (const kw of cnKeywords) {
        let pos = lowerName.indexOf(kw);
        while (pos !== -1) {
            if (!isBlocked(pos, pos + kw.length)) return true; // 发现有效关键词！
            pos = lowerName.indexOf(kw, pos + 1);
        }
    }

    // 5. 英文关键词检测 (正则匹配单词边界)
    const enKeywords = ['live', 'concert', 'tour', 'unplugged', 'demo'];
    // 构造全局正则
    const pattern = new RegExp(`(?:^|[^a-z0-9])(${enKeywords.join('|')})(?:$|[^a-z0-9])`, 'gi');

    let match;
    while ((match = pattern.exec(lowerName)) !== null) {
        // match[1] 是捕获组（关键词本身），match.index 是匹配项开始位置
        // 注意：正则匹配包含前后的边界字符，我们需要定位关键词本身的真实位置

        // 整个匹配串 (例如 " live ")
        const fullMatch = match[0];
        // 关键词 (例如 "live")
        const keyword = match[1];

        // 计算关键词在 fullMatch 中的相对偏移量
        const offset = fullMatch.indexOf(keyword);

        // 计算关键词在原字符串中的绝对位置
        const realStart = match.index + offset;
        const realEnd = realStart + keyword.length;

        // 检查这个关键词是否在白名单区间内
        if (!isBlocked(realStart, realEnd)) {
            return true; // 找到了一个不在白名单里的 Live 标记！
        }
    }

    return false;
}

// 执行扫描
scanDirectory(absoluteTargetDir);

// 分析结果
let duplicateCount = 0;
const results = [];

musicMap.forEach((fileList, cleanName) => {
    if (fileList.length > 1) {
        duplicateCount++;
        results.push({
            cleanName,
            files: fileList
        });
    }
});

// 输出结果
if (duplicateCount === 0) {
    console.log('✅ 未发现重复音乐文件。');
} else {
    console.log(`⚠️ 发现 ${duplicateCount} 组疑似重复歌曲：\n`);

    // 存储待删除命令
    const deleteCommands = [];
    // 存储报告内容
    const reportLines = [];

    function logReport(msg) {
        console.log(msg);
        reportLines.push(msg);
    }

    // 定义“回收站”目录名
    const TRASH_DIR_NAME = '_doubles_trash';

    if (process.platform === 'win32') {
        deleteCommands.push('@echo off');
        deleteCommands.push('echo Start moving files to trash folder...');
        deleteCommands.push(`if not exist "${TRASH_DIR_NAME}" mkdir "${TRASH_DIR_NAME}"`);
    } else {
        deleteCommands.push('#!/bin/bash');
        deleteCommands.push('echo "Start moving files to trash folder..."');
        deleteCommands.push(`mkdir -p "${TRASH_DIR_NAME}"`);

        // 定义智能移动函数 (处理文件名冲突)
        deleteCommands.push(`
safe_move() {
    src="$1"
    dest_dir="$2"
    filename=$(basename "$src")
    dest="$dest_dir/$filename"

    # 如果目标文件已存在，则添加时间戳后缀
    if [ -e "$dest" ]; then
        timestamp=$(date +%s)
        filename="\${filename%.*}_\${timestamp}.\${filename##*.}"
        dest="$dest_dir/$filename"
    fi

    mv "$src" "$dest"
    echo "Moved: $src -> $dest"
}
`);
    }

    reportLines.push(`扫描时间: ${new Date().toLocaleString()}`);
    reportLines.push(`扫描目录: ${absoluteTargetDir}`);
    reportLines.push(`发现重复组数: ${duplicateCount}\n`);
    reportLines.push('--------------------------------------------------');

    results.forEach((group, index) => {
        logReport(`🎵 [第 ${index + 1} 组] 核心识别词: "${group.cleanName}"`);

        // 1. 找出保留文件
        // 排序规则更新：
        // 优先级 1: 非 Live 版本优先保留
        // 优先级 2: 体积大的优先保留
        // 优先级 3: 文件名短的优先保留 (通常是原版)
        // 优先级 4: 不含“副本/copy”字样的优先保留
        group.files.sort((a, b) => {
            // 检查是否包含 Live 标识
            const isALive = isLiveVersion(a.originalName);
            const isBLive = isLiveVersion(b.originalName);

            // 1. 如果 A 是 Live 而 B 不是，则 B 优先 (返回正数，让 B 排前面)
            if (isALive && !isBLive) return 1;
            // 如果 A 不是 Live 而 B 是，则 A 优先 (返回负数，让 A 排前面)
            if (!isALive && isBLive) return -1;

            // 2. 如果 Live 状态相同（都是或都不是），则按大小降序排列
            if (a.size !== b.size) {
                return b.size - a.size;
            }

            // 3. 大小也相同，优先保留文件名短的 (通常是原版，如 "Song.mp3" vs "Song (1).mp3")
            if (a.originalName.length !== b.originalName.length) {
                return a.originalName.length - b.originalName.length;
            }

            // 4. 如果长度也一样，检查是否包含“副本”字样，不含的优先
            const reCopy = /(副本|copy|拷贝)/i;
            const aHasCopy = reCopy.test(a.originalName);
            const bHasCopy = reCopy.test(b.originalName);
            if (aHasCopy && !bHasCopy) return 1;
            if (!aHasCopy && bHasCopy) return -1;

            return 0;
        });

        const keepFile = group.files[0];
        const deleteFiles = group.files.slice(1);

        // 打印保留文件
        const keepSizeStr = formatSize(keepFile.size);
        const keepLiveTag = isLiveVersion(keepFile.originalName) ? ' [Live/现场]' : '';
        logReport(`   ✅ [保留] ${keepFile.originalName}${keepLiveTag} (${keepSizeStr})`);

        // 打印并记录待删除文件
        deleteFiles.forEach(f => {
            const sizeStr = formatSize(f.size);
            const isLive = isLiveVersion(f.originalName);
            const liveTag = isLive ? ' [Live/现场]' : '';

            // 如果是因为 Live 被删的（且保留文件不是Live），额外标注原因
            const reason = (isLive && !isLiveVersion(keepFile.originalName))
                ? ' 🎤 [Live版优先删除]'
                : '';

            logReport(`   ❌ [建议移除] ${f.originalName}${liveTag} (${sizeStr})${reason}`);

            // 生成移动命令 (而非删除)
            if (process.platform === 'win32') {
                // Windows 简单处理：移动到 _doubles_trash 目录
                deleteCommands.push(`move "${f.fullPath}" "${TRASH_DIR_NAME}\\"`);
            } else {
                // Mac/Linux 使用 safe_move 函数
                deleteCommands.push(`safe_move "${f.fullPath}" "${TRASH_DIR_NAME}"`);
            }

            // --- 检查关联的 LRC 歌词文件 ---
            // 逻辑：同目录 + 同文件名(仅后缀不同)
            const ext = path.extname(f.originalName);
            const baseName = f.originalName.slice(0, -ext.length); // 去除后缀的文件名
            const lrcName = baseName + '.lrc';
            const lrcPath = path.join(path.dirname(f.fullPath), lrcName);

            if (fs.existsSync(lrcPath)) {
                logReport(`      🗑️ [关联移除] ${lrcName} (LRC歌词)`);
                if (process.platform === 'win32') {
                    deleteCommands.push(`move "${lrcPath}" "${TRASH_DIR_NAME}\\"`);
                } else {
                    deleteCommands.push(`safe_move "${lrcPath}" "${TRASH_DIR_NAME}"`);
                }
            }
        });

        logReport('--------------------------------------------------');
    });

    // 写入删除脚本文件
    const scriptName = process.platform === 'win32' ? 'move_duplicates.bat' : 'move_duplicates.sh';
    const scriptPath = path.join(process.cwd(), scriptName);

    // 写入报告文件
    const reportPath = path.join(process.cwd(), 'duplicates_report.txt');

    try {
        fs.writeFileSync(scriptPath, deleteCommands.join('\n'), { mode: 0o755 });
        fs.writeFileSync(reportPath, reportLines.join('\n')); // 写入报告

        console.log(`\n📊 扫描完成，共找到 ${duplicateCount} 组重复文件。`);
        console.log(`📝 详细报告已生成: ${reportPath} (推荐用文本编辑器查看)`);
        console.log(`🛡️  已生成文件隔离脚本: ${scriptPath}`);
        console.log(`   运行该脚本会将所有建议删除的文件移动到当前目录下的 '${TRASH_DIR_NAME}' 文件夹中。`);
        console.log(`   请在确认无误后，手动删除该文件夹。`);
        console.log(`\n💡 提示: 执行完隔离脚本后，您可以运行以下命令来清理空目录:`);
        console.log(`   node check_duplicates.js --empty "${targetDir}"`);
    } catch (err) {
        console.error(`❌ 生成脚本/报告失败: ${err.message}`);
    }
}
