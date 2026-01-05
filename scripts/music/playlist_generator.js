/**
 * 脚本名称: Playlist Generator (播放列表生成器)
 * 功能描述: 生成 Navidrome 兼容的 .nsp 智能播放列表
 *
 * 使用方法:
 *   # 交互式模式
 *   node playlist_generator.js
 *
 *   # 命令行模式 - 按艺术家
 *   node playlist_generator.js --name "周杰伦精选" --artist "周杰伦"
 *
 *   # 按年代
 *   node playlist_generator.js --name "千禧年代" --year 2000-2009
 *
 *   # 组合条件
 *   node playlist_generator.js --name "周杰伦黄金十年" --artist "周杰伦" --year 2000-2010 --exclude "Live,伴奏"
 *
 *   # 分析模式 - 自动为每个艺术家生成歌单
 *   node playlist_generator.js --auto-artist
 *
 *   # 初始化配置
 *   node playlist_generator.js --init
 *
 * 参数:
 *   --name         歌单名称 (必需，除非使用 --auto-*)
 *   --artist       按艺术家筛选
 *   --album        按专辑筛选
 *   --year         按年份/年份范围 (如: 2000 或 2000-2010)
 *   --genre        按流派筛选
 *   --exclude      排除关键词 (如: "Live,伴奏,纯音乐")
 *   --sort         排序方式 (random/year/artist/album/title)
 *   --limit        限制歌曲数量
 *   --auto-artist  自动为每个艺术家生成歌单
 *   --auto-decade  自动按年代生成歌单
 *   --init         初始化配置文件
 *   -h, --help     显示帮助
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');

// ---------------------------------------------------------
// 1. 配置
// ---------------------------------------------------------

const CONFIG_FILE = path.join(__dirname, '.playlist_config.json');

const DEFAULT_CONFIG = {
    musicLibrary: '',      // 音乐库路径
    playlistDir: '',       // 歌单保存目录
    defaultExclude: ['Live', '伴奏', '纯音乐', 'Instrumental', 'Remix']
};

// Navidrome NSP 支持的规则操作符
const NSP_OPERATORS = {
    contains: 'contains',      // 包含
    is: 'is',                  // 精确匹配
    isNot: 'isNot',           // 不等于
    startsWith: 'startsWith', // 以...开头
    endsWith: 'endsWith',     // 以...结尾
    inTheRange: 'inTheRange', // 在范围内
    before: 'before',         // 之前
    after: 'after',           // 之后
    inTheLast: 'inTheLast',   // 最近
    notInTheLast: 'notInTheLast' // 不在最近
};

// 可用的字段
const NSP_FIELDS = [
    'title', 'album', 'artist', 'albumartist', 'hascoverart',
    'tracknumber', 'discnumber', 'year', 'size', 'compilation',
    'dateadded', 'datemodified', 'discsubtitle', 'comment',
    'lyrics', 'sorttitle', 'sortalbum', 'sortartist', 'sortalbumartist',
    'albumtype', 'albumcomment', 'catalognumber', 'filepath',
    'filetype', 'duration', 'bitrate', 'bpm', 'channels',
    'genre', 'loved', 'dateloved', 'lastplayed', 'playcount',
    'rating'
];

// ---------------------------------------------------------
// 2. 工具函数
// ---------------------------------------------------------

/**
 * 加载配置
 */
function loadConfig() {
    try {
        if (fs.existsSync(CONFIG_FILE)) {
            const data = fs.readFileSync(CONFIG_FILE, 'utf-8');
            return { ...DEFAULT_CONFIG, ...JSON.parse(data) };
        }
    } catch (e) {
        console.error('⚠️ 配置文件读取失败，使用默认配置');
    }
    return { ...DEFAULT_CONFIG };
}

/**
 * 保存配置
 */
function saveConfig(config) {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

/**
 * 创建 readline 接口
 */
function createRL() {
    return readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });
}

/**
 * 异步询问用户
 */
function ask(rl, question) {
    return new Promise(resolve => {
        rl.question(question, answer => resolve(answer.trim()));
    });
}

/**
 * 解析命令行参数
 */
function parseArgs() {
    const args = process.argv.slice(2);
    const result = {
        name: null,
        artist: null,
        album: null,
        year: null,
        genre: null,
        exclude: [],
        sort: null,
        order: null,
        limit: null,
        autoArtist: false,
        autoDecade: false,
        init: false,
        help: false
    };

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        const next = args[i + 1];

        switch (arg) {
            case '--name':
            case '-n':
                result.name = next;
                i++;
                break;
            case '--artist':
            case '-a':
                result.artist = next;
                i++;
                break;
            case '--album':
                result.album = next;
                i++;
                break;
            case '--year':
            case '-y':
                result.year = next;
                i++;
                break;
            case '--genre':
            case '-g':
                result.genre = next;
                i++;
                break;
            case '--exclude':
            case '-e':
                result.exclude = next ? next.split(',').map(s => s.trim()) : [];
                i++;
                break;
            case '--sort':
            case '-s':
                result.sort = next;
                i++;
                break;
            case '--order':
                result.order = next;
                i++;
                break;
            case '--limit':
            case '-l':
                result.limit = parseInt(next, 10);
                i++;
                break;
            case '--auto-artist':
                result.autoArtist = true;
                break;
            case '--auto-decade':
                result.autoDecade = true;
                break;
            case '--init':
                result.init = true;
                break;
            case '--help':
            case '-h':
                result.help = true;
                break;
        }
    }

    return result;
}

/**
 * 打印帮助信息
 */
function printHelp() {
    console.log(`
🎵 Navidrome 播放列表生成器

使用方法:
  node playlist_generator.js                    # 交互式模式
  node playlist_generator.js --init             # 初始化配置
  node playlist_generator.js [选项]             # 命令行模式

选项:
  --name, -n      歌单名称 (必需)
  --artist, -a    按艺术家筛选
  --album         按专辑筛选
  --year, -y      按年份筛选 (如: 2000 或 2000-2010)
  --genre, -g     按流派筛选
  --exclude, -e   排除关键词 (逗号分隔)
  --sort, -s      排序方式 (random/year/artist/album/title)
  --order         排序顺序 (asc/desc)
  --limit, -l     限制歌曲数量

自动模式:
  --auto-artist   为音乐库中每个艺术家生成歌单
  --auto-decade   按年代自动分组生成歌单

其他:
  --init          初始化/更新配置
  -h, --help      显示帮助

示例:
  # 周杰伦所有歌曲
  node playlist_generator.js --name "周杰伦精选" --artist "周杰伦"

  # 2000年代歌曲，按年份排序
  node playlist_generator.js --name "千禧年代" --year 2000-2009 --sort year

  # 排除 Live 和伴奏版本
  node playlist_generator.js --name "录音室版本" --artist "周杰伦" --exclude "Live,伴奏"

  # 批量为每个艺术家生成歌单
  node playlist_generator.js --auto-artist
`);
}

// ---------------------------------------------------------
// 3. NSP 生成器
// ---------------------------------------------------------

/**
 * 构建 NSP 规则
 */
function buildNspRules(options) {
    const rules = [];

    // 艺术家
    if (options.artist) {
        rules.push({ [NSP_OPERATORS.contains]: ['artist', options.artist] });
    }

    // 专辑
    if (options.album) {
        rules.push({ [NSP_OPERATORS.contains]: ['album', options.album] });
    }

    // 年份
    if (options.year) {
        if (options.year.includes('-')) {
            const [start, end] = options.year.split('-').map(Number);
            rules.push({ [NSP_OPERATORS.inTheRange]: ['year', start, end] });
        } else {
            rules.push({ [NSP_OPERATORS.is]: ['year', parseInt(options.year, 10)] });
        }
    }

    // 流派
    if (options.genre) {
        rules.push({ [NSP_OPERATORS.contains]: ['genre', options.genre] });
    }

    return rules;
}

/**
 * 构建排除规则
 */
function buildExcludeRules(excludeList) {
    return excludeList.map(keyword => ({
        [NSP_OPERATORS.contains]: ['title', keyword]
    }));
}

/**
 * 生成 NSP 对象
 */
function generateNsp(options) {
    const nsp = {
        name: options.name
    };

    const allRules = buildNspRules(options);
    const excludeRules = buildExcludeRules(options.exclude || []);

    // 构建规则结构
    if (allRules.length > 0 || excludeRules.length > 0) {
        const ruleObj = {};

        if (allRules.length > 0) {
            ruleObj.all = allRules;
        }

        if (excludeRules.length > 0) {
            ruleObj.none = excludeRules;
        }

        nsp.rules = ruleObj;
    }

    // 排序
    if (options.sort) {
        nsp.sort = options.sort;
    }
    if (options.order) {
        nsp.order = options.order;
    }

    // 限制数量
    if (options.limit) {
        nsp.limit = options.limit;
    }

    return nsp;
}

/**
 * 保存 NSP 文件
 */
function saveNsp(nsp, outputPath) {
    const content = JSON.stringify(nsp, null, 2);
    fs.writeFileSync(outputPath, content, 'utf-8');
    return outputPath;
}

// ---------------------------------------------------------
// 4. 交互式模式
// ---------------------------------------------------------

async function runInteractiveMode(config) {
    const rl = createRL();

    console.log('\n🎵 Navidrome 播放列表生成器 (交互模式)\n');

    // 检查配置
    if (!config.musicLibrary || !config.playlistDir) {
        console.log('⚠️ 未配置音乐库路径，请先初始化配置\n');
        await runInitMode(config, rl);
    }

    console.log(`📂 音乐库: ${config.musicLibrary}`);
    console.log(`📁 歌单目录: ${config.playlistDir}\n`);

    // 选择模式
    console.log('选择创建方式:');
    console.log('  1. 按艺术家');
    console.log('  2. 按年代');
    console.log('  3. 按流派');
    console.log('  4. 自定义条件');
    console.log('  5. 批量生成 (每个艺术家一个歌单)');
    console.log('  6. 批量生成 (按年代分组)\n');

    const modeChoice = await ask(rl, '请选择 [1-6]: ');

    let options = { exclude: config.defaultExclude || [] };

    switch (modeChoice) {
        case '1': // 按艺术家
            options.artist = await ask(rl, '输入艺术家名称: ');
            options.name = await ask(rl, `歌单名称 [${options.artist}精选]: `) || `${options.artist}精选`;
            break;

        case '2': // 按年代
            const yearInput = await ask(rl, '输入年份或范围 (如 2000 或 2000-2009): ');
            options.year = yearInput;
            const defaultYearName = yearInput.includes('-') ? `${yearInput}年代` : `${yearInput}年`;
            options.name = await ask(rl, `歌单名称 [${defaultYearName}]: `) || defaultYearName;
            break;

        case '3': // 按流派
            options.genre = await ask(rl, '输入流派: ');
            options.name = await ask(rl, `歌单名称 [${options.genre}]: `) || options.genre;
            break;

        case '4': // 自定义
            options.name = await ask(rl, '歌单名称: ');
            const artist = await ask(rl, '艺术家 (可选): ');
            const album = await ask(rl, '专辑 (可选): ');
            const year = await ask(rl, '年份/范围 (可选): ');
            const genre = await ask(rl, '流派 (可选): ');

            if (artist) options.artist = artist;
            if (album) options.album = album;
            if (year) options.year = year;
            if (genre) options.genre = genre;
            break;

        case '5': // 批量 - 艺术家
            rl.close();
            await runAutoArtistMode(config);
            return;

        case '6': // 批量 - 年代
            rl.close();
            await runAutoDecadeMode(config);
            return;

        default:
            console.log('无效选择');
            rl.close();
            return;
    }

    // 询问是否排除特殊版本
    const excludeChoice = await ask(rl, `排除特殊版本? (${config.defaultExclude.join('/')}) [Y/n]: `);
    if (excludeChoice.toLowerCase() === 'n') {
        options.exclude = [];
    }

    // 询问排序
    const sortChoice = await ask(rl, '排序方式 (1=随机 2=年份 3=艺术家 4=不排序) [4]: ');
    const sortMap = { '1': 'random', '2': 'year', '3': 'artist' };
    if (sortMap[sortChoice]) {
        options.sort = sortMap[sortChoice];
        if (sortChoice !== '1') {
            const orderChoice = await ask(rl, '排序顺序 (1=升序 2=降序) [2]: ');
            options.order = orderChoice === '1' ? 'asc' : 'desc';
        }
    }

    rl.close();

    // 生成
    const nsp = generateNsp(options);
    const fileName = `${options.name}.nsp`;
    const outputPath = path.join(config.playlistDir, fileName);

    // 确保目录存在
    if (!fs.existsSync(config.playlistDir)) {
        fs.mkdirSync(config.playlistDir, { recursive: true });
    }

    saveNsp(nsp, outputPath);

    console.log('\n✅ 歌单已生成!\n');
    console.log(`   文件: ${outputPath}`);
    console.log(`   名称: ${nsp.name}`);
    console.log('\n📋 内容预览:');
    console.log('─'.repeat(40));
    console.log(JSON.stringify(nsp, null, 2));
    console.log('─'.repeat(40));
    console.log('\n💡 Navidrome 会在下次扫描时自动导入此歌单');
}

// ---------------------------------------------------------
// 5. 初始化模式
// ---------------------------------------------------------

async function runInitMode(config, existingRl) {
    const rl = existingRl || createRL();

    console.log('\n⚙️ 配置初始化\n');

    const musicLibrary = await ask(rl, `音乐库路径 [${config.musicLibrary || ''}]: `) || config.musicLibrary;

    const defaultPlaylistDir = musicLibrary ? path.join(musicLibrary, 'playlists') : '';
    const playlistDir = await ask(rl, `歌单保存目录 [${config.playlistDir || defaultPlaylistDir}]: `)
        || config.playlistDir || defaultPlaylistDir;

    const excludeInput = await ask(rl, `默认排除关键词 [${config.defaultExclude.join(',')}]: `);
    const defaultExclude = excludeInput
        ? excludeInput.split(',').map(s => s.trim())
        : config.defaultExclude;

    const newConfig = {
        musicLibrary,
        playlistDir,
        defaultExclude
    };

    saveConfig(newConfig);

    console.log('\n✅ 配置已保存!\n');
    console.log(`   音乐库: ${musicLibrary}`);
    console.log(`   歌单目录: ${playlistDir}`);
    console.log(`   排除关键词: ${defaultExclude.join(', ')}`);

    if (!existingRl) {
        rl.close();
    }

    return newConfig;
}

// ---------------------------------------------------------
// 6. 自动模式
// ---------------------------------------------------------

/**
 * 自动为每个艺术家生成歌单
 */
async function runAutoArtistMode(config) {
    console.log('\n🔍 扫描音乐库...\n');

    if (!config.musicLibrary || !fs.existsSync(config.musicLibrary)) {
        console.error('❌ 音乐库路径无效，请先运行 --init 配置');
        return;
    }

    // 获取所有艺术家文件夹
    const items = fs.readdirSync(config.musicLibrary, { withFileTypes: true });
    const artists = items
        .filter(item => item.isDirectory() && !item.name.startsWith('.') && !item.name.startsWith('_'))
        .map(item => item.name);

    console.log(`📋 发现 ${artists.length} 位艺术家\n`);

    // 确保歌单目录存在
    if (!fs.existsSync(config.playlistDir)) {
        fs.mkdirSync(config.playlistDir, { recursive: true });
    }

    let created = 0;
    for (const artist of artists) {
        const options = {
            name: `${artist}精选`,
            artist: artist,
            exclude: config.defaultExclude || [],
            sort: 'year',
            order: 'desc'
        };

        const nsp = generateNsp(options);
        const fileName = `${artist}精选.nsp`;
        const outputPath = path.join(config.playlistDir, fileName);

        saveNsp(nsp, outputPath);
        created++;
        process.stdout.write(`\r   已生成: ${created}/${artists.length}`);
    }

    console.log('\n\n✅ 批量生成完成!');
    console.log(`   共生成 ${created} 个歌单`);
    console.log(`   保存位置: ${config.playlistDir}`);
}

/**
 * 自动按年代生成歌单
 */
async function runAutoDecadeMode(config) {
    console.log('\n📅 按年代生成歌单...\n');

    if (!config.playlistDir) {
        console.error('❌ 未配置歌单目录，请先运行 --init 配置');
        return;
    }

    // 确保歌单目录存在
    if (!fs.existsSync(config.playlistDir)) {
        fs.mkdirSync(config.playlistDir, { recursive: true });
    }

    // 生成各年代歌单
    const decades = [
        { name: '60年代经典', start: 1960, end: 1969 },
        { name: '70年代经典', start: 1970, end: 1979 },
        { name: '80年代经典', start: 1980, end: 1989 },
        { name: '90年代经典', start: 1990, end: 1999 },
        { name: '千禧年代', start: 2000, end: 2009 },
        { name: '2010年代', start: 2010, end: 2019 },
        { name: '2020年代', start: 2020, end: 2029 }
    ];

    for (const decade of decades) {
        const options = {
            name: decade.name,
            year: `${decade.start}-${decade.end}`,
            exclude: config.defaultExclude || [],
            sort: 'random'
        };

        const nsp = generateNsp(options);
        const fileName = `${decade.name}.nsp`;
        const outputPath = path.join(config.playlistDir, fileName);

        saveNsp(nsp, outputPath);
        console.log(`   ✅ ${decade.name} (${decade.start}-${decade.end})`);
    }

    console.log(`\n✅ 已生成 ${decades.length} 个年代歌单`);
    console.log(`   保存位置: ${config.playlistDir}`);
}

// ---------------------------------------------------------
// 7. 命令行模式
// ---------------------------------------------------------

async function runCommandMode(args, config) {
    // 检查必要参数
    if (!args.name) {
        console.error('❌ 请提供歌单名称: --name "歌单名称"');
        console.log('   使用 --help 查看帮助');
        return;
    }

    // 至少需要一个筛选条件
    if (!args.artist && !args.album && !args.year && !args.genre) {
        console.error('❌ 请至少提供一个筛选条件 (--artist/--album/--year/--genre)');
        return;
    }

    // 确定歌单目录
    let playlistDir = config.playlistDir;
    if (!playlistDir) {
        playlistDir = process.cwd();
        console.log(`⚠️ 未配置歌单目录，将保存到当前目录: ${playlistDir}`);
    }

    // 确保目录存在
    if (!fs.existsSync(playlistDir)) {
        fs.mkdirSync(playlistDir, { recursive: true });
    }

    // 构建选项
    const options = {
        name: args.name,
        artist: args.artist,
        album: args.album,
        year: args.year,
        genre: args.genre,
        exclude: args.exclude.length > 0 ? args.exclude : (config.defaultExclude || []),
        sort: args.sort,
        order: args.order,
        limit: args.limit
    };

    // 生成
    const nsp = generateNsp(options);
    const fileName = `${args.name}.nsp`;
    const outputPath = path.join(playlistDir, fileName);

    saveNsp(nsp, outputPath);

    console.log('\n✅ 歌单已生成!\n');
    console.log(`   文件: ${outputPath}`);
    console.log(`   名称: ${nsp.name}`);
    console.log('\n📋 内容:');
    console.log('─'.repeat(40));
    console.log(JSON.stringify(nsp, null, 2));
    console.log('─'.repeat(40));
}

// ---------------------------------------------------------
// 8. 入口
// ---------------------------------------------------------

async function main() {
    const args = parseArgs();
    const config = loadConfig();

    // 帮助
    if (args.help) {
        printHelp();
        return;
    }

    // 初始化模式
    if (args.init) {
        await runInitMode(config);
        return;
    }

    // 自动模式
    if (args.autoArtist) {
        await runAutoArtistMode(config);
        return;
    }

    if (args.autoDecade) {
        await runAutoDecadeMode(config);
        return;
    }

    // 有参数 = 命令行模式，无参数 = 交互模式
    const hasParams = args.name || args.artist || args.album || args.year || args.genre;

    if (hasParams) {
        await runCommandMode(args, config);
    } else {
        await runInteractiveMode(config);
    }
}

main().catch(e => {
    console.error('❌ 错误:', e.message);
    process.exit(1);
});
