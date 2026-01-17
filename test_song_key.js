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
    normalized = normalized.toLowerCase().replace(/\s+/g, '');
    return normalized;
}

// 测试用例
const tests = [
    '海阔天空',
    '海阔天空 (Live)',
    '海阔天空 [Remastered]',
    '海闊天空 (2005版)',
    'Beyond - 海阔天空 [Live]',
    '光辉岁月 (粤语版)',
    '光辉岁月 (國語版)',
    '我是愤怒 (演唱会)',
    '我是愤怒 - 伴奏'
];

console.log('🧪 测试去重逻辑:\n');
tests.forEach(song => {
    const key = getSongKey(song);
    console.log(`${song.padEnd(35)} => ${key}`);
});
