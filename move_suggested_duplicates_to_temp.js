const fs = require('fs');
const path = require('path');
const { findFiles, getFileHash, parseSongInfo, getScore } = require('./check_duplicates_utils');

const targetDir = process.argv[2] || '/Volumes/Music/歌手分类';
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const tempDir = process.argv[3] || `/Volumes/Music/_duplicates_tmp_${timestamp}`;

function ensureDir(d) {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
}

function moveFile(src, destDir) {
    try {
        ensureDir(destDir);
        const name = path.basename(src);
        let dest = path.join(destDir, name);
        if (fs.existsSync(dest)) {
            const ext = path.extname(name);
            const base = path.basename(name, ext);
            dest = path.join(destDir, `${base}_${Date.now()}${ext}`);
        }
        fs.renameSync(src, dest);
        return dest;
    } catch (e) {
        console.error(`Failed to move ${src}: ${e.message}`);
        return null;
    }
}

function run() {
    console.log(`Start: target=${targetDir}`);
    if (!fs.existsSync(targetDir)) {
        console.error('Target not found:', targetDir);
        process.exit(1);
    }

    ensureDir(tempDir);
    console.log('Moving suggested losers to:', tempDir);

    const allFiles = findFiles(targetDir);
    const audioRegex = /\.(mp3|m4a|flac|wav|wma|ape)$/i;
    const fileInfos = allFiles.map(f => ({ path: f, size: fs.statSync(f).size, name: path.basename(f) }));

    const processed = new Set();
    let movedCount = 0;

    // A. Exact duplicates (size + md5)
    const sizeMap = new Map();
    fileInfos.forEach(f => {
        if (!sizeMap.has(f.size)) sizeMap.set(f.size, []);
        sizeMap.get(f.size).push(f);
    });

    for (const [size, group] of sizeMap) {
        if (group.length < 2 || size === 0) continue;
        const hashMap = new Map();
        group.forEach(f => {
            const hash = getFileHash(f.path);
            if (hash) {
                if (!hashMap.has(hash)) hashMap.set(hash, []);
                hashMap.get(hash).push(f);
            }
        });

        for (const [hash, sameFiles] of hashMap) {
            if (sameFiles.length > 1) {
                // sort keep best
                sameFiles.sort((a,b) => getScore(b)-getScore(a));
                const keeper = sameFiles[0];
                const losers = sameFiles.slice(1);
                losers.forEach(l => {
                    if (processed.has(l.path)) return;
                    // only move audio files
                    if (!audioRegex.test(l.name)) return;
                    const dest = moveFile(l.path, tempDir);
                    if (dest) {
                        movedCount++;
                        processed.add(l.path);
                        // move .lrc if exists
                        const lrc = l.path.replace(/\.[^/.]+$/, '.lrc');
                        if (fs.existsSync(lrc)) {
                            moveFile(lrc, tempDir);
                        }
                        console.log('Moved (exact):', l.path);
                    }
                });
            }
        }
    }

    // B. Semantic duplicates (artist|title)
    const songMap = new Map();
    fileInfos.forEach(f => {
        if (!audioRegex.test(f.name)) return;
        if (processed.has(f.path)) return;
        const info = parseSongInfo(f.name);
        if (!info.title || info.title === 'Unknown') return;
        const cleanArtist = info.artist.toLowerCase().replace(/\s+/g, '');
        const cleanTitle = info.title.toLowerCase().replace(/\s+/g, '');
        let key = '';
        if (cleanArtist && cleanArtist !== 'unknown') key = `${cleanArtist}|${cleanTitle}`;
        else if (cleanTitle.length > 4) key = `unknown|${cleanTitle}`;
        else return;
        if (!songMap.has(key)) songMap.set(key, []);
        songMap.get(key).push(f);
    });

    for (const [key, group] of songMap) {
        if (group.length <= 1) continue;
        // sort keep best
        group.sort((a,b) => getScore(b)-getScore(a));
        const keeper = group[0];
        const losers = group.slice(1);
        losers.forEach(l => {
            if (processed.has(l.path)) return;
            const dest = moveFile(l.path, tempDir);
            if (dest) {
                movedCount++;
                processed.add(l.path);
                const lrc = l.path.replace(/\.[^/.]+$/, '.lrc');
                if (fs.existsSync(lrc)) moveFile(lrc, tempDir);
                console.log('Moved (semantic):', l.path);
            }
        });
    }

    console.log(`Done. Moved ${movedCount} audio files to ${tempDir}`);
}

run();
