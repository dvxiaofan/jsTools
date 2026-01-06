# 音乐管理工具

本目录包含 12 个音乐文件管理工具，用于检测重复、整理特殊版本、清理无用文件、生成播放列表、下载歌词、管理封面等。

## 工具列表

### 1. check_duplicates_enhanced.js - 重复检测

检测目录内的重复音乐文件，支持两种检测方式：
- **完全重复**: MD5 哈希相同
- **语义重复**: 歌手 + 歌名相同 (不同版本/格式)

```bash
node check_duplicates_enhanced.js "/path/to/music"
```

**输出**: 生成 `_cleanup_duplicates.sh` 清理脚本

**特性**:
- 自动解析文件名提取歌手和歌名
- 支持繁简体、罗马数字归一化
- 关联同名 .lrc 歌词文件
- 按质量评分推荐保留版本

---

### 2. find_special_versions.js - 特殊版本检测

检测 Live、伴奏、序曲等特殊版本的音乐文件。

```bash
node find_special_versions.js "/path/to/music"
```

**检测关键词**:
| 类别 | 关键词 |
|------|--------|
| 现场版 | `live`, `演唱会`, `现场版`, `现场` |
| 伴奏 | `伴奏`, `纯音乐`, `纯享` |
| 序曲 | `intro`, `序曲` |

**输出**: 生成 `_cleanup_special_versions.sh` 清理脚本

---

### 3. find_empty_dirs.js - 空目录检测

检测空目录和没有音频文件的目录。

```bash
node find_empty_dirs.js "/path/to/music"
```

**检测类型**:
- 空目录 (包括子目录全空的情况)
- 无歌曲目录 (有文件但无音频)

**输出**: 生成 `_cleanup_empty_dirs.sh` 清理脚本

---

### 4. find_orphan_lrcs.js - 孤立歌词检测

检测没有对应音频文件的孤立 .lrc 歌词文件。

```bash
node find_orphan_lrcs.js "/path/to/music"
```

**匹配规则**: 同目录下同名音频文件 (不区分大小写)

**输出**: 生成 `_cleanup_orphan_lrcs.sh` 清理脚本

---

### 5. check_japanese.js - 日语歌曲检测

通过检测文件名中的假名 (平假名/片假名) 识别日语歌曲。

```bash
node check_japanese.js "/path/to/music"
```

**识别范围**:
- 平假名: `あ-ん` (U+3040-U+309F)
- 片假名: `ア-ン` (U+30A0-U+30FF)

**输出**: 生成 `_cleanup_japanese.sh` 清理脚本

---

### 6. hot_songs.js - 热门歌曲查询

查询歌手热门歌曲或地区音乐榜单 (数据来源: iTunes API)。

**三种模式**:

```bash
# 模式1: 查询单个歌手热门
node hot_songs.js --artist "周杰伦" -n 20

# 模式2: 批量查询目录下所有歌手
node hot_songs.js --dir "/path/to/artists" -n 10

# 模式3: 查询地区热门榜单
node hot_songs.js --chart cn -n 50
node hot_songs.js --chart tw,hk,sg -n 100
```

**参数**:
| 参数 | 说明 |
|------|------|
| `-a, --artist` | 歌手名称 |
| `-d, --dir` | 歌手目录路径 |
| `-c, --chart` | 地区代码 (cn/tw/hk/sg/us/jp/kr/gb) |
| `-n, --limit` | 返回数量 (默认 20) |
| `-o, --output` | 输出到文件 |
| `--json` | JSON 格式输出 |

---

### 7. fix_audio_tags.js - 音频标签补全

检测并补全音频文件的缺失标签，包括封面、标题、艺术家、专辑等元数据。

**数据源**: QQ音乐、网易云音乐、iTunes

```bash
# 交互式模式（默认）- 检查后询问是否执行
node fix_audio_tags.js "/path/to/music"

# 直接执行模式
node fix_audio_tags.js "/path/to/music" --apply

# 自动确认执行
node fix_audio_tags.js "/path/to/music" -y

# 同时下载 .lrc 歌词文件
node fix_audio_tags.js "/path/to/music" -y --with-lrc

# 不补全封面
node fix_audio_tags.js "/path/to/music" --no-cover
```

**参数**:
| 参数 | 说明 |
|------|------|
| `--apply` | 直接执行模式（跳过确认） |
| `-y` | 自动确认执行 |
| `--with-lrc` | 同时下载 .lrc 歌词文件 |
| `--no-cover` | 不补全封面 |
| `--limit N` | 只处理前 N 个文件 |

**检测并补全项目**:
- 内嵌封面图片
- 标题、艺术家、专辑标签
- 年份、流派信息
- .lrc 歌词文件（需 --with-lrc）

---

### 8. playlist_generator.js - 播放列表生成

生成 Navidrome 兼容的 `.nsp` 智能播放列表。

**三种使用方式**:

```bash
# 交互式模式 (推荐)
node playlist_generator.js

# 命令行模式
node playlist_generator.js --name "周杰伦精选" --artist "周杰伦"

# 批量生成
node playlist_generator.js --auto-artist
```

**首次使用需初始化配置**:
```bash
node playlist_generator.js --init
# 配置音乐库路径和歌单保存目录
```

**命令行参数**:
| 参数 | 说明 |
|------|------|
| `--name, -n` | 歌单名称 |
| `--artist, -a` | 按艺术家筛选 |
| `--album` | 按专辑筛选 |
| `--year, -y` | 按年份/范围筛选 (如: 2000 或 2000-2010) |
| `--genre, -g` | 按流派筛选 |
| `--exclude, -e` | 排除关键词 (逗号分隔) |
| `--sort, -s` | 排序方式 (random/year/artist/album/title) |
| `--limit, -l` | 限制歌曲数量 |
| `--auto-artist` | 为每个艺术家自动生成歌单 |
| `--auto-decade` | 按年代自动生成歌单 |

**示例**:
```bash
# 周杰伦 2000-2010 年的歌，排除 Live 版本
node playlist_generator.js --name "Jay黄金十年" \
  --artist "周杰伦" --year 2000-2010 --exclude "Live,伴奏"

# 批量为音乐库中每个艺术家生成歌单
node playlist_generator.js --auto-artist
```

**生成的 .nsp 文件示例**:
```json
{
  "name": "周杰伦精选",
  "rules": {
    "all": [{"contains": ["artist", "周杰伦"]}],
    "none": [{"contains": ["title", "Live"]}]
  },
  "sort": "year",
  "order": "desc"
}
```

---

### 9. download_lyrics.js - 歌词下载

为缺少歌词的音频文件自动下载 `.lrc` 歌词文件。

**数据源**: QQ音乐、网易云音乐

```bash
# 交互式模式（默认）- 检查后询问是否执行
node download_lyrics.js "/path/to/music"

# 直接执行模式
node download_lyrics.js "/path/to/music" --apply

# 自动确认执行
node download_lyrics.js "/path/to/music" -y

# 覆盖已有歌词
node download_lyrics.js "/path/to/music" -y --overwrite
```

**参数**:
| 参数 | 说明 |
|------|------|
| `--apply` | 直接执行模式（跳过确认） |
| `-y` | 自动确认执行 |
| `--overwrite` | 覆盖已有的 .lrc 文件 |
| `--limit N` | 只处理前 N 个文件 |

**工作流程**:
1. 扫描目录下的所有音频文件
2. 检测没有同名 .lrc 文件的音频
3. 解析文件名提取歌曲名和艺术家
4. 从 QQ音乐/网易云搜索匹配歌词
5. 显示下载计划并询问确认
6. 下载保存为同名 .lrc 文件

---

### 10. download_covers.js - 封面下载

为音频文件下载同名封面图片（.jpg），适用于 WAV 等不支持内嵌封面的格式，或需要外部封面的场景。

**数据源**: QQ音乐、网易云音乐、iTunes

```bash
# 交互式模式（默认）- 检查后询问是否执行
node download_covers.js "/path/to/music"

# 自动确认执行
node download_covers.js "/path/to/music" -y

# 覆盖已有封面
node download_covers.js "/path/to/music" -y --overwrite
```

**参数**:
| 参数 | 说明 |
|------|------|
| `--apply` | 直接执行模式（跳过确认） |
| `-y` | 自动确认执行 |
| `--overwrite` | 覆盖已有的封面文件 |
| `--limit N` | 只处理前 N 个文件 |

**输出**: 为每个音频文件下载同名 `.jpg` 封面（如 `歌曲.wav` → `歌曲.jpg`）

---

### 11. embed_covers.js - 封面嵌入

将同名 `.jpg` 封面嵌入到 WAV 音频文件中，使用 RIFF "ID3 " 子块格式。

**技术实现**: 在 WAV 文件末尾添加 RIFF "ID3 " 子块，包含 ID3v2.4 标签

```bash
# 交互式模式（默认）- 检查后询问是否执行
node embed_covers.js "/path/to/music"

# 自动确认执行
node embed_covers.js "/path/to/music" -y

# 覆盖已有嵌入封面
node embed_covers.js "/path/to/music" -y --overwrite
```

**参数**:
| 参数 | 说明 |
|------|------|
| `-y` | 自动确认执行 |
| `--overwrite` | 覆盖已有的嵌入封面 |
| `--limit N` | 只处理前 N 个文件 |

**工作流程**:
1. 扫描目录下的所有 WAV 文件
2. 检查是否有同名 `.jpg/.jpeg/.png` 封面文件
3. 创建 ID3v2.4 标签（包含 APIC 帧）
4. 将标签作为 RIFF "ID3 " 子块嵌入 WAV 文件
5. 更新 RIFF 头大小字段

**完整封面处理流程**:
```bash
# 步骤1: 下载外部封面
node download_covers.js "/path/to/music" -y

# 步骤2: 将封面嵌入 WAV 文件
node embed_covers.js "/path/to/music" -y
```

---

### 12. embed_lyrics.js - 歌词嵌入

将同名 `.lrc` 歌词嵌入到 WAV 音频文件中，使用 RIFF "ID3 " 子块格式。

**技术实现**: 在 WAV 文件的 ID3v2.4 标签中添加 USLT (Unsynchronized Lyrics) 帧

```bash
# 交互式模式（默认）- 检查后询问是否执行
node embed_lyrics.js "/path/to/music"

# 自动确认执行
node embed_lyrics.js "/path/to/music" -y

# 覆盖已有嵌入歌词
node embed_lyrics.js "/path/to/music" -y --overwrite
```

**参数**:
| 参数 | 说明 |
|------|------|
| `-y` | 自动确认执行 |
| `--overwrite` | 覆盖已有的嵌入歌词 |
| `--limit N` | 只处理前 N 个文件 |

**特性**:
- 保留已有的嵌入封面 (APIC 帧)
- 使用 UTF-8 编码存储歌词
- 支持 LRC 时间轴格式

**完整音乐处理流程**:
```bash
# 步骤1: 下载外部封面和歌词
node download_covers.js "/path/to/music" -y
node download_lyrics.js "/path/to/music" -y

# 步骤2: 将封面和歌词嵌入 WAV 文件
node embed_covers.js "/path/to/music" -y
node embed_lyrics.js "/path/to/music" -y
```

---

## 通用特性

所有工具共享以下特性：

| 特性 | 说明 |
|------|------|
| 目录参数 | 支持命令行指定，默认当前目录 |
| 跳过隐藏文件 | 自动跳过 `.` 开头的文件 |
| 跳过临时目录 | 自动跳过 `_` 开头的目录 |
| 安全清理 | 生成脚本移动到临时目录，不直接删除 |
| 歌词关联 | 自动关联同目录同名 .lrc 文件 |

## 支持的音频格式

```
.mp3, .flac, .m4a, .wav, .ape, .wma, .aac, .ogg, .dff, .dsf
```

## 清理脚本说明

所有工具生成的清理脚本：
- 保存在目标目录内
- 文件移动到 `_xxx_temp/` 临时目录
- 不会直接删除文件
- 执行前请先检查脚本内容

```bash
# 执行清理
cd "/path/to/music"
bash _cleanup_xxx.sh

# 确认无误后删除临时目录
rm -rf _xxx_temp
```
