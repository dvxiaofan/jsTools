const fs = require('fs').promises;
const path = require('path');
const { spawn } = require('child_process');
const minimist = require('minimist');

/**
 * 执行一个子进程命令，并实时输出其 stdout 和 stderr。
 * @param {string} command - 要执行的命令 (例如 'node')。
 * @param {string[]} args - 命令的参数数组。
 * @returns {Promise<void>} - 当子进程结束时 resolve 的 Promise。
 */
function runScript(command, args) {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, {
            // stdio: 'inherit' 会将子进程的输出直接连接到父进程的输出
            // 这使得 update_cover_art.js 的日志能够实时显示出来
            stdio: 'inherit',
            shell: true // 在某些环境下，使用 shell: true 更可靠
        });

        child.on('close', (code) => {
            if (code === 0) {
                console.log(`\n✅ 子进程执行成功，退出码: ${code}\n`);
                resolve();
            } else {
                console.error(`\n❌ 子进程执行失败，退出码: ${code}\n`);
                // 即使失败也 resolve，以便继续处理下一个目录
                // 如果希望一个失败就停止整个流程，这里应该用 reject
                resolve();
            }
        });

        child.on('error', (err) => {
            console.error(`\n❌ 无法启动子进程: ${err.message}\n`);
            reject(err);
        });
    });
}

/**
 * 主函数
 */
async function main() {
    const args = minimist(process.argv.slice(2));
    const rootDir = args._[0];
    const isDryRun = args['dry-run'] || false;

    if (!rootDir) {
        console.error('错误: 请提供一个根目录路径。');
        console.log('用法: node batch_update_covers.js <根目录路径> [--dry-run]');
        return;
    }

    console.log(`🚀 开始批量处理根目录: ${rootDir}`);

    try {
        const entries = await fs.readdir(rootDir, { withFileTypes: true });
        const subdirectories = entries
            .filter(entry => entry.isDirectory())
            .map(entry => path.join(rootDir, entry.name));

        if (subdirectories.length === 0) {
            console.log('🤷 在指定目录下未找到任何子目录。');
            return;
        }

        console.log(`📂 找到 ${subdirectories.length} 个子目录，将按顺序处理...`);

        for (const dir of subdirectories) {
            console.log(`\n============================================================`);
            console.log(`⏳ 开始处理子目录: ${dir}`);
            console.log(`============================================================\n`);

            const scriptPath = path.join(__dirname, 'update_cover_art.js');
            const scriptArgs = [scriptPath, dir];
            if (isDryRun) {
                scriptArgs.push('--dry-run');
            }

            try {
                await runScript('node', scriptArgs);
            } catch (error) {
                console.error(`处理目录 ${dir} 时发生严重错误，已跳过。错误: ${error.message}`);
            }
        }

        console.log(`\n🎉🎉🎉 所有子目录处理完毕！ 🎉🎉🎉`);

    } catch (error) {
        console.error(`处理根目录时发生错误: ${error.message}`);
    }
}

main().catch(console.error);
