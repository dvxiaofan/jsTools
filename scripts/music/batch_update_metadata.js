const fs = require('fs').promises;
const path = require('path');
const { spawn } = require('child_process');
const minimist = require('minimist');

/**
 * Executes a child process and streams its output.
 */
function runScript(command, args) {
    return new Promise((resolve) => {
        const child = spawn(command, args, {
            stdio: 'inherit',
            shell: true
        });

        child.on('close', (code) => {
            if (code === 0) {
                console.log(`\n✅ Sub-process finished successfully (code ${code}).\n`);
            } else {
                console.error(`\n❌ Sub-process failed (code ${code}).\n`);
            }
            // Resolve even on failure to continue with the next directory.
            resolve();
        });

        child.on('error', (err) => {
            console.error(`\n❌ Failed to start sub-process: ${err.message}\n`);
            // Reject on spawn error because it's a critical failure.
            reject(err);
        });
    });
}

/**
 * Main function
 */
async function main() {
    const args = minimist(process.argv.slice(2));
    const rootDir = args._[0];
    const album = args.album;
    const albumArtist = args.albumArtist;
    const clearYear = args['clear-year'] || false;

    if (!rootDir || !album || !albumArtist) {
        console.error('Usage: node batch_update_metadata.js <root_directory> --album="<album_name>" --albumArtist="<artist_name>" [--clear-year]');
        return;
    }

    console.log(`🚀 Starting batch metadata update for: ${rootDir}`);
    console.log(`   - Album: "${album}"`);
    console.log(`   - Album Artist: "${albumArtist}"`);
    console.log(`   - Clear Year: ${clearYear}`);

    try {
        const entries = await fs.readdir(rootDir, { withFileTypes: true });
        const subdirectories = entries
            .filter(entry => entry.isDirectory())
            .map(entry => path.join(rootDir, entry.name));

        if (subdirectories.length === 0) {
            console.log('🤷 No subdirectories found in the specified root directory.');
            return;
        }

        console.log(`📂 Found ${subdirectories.length} subdirectories. Processing sequentially...`);

        for (const dir of subdirectories) {
            console.log(`\n============================================================`);
            console.log(`⏳ Processing subdirectory: ${dir}`);
            console.log(`============================================================\n`);

            const scriptPath = path.join(__dirname, 'update_metadata.js');
            const scriptArgs = [
                scriptPath,
                `"${dir}"`, // Quote the path to handle spaces
                `--album="${album}"`,
                `--albumArtist="${albumArtist}"`
            ];

            if (clearYear) {
                scriptArgs.push('--clear-year');
            }

            try {
                await runScript('node', scriptArgs);
            } catch (error) {
                console.error(`A critical error occurred while processing ${dir}. Skipping. Error: ${error.message}`);
            }
        }

        console.log(`\n🎉🎉🎉 All subdirectories processed! 🎉🎉🎉`);

    } catch (error) {
        console.error(`An error occurred while reading the root directory: ${error.message}`);
    }
}

main().catch(console.error);
