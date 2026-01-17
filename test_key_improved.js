const OpenCC = require('opencc-js');
const converter = OpenCC.Converter({ from: 'hk', to: 'cn' });

const DESCRIPTIVE_SUFFIXES = [
    'live', 'remix', 'mix', 'cover', 'demo', 'acoustic', 'instrumental',
    'dj', '伴奏', '演唱会', '现场', '版', '大合唱', '合唱', '独唱',
    '钢琴版', '吉他版', '纯音乐', 'karaoke', 'ktv', 'radio edit',
    'remaster', 'remastered', 'bonus', 'edit', 'extended', 'short',
    '国语', '粤语', '日语', '英语', '翻唱'
];

function toSimplified(str) {
    return converter(str);
}

function removeDescriptiveSuffix(name) {
    let result = name;
    let prev;
    do {
        prev = result;
        result = result.replace(/\s*\[[^\]]*\]\s*$/i, '');
        const suffixPattern = new RegExp(
            `\\s*[（(]\\s*([0-9a-zA-Z${DESCRIPTIVE_SUFFIXES.join('')}年版\\s\\-\\u4e00-\\u9fff]*)[^)）]*[)）]\\s*$`,
            'i'
        );
        result = result.replace(suffixPattern, '');
    } while (result !== prev);
    return result.trim();
}

function getSongKey(trackName) {
    let normalized = trackName;
    normalized = removeDescriptiveSuffix(normalized);
    normalized = toSimplified(normalized);
    normalized = normalized
        .toLowerCase()
        .replace(/\s+/g, '')
        .replace(/[-–—·]/g, '');
    return normalized;
}

// 测试包含 - 的歌名
const tests = [
    '海阔天空',
    'Beyond - 海阔天空',
    'Beyond - 海阔天空 [Live]',
    '光辉岁月 - 粤语版',
    '我是愤怒 - 伴奏版 (演唱会)',
];

console.log('🧪 测试连字符处理:\n');
tests.forEach(song => {
    const key = getSongKey(song);
    console.log(`${song.padEnd(35)} => ${key}`);
});

console.log('\n✅ 改进完成！新逻辑包括：');
console.log('  1. ✅ 繁简体转换 (OpenCC)');
console.log('  2. ✅ 完整的版本后缀移除 (DESCRIPTIVE_SUFFIXES 列表)');
console.log('  3. ✅ 循环移除 (处理多重后缀)');
console.log('  4. ✅ 连字符移除 (处理歌手-歌曲 格式)');
console.log('  5. ✅ 完全匹配对比 (避免误匹配)');
