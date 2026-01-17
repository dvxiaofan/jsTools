const path = require('path');
const fs = require('fs').promises;
const { exec } = require('child_process');
const NodeID3 = require('node-id3');
const minimist = require('minimist');

const SUPPORTED_EXTENSIONS = ['.mp3', '.flac', '.m4a'];

// --- File Traversal ---
async function findAudioFiles(dir) {
    let results = [];
    const list = await fs.readdir(dir);
    for (const file of list) {
        const filePath = path.join(dir, file);
        const stat = await fs.stat(filePath);
        if (stat && stat.isDirectory()) {
            if (file.startsWith('CD')) {
                results = results.concat(await findAudioFiles(filePath));
            }
        } else {
            if (SUPPORTED_EXTENSIONS.includes(path.extname(filePath).toLowerCase())) {
                results.push(filePath);
            }
        }
    }
    return results;
}

// --- Metadata Update ---
async function updateMetadata(filePath, tags, clearYear) {
    const ext = path.extname(filePath).toLowerCase();
    console.log(`  > Updating: ${path.basename(filePath)}`);

    if (ext === '.mp3') {
        try {
            const tagsToUpdate = { ...tags };
            if (clearYear) {
                tagsToUpdate.year = '';
                tagsToUpdate.recordingTime = ''; // Also clear this for good measure
            }
            const success = NodeID3.update(tagsToUpdate, filePath);
            if (success) {
                console.log('    - MP3 metadata updated successfully.');
            } else {
                console.error('    - Failed to update MP3 metadata.');
            }
            return success;
        } catch (error) {
            console.error(`    - Error writing MP3 tags: ${error.message}`);
            return false;
        }
    } else if (ext === '.flac') {
        try {
            // For FLAC, it's safer to remove old tags and then set new ones.
            // We construct the command dynamically.
            const removeTags = ['ALBUM', 'ALBUMARTIST'];
            if (clearYear) {
                removeTags.push('DATE', 'YEAR');
            }
            
            const removeCommandPart = removeTags.map(tag => `--remove-tag=${tag}`).join(' ');
            const setCommandPart = `--set-tag=ALBUM="${tags.album}" --set-tag=ALBUMARTIST="${tags.albumArtist}"`;
            
            const command = `metaflac ${removeCommandPart} "${filePath}" && metaflac ${setCommandPart} --dont-use-padding "${filePath}"`;

            await new Promise((resolve, reject) => {
                exec(command, { shell: true }, (error, stdout, stderr) => {
                    if (error) {
                        console.error(`    - Error executing metaflac: ${stderr}`);
                        reject(error);
                        return;
                    }
                    console.log('    - FLAC metadata updated successfully.');
                    resolve(true);
                });
            });
            return true;
        } catch (error) {
            console.error(`    - Error processing FLAC file: ${error.message}`);
            return false;
        }
    } else if (ext === '.m4a') {
        const tempFilePath = path.join(path.dirname(filePath), `temp_${path.basename(filePath)}`);
        try {
            let metadataCommand = `-metadata album="${tags.album}" -metadata album_artist="${tags.albumArtist}"`;
            if (clearYear) {
                metadataCommand += ` -metadata date=""`;
            }

            const command = `ffmpeg -i "${filePath}" -y -map_metadata 0 ${metadataCommand} -c copy "${tempFilePath}"`;

            await new Promise((resolve, reject) => {
                exec(command, { shell: true }, (error, stdout, stderr) => {
                    if (error) {
                        console.error(`    - Error executing ffmpeg: ${stderr}`);
                        reject(error);
                        return;
                    }
                    resolve(true);
                });
            });

            // Replace original file with the new one
            await fs.rename(tempFilePath, filePath);
            console.log(`    - M4A metadata updated successfully.`);
            return true;

        } catch (error) {
            console.error(`    - Error processing M4A file: ${error.message}`);
            // Clean up temp file on error
            await fs.unlink(tempFilePath).catch(() => {});
            return false;
        }
    }
    return false;
}

// --- Main Logic ---
async function main() {
    const args = minimist(process.argv.slice(2));
    const targetDir = args._[0];
    const album = args.album;
    const albumArtist = args.albumArtist;
    const clearYear = args['clear-year'] || false;

    if (!targetDir || !album || !albumArtist) {
        console.error('Usage: node update_metadata.js <directory> --album="<album_name>" --albumArtist="<artist_name>" [--clear-year]');
        return;
    }

    console.log(`Scanning directory: ${targetDir}`);
    const audioFiles = await findAudioFiles(targetDir);
    console.log(`Found ${audioFiles.length} supported audio files.`);

    const tags = {
        album: album,
        albumArtist: albumArtist,
    };

    if (clearYear) {
        console.log('Year information will be cleared.');
    }

    for (const file of audioFiles) {
        await updateMetadata(file, tags, clearYear);
    }

    console.log('\nFinished processing directory.');
}

main().catch(console.error);
