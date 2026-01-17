
const musicMetadata = require('music-metadata');
const util = require('util');

async function analyzeFile(filePath) {
  try {
    console.log(`正在分析文件: ${filePath}`);
    const metadata = await musicMetadata.parseFile(filePath);
    console.log('--- 原始元数据 ---');
    // 使用 util.inspect 打印完整的对象结构，避免信息被折叠
    console.log(util.inspect(metadata.common, { showHidden: false, depth: null, colors: true }));

    if (metadata.common.picture && metadata.common.picture.length > 0) {
      console.log('\n--- 封面信息分析 ---');
      metadata.common.picture.forEach((pic, index) => {
        console.log(`  封面 ${index + 1}:`);
        console.log(`    格式 (Format/MIME): ${pic.format}`);
        console.log(`    类型 (Type): ${pic.type}`);
        console.log(`    描述 (Description): ${pic.description}`);
        console.log(`    尺寸 (Dimensions): ${pic.width}x${pic.height}`);
        console.log(`    数据长度 (Data length): ${pic.data.length} bytes`);
      });
    } else {
      console.log('\n--- 封面信息分析 ---');
      console.log('  未在此文件中找到封面信息。');
    }

  } catch (error) {
    console.error('读取元数据时出错:', error.message);
  }
}

// 您提供的文件路径
const targetFile = '/Volumes/Music/华语精选/CD10/蔡健雅 - 红色高跟鞋.flac';

analyzeFile(targetFile);
