/**
 * 脚本名称: Count Artist Folders (统计文件夹数量)
 * 功能描述: 统计指定目录下的子文件夹数量，并列出前5个。
 * 使用方法:
 *    node count_artist_folders.js [目标目录]
 */

const fs = require('fs');
const path = require('path');

const targetDir = process.argv[2] || '/Volumes/Music/歌手分类';

try {
    if (!fs.existsSync(targetDir)) {
        console.log(`Directory not found: ${targetDir}`);
        process.exit(1);
    }

    const items = fs.readdirSync(targetDir, { withFileTypes: true });
    const artistFolders = items.filter(item => item.isDirectory());

    console.log(`Total artist folders: ${artistFolders.length}`);
    console.log('First 5 folders:', artistFolders.slice(0, 5).map(d => d.name));

} catch (error) {
    console.error('Error reading directory:', error.message);
}
