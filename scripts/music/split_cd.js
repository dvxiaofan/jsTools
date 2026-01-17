const fs = require('fs');
const path = require('path');

const AUDIO_EXTENSIONS = /\.(mp3|m4a|flac|wav|wma|ape)$/i;
const LRC_EXTENSION = /\.lrc$/i;

function parseArgs() {
    const args = process.argv.slice(2);
    const result = {
        dir: null,
        size: 100,
        dryRun: false,
        playlistOnly: false
    };

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        const next = args[i + 1];

        if (!arg.startsWith('-') && !result.dir) {
            result.dir = arg;
            continue;
        }

        switch (arg) {
            case '-n':
            case '--size':
                if (next && !isNaN(parseInt(next, 10))) {
                    result.size = Math.max(1, parseInt(next, 10));
                    i++;
                }
                break;
            case '--dry-run':
                result.dryRun = true;
                break;
            case '--playlist-only':
                result.playlistOnly = true;
                break;
            case '-h':
            case '--help':
                printHelp();
                process.exit(0);
        }
    }

    return result;
}

function printHelp() {
    console.log(`
🎵 目录拆分工具

用法:
  node split_cd.js "/path/to/dir" [-n 每个子目录数量] [--dry-run]
  node split_cd.js "/path/to/dir" --playlist-only [--dry-run]

示例:
  node split_cd.js "/Volumes/otherMusic/某歌手" -n 100
  node split_cd.js "/Volumes/otherMusic/某歌手" -n 80 --dry-run
  node split_cd.js "/Volumes/otherMusic/某歌手" --playlist-only
`);
}

function getAudioFiles(dir) {
    const songs = [];
    try {
        if (!fs.existsSync(dir)) return songs;
        const items = fs.readdirSync(dir, { withFileTypes: true });
        for (const item of items) {
            if (item.name.startsWith('.') || item.name.startsWith('_')) continue;
            if (!item.isFile()) continue;
            if (!AUDIO_EXTENSIONS.test(item.name)) continue;
            const audioPath = path.join(dir, item.name);
            const baseName = path.basename(item.name, path.extname(item.name));
            const lrcPath = path.join(dir, baseName + '.lrc');
            let lrc = null;
            try {
                if (fs.existsSync(lrcPath) && fs.statSync(lrcPath).isFile() && LRC_EXTENSION.test(lrcPath)) {
                    lrc = lrcPath;
                }
            } catch (e) {}
            songs.push({ audio: audioPath, lrc });
        }
    } catch (e) {}
    return songs.sort((a, b) => path.basename(a.audio).localeCompare(path.basename(b.audio), 'zh-CN'));
}

function ensureCdDir(baseDir, index) {
    const name = `CD${index}`;
    const dir = path.join(baseDir, name);
    if (!fs.existsSync(dir)) {
        try {
            fs.mkdirSync(dir, { recursive: true });
        } catch (e) {
            console.error(`❌ 无法创建目录: ${dir}`);
            process.exit(1);
        }
    }
    return dir;
}

function getCdDirs(baseDir) {
    try {
        if (!fs.existsSync(baseDir)) return [];
        const items = fs.readdirSync(baseDir, { withFileTypes: true });
        const dirs = items
            .filter(item => item.isDirectory() && /^CD\d+$/i.test(item.name))
            .map(item => item.name);
        return dirs.sort((a, b) => {
            const na = parseInt(a.slice(2), 10) || 0;
            const nb = parseInt(b.slice(2), 10) || 0;
            return na - nb;
        });
    } catch (e) {
        return [];
    }
}

function buildPlaylistForDir(cdDir, dryRun) {
    let items;
    try {
        items = fs.readdirSync(cdDir, { withFileTypes: true });
    } catch (e) {
        return;
    }
    const audioFiles = items
        .filter(item => item.isFile() && AUDIO_EXTENSIONS.test(item.name) && !item.name.startsWith('.'))
        .map(item => item.name)
        .sort((a, b) => a.localeCompare(b, 'zh-CN'));
    if (audioFiles.length === 0) return;
    const playlistPath = path.join(cdDir, 'playlist.m3u');
    if (dryRun) {
        console.log(`预览生成播放列表: ${playlistPath} (${audioFiles.length} 首)`);
        return;
    }
    const lines = ['#EXTM3U'].concat(audioFiles);
    try {
        fs.writeFileSync(playlistPath, lines.join('\n'), 'utf-8');
        console.log(`生成播放列表: ${playlistPath}`);
    } catch (e) {
        console.error(`❌ 播放列表写入失败: ${playlistPath}`);
    }
}

function moveFile(src, dest, dryRun) {
    if (dryRun) {
        console.log(`预览: ${path.basename(src)} -> ${dest}`);
        return;
    }

    if (fs.existsSync(dest)) {
        console.log(`跳过已存在文件: ${dest}`);
        return;
    }

    try {
        fs.renameSync(src, dest);
        console.log(`移动: ${path.basename(src)} -> ${dest}`);
    } catch (e) {
        console.error(`❌ 移动失败: ${src} -> ${dest}`);
    }
}

function splitDirectory(targetDir, size, dryRun) {
    const songs = getAudioFiles(targetDir);

    console.log(`📂 目标目录: ${targetDir}`);
    console.log(`🎧 发现音频文件: ${songs.length}`);
    console.log(`📀 每个子目录容量: ${size}`);

    if (songs.length === 0) {
        console.log('⚠️ 未找到任何音频文件');
        return;
    }

    const cdTracks = {};

    let cdIndex = 1;
    for (let i = 0; i < songs.length; i++) {
        const song = songs[i];
        const slot = Math.floor(i / size) + 1;
        if (slot !== cdIndex) {
            cdIndex = slot;
        }
        const cdDir = ensureCdDir(targetDir, cdIndex);
        const destAudio = path.join(cdDir, path.basename(song.audio));
        moveFile(song.audio, destAudio, dryRun);
        const key = String(cdIndex);
        if (!cdTracks[key]) {
            cdTracks[key] = [];
        }
        cdTracks[key].push(path.basename(song.audio));
        if (song.lrc) {
            const destLrc = path.join(cdDir, path.basename(song.lrc));
            moveFile(song.lrc, destLrc, dryRun);
        }
    }

    if (!dryRun) {
        Object.keys(cdTracks).forEach(key => {
            const cdDir = ensureCdDir(targetDir, parseInt(key, 10));
            const playlistPath = path.join(cdDir, 'playlist.m3u');
            const lines = ['#EXTM3U'].concat(cdTracks[key]);
            try {
                fs.writeFileSync(playlistPath, lines.join('\n'), 'utf-8');
                console.log(`生成播放列表: ${playlistPath}`);
            } catch (e) {
                console.error(`❌ 播放列表写入失败: ${playlistPath}`);
            }
        });
    }

    console.log('✅ 拆分完成');
}

function main() {
    const args = parseArgs();

    if (!args.dir) {
        console.error('❌ 请提供目录路径');
        printHelp();
        process.exit(1);
    }

    if (!fs.existsSync(args.dir)) {
        console.error(`❌ 目录不存在: ${args.dir}`);
        process.exit(1);
    }

    if (args.playlistOnly) {
        const cdDirs = getCdDirs(args.dir);
        if (cdDirs.length === 0) {
            console.log('⚠️ 未找到任何 CD 目录');
            return;
        }
        cdDirs.forEach(name => {
            const cdDir = path.join(args.dir, name);
            buildPlaylistForDir(cdDir, args.dryRun);
        });
        console.log('✅ 播放列表生成完成');
        return;
    }

    splitDirectory(args.dir, args.size, args.dryRun);
}

main();
