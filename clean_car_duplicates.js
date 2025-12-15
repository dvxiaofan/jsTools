const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const targetDir = '/Volumes/CAR/MUSIC';
const trashDirName = '_duplicates_trash';
const trashDir = path.join(targetDir, trashDirName);
const scriptOutput = 'move_duplicates.sh';
const reportOutput = 'duplicates_resolution_report.txt';

// Priority folders (higher index = higher priority if all else equal? No, let's use explicit logic)
// Actually, for BLACKPINK, "华语精选2" had the better filename (BLACKPINK - Title), while "外语精选" had (Title).
// So Filename Quality > Folder Name.

function scanDirectory(dir) {
    let results = [];
    try {
        const files = fs.readdirSync(dir);
        files.forEach(file => {
            if (file.startsWith('._') || file === '.DS_Store') return;
            const fullPath = path.join(dir, file);
            try {
                const stat = fs.statSync(fullPath);
                if (stat.isDirectory()) {
                    results = results.concat(scanDirectory(fullPath));
                } else {
                    results.push({ path: fullPath, size: stat.size, name: file });
                }
            } catch (e) {}
        });
    } catch (e) {}
    return results;
}

function calculateMD5(filePath) {
    const BUFFER_SIZE = 8192;
    const fd = fs.openSync(filePath, 'r');
    const hash = crypto.createHash('md5');
    const buffer = Buffer.alloc(BUFFER_SIZE);
    try {
        let bytesRead;
        while ((bytesRead = fs.readSync(fd, buffer, 0, BUFFER_SIZE, null)) !== 0) {
            hash.update(buffer.slice(0, bytesRead));
        }
    } finally {
        fs.closeSync(fd);
    }
    return hash.digest('hex');
}

function isSimplified(str) {
    // Simple check: if converting to Simplified is same as original, it's likely simplified (or no chinese).
    // But we need to distinguish from Traditional.
    // Actually, just checking if filename contains "親" vs "亲" etc is hard without a library.
    // Let's rely on filename length or " - " presence first.
    return true;
}

function getScore(file) {
    let score = 0;
    const name = file.name;

    // 1. Prefer "Artist - Title" format (contains " - ")
    if (name.includes(' - ')) score += 100;

    // 2. Prefer Simplified Chinese (heuristic: avoid specific traditional chars if possible,
    // or just rely on the fact that my previous observation showed Traditional files were duplicate lrcs)
    // In the observed case: "亲爱的那不是爱情.lrc" vs "親愛的那不是愛情.lrc".
    // I want to keep "亲".
    // I can't easily detect Traditional without a big library.
    // BUT, usually Simplified filenames are shorter or equal? No.
    // Let's use a small blacklist of Traditional chars if needed, or just prefer the one that ASCII-sorts later? No.
    // Let's check for specific Traditional characters commonly seen?
    // "愛" vs "爱".
    if (name.includes('爱') && !name.includes('愛')) score += 10;
    if (name.includes('亲') && !name.includes('親')) score += 10;

    // 3. Folder Preference
    // BLACKPINK case: "华语精选2" (score 100 due to " - ") vs "外语精选" (score 0). Winner: 华语精选2.
    // Jolin case: "华语精选1" vs "华语精选2". Both have " - ". Score tied.
    // Tie-breaker: Prefer "华语精选1" (Alphabetical order of parent folder? 1 comes before 2).

    return score;
}

console.log('Scanning files...');
const files = scanDirectory(targetDir);
const sizeMap = new Map();
files.forEach(f => {
    if (!sizeMap.has(f.size)) sizeMap.set(f.size, []);
    sizeMap.get(f.size).push(f);
});

console.log('Checking hashes...');
const groups = [];
for (const [size, group] of sizeMap) {
    if (group.length < 2) continue;
    if (size === 0) continue;

    const hashMap = new Map();
    for (const file of group) {
        const hash = calculateMD5(file.path);
        if (!hashMap.has(hash)) hashMap.set(hash, []);
        hashMap.get(hash).push(file);
    }

    for (const [hash, g] of hashMap) {
        if (g.length > 1) groups.push(g);
    }
}

const commands = [];
const report = [];

console.log(`Resolving ${groups.length} duplicate groups...`);

// Ensure trash dir exists
if (!fs.existsSync(trashDir)) {
    fs.mkdirSync(trashDir, { recursive: true });
}

groups.forEach((group, idx) => {
    // Sort group by Score (descending), then by Path Length (shorter preferred?), then by Path (alphabetical)
    group.sort((a, b) => {
        const scoreA = getScore(a);
        const scoreB = getScore(b);
        if (scoreA !== scoreB) return scoreB - scoreA;

        // Tie-breaker: Prefer "华语精选1" over "华语精选2"
        // Just use alphabetical path sort
        return a.path.localeCompare(b.path);
    });

    const winner = group[0];
    const losers = group.slice(1);

    report.push(`Group ${idx + 1}: Keeping [${winner.name}]`);
    report.push(`  Location: ${winner.path}`);
    report.push(`  Score: ${getScore(winner)}`);

    losers.forEach(loser => {
        report.push(`  Moving to trash: ${loser.path} (Score: ${getScore(loser)})`);

        const fileName = path.basename(loser.path);
        const parentDir = path.basename(path.dirname(loser.path));
        const destName = `${parentDir}_${fileName}`;
        const destPath = path.join(trashDir, destName);

        try {
            fs.renameSync(loser.path, destPath);
            console.log(`Moved: ${loser.path} -> ${destPath}`);
        } catch (e) {
            console.error(`Failed to move ${loser.path}: ${e.message}`);
        }
    });
    report.push('');
});

fs.writeFileSync(reportOutput, report.join('\n'));

console.log(`Done. Processed ${groups.length} groups.`);
console.log(`Check ${reportOutput} for details.`);
