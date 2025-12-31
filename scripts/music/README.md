# 音乐管理工具

本目录包含 6 个音乐文件管理工具，用于检测重复、整理特殊版本、清理无用文件等。

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
