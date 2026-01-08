# jsTool - 工具集

一套 Node.js 命令行工具集，用于文件批量处理和管理。

## 功能概览

### 音乐管理工具 (13个)

| 工具 | 功能 |
|------|------|
| `check_duplicates_enhanced.js` | 检测重复音乐文件 (MD5 + 语义匹配) |
| `find_special_versions.js` | 检测 Live/伴奏/序曲 等特殊版本 |
| `find_empty_dirs.js` | 检测空目录和无歌曲目录 |
| `find_orphan_lrcs.js` | 检测没有对应音频的孤立歌词文件 |
| `check_japanese.js` | 通过假名识别日语歌曲 |
| `fix_audio_tags.js` | 检测音频标签完整性 (封面、歌词等) |
| `hot_songs.js` | 查询歌手热门歌曲 / 地区榜单 |
| `playlist_generator.js` | 生成 Navidrome 智能播放列表 (.nsp) |
| `playlist_from_dir.js` | 根据目录歌曲列表匹配生成播放列表 (.m3u) |
| `download_lyrics.js` | 自动下载歌词文件 (.lrc) |
| `download_covers.js` | 自动下载封面图片 (.jpg) |
| `embed_lyrics.js` | 将 .lrc 歌词嵌入 WAV 文件 |
| `embed_covers.js` | 将封面图片嵌入 WAV 文件 |

### 照片工具 (2个)

| 工具 | 功能 |
|------|------|
| `rename_photos.js` | 读取 EXIF 日期批量重命名照片 |
| `fix_dates.js` | 从文件名提取日期修复 EXIF |

## 快速开始

```bash
# 安装依赖
npm install

# 音乐工具示例
node scripts/music/check_duplicates_enhanced.js "/path/to/music"
node scripts/music/hot_songs.js --artist "周杰伦" -n 20
node scripts/music/playlist_generator.js --name "周杰伦精选" --artist "周杰伦"
node scripts/music/playlist_from_dir.js -s "/path/to/源目录" -l "/path/to/音乐库" -n "歌单名"
node scripts/music/download_lyrics.js "/path/to/music" -y
node scripts/music/download_covers.js "/path/to/music" -y

# 照片工具示例
node scripts/photo/rename_photos.js "/path/to/photos"
```

## 目录结构

```
jsTool/
├── scripts/
│   ├── music/          # 音乐管理工具
│   └── photo/          # 照片处理工具
├── package.json
└── README.md
```

## 特性

- 所有工具支持命令行参数指定目标目录
- 生成清理脚本而非直接删除，确保安全
- 自动关联同名歌词文件 (.lrc)
- 统一的输出格式和报告

## 依赖

```json
{
  "exifr": "^7.x",           // 照片 EXIF 读取
  "piexifjs": "^1.x",        // 照片 EXIF 写入
  "music-metadata": "^7.x",  // 音频元数据读取
  "minimist": "^1.x"         // 命令行参数解析
}
```

## 详细文档

- [音乐工具使用说明](scripts/music/README.md)
- [照片工具使用说明](scripts/photo/README.md)

## License

MIT
