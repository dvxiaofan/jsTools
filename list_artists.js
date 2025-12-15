const fs = require('fs');
const path = require('path');

const musicDir = '/Volumes/Music';
const exclude = ['其他合集'];

try {
  const files = fs.readdirSync(musicDir, { withFileTypes: true });
  const artists = files
    .filter(dirent => dirent.isDirectory())
    .map(dirent => dirent.name)
    .filter(name => !exclude.includes(name));

  console.log(artists.join('\n'));
} catch (err) {
  console.error('Error reading directory:', err);
}
