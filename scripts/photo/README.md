# 照片处理工具

本目录包含 2 个照片批量处理工具，用于重命名和修复 EXIF 日期。

## 工具列表

### 1. rename_photos.js - 照片批量重命名

扫描目录下的照片，读取 EXIF 拍摄日期，生成重命名脚本。

```bash
node rename_photos.js "/path/to/photos"
```

**命名格式**:
```
[原文件名]_[拍摄日期YYYYMMDD]_[序号].[后缀]

示例: _SC_0181.NEF -> _SC_0181_20160612_001.NEF
```

**特性**:
| 特性 | 说明 |
|------|------|
| RAW+JPG 分组 | 同名的 RAW 和 JPG 文件保持相同序号 |
| RAW 文件整理 | RAW 文件自动移动到 `RAW/` 子目录 |
| 日期来源 | 优先 EXIF，无则使用文件修改时间 |
| 跨平台 | 支持 macOS/Linux 和 Windows |

**支持的图片格式**:
```
RAW: .nef, .cr2, .arw, .dng, .orf, .rw2, .raf
普通: .jpg, .jpeg, .png, .tif, .tiff, .heic
```

**输出**: 生成 `_rename_photos.sh` (或 `.bat`) 重命名脚本

**使用流程**:
```bash
# 1. 生成重命名脚本
node rename_photos.js "/path/to/photos"

# 2. 检查脚本内容
cat /path/to/photos/_rename_photos.sh

# 3. 确认无误后执行
cd "/path/to/photos"
bash _rename_photos.sh
```

---

### 2. fix_dates.js - EXIF 日期修复

从文件名中提取日期 (YYYYMMDD 格式)，写入照片 EXIF 信息并修正文件系统时间。

```bash
node fix_dates.js "/path/to/photos"
```

**解决痛点**:
照片管理软件优先读取 EXIF 日期，如果丢失或错误，照片会显示为"今天"。此工具从文件名提取日期进行修复。

**日期提取规则**:
```
文件名中的 YYYYMMDD 格式
示例: _SC_0181_20160612_001.jpg -> 提取 20160612
```

**修复内容**:
| 字段 | 说明 |
|------|------|
| EXIF DateTime | 图像修改时间 |
| EXIF DateTimeOriginal | 原始拍摄时间 |
| EXIF DateTimeDigitized | 数字化时间 |
| 文件系统 mtime | 文件修改时间 |

**支持格式**: 仅 JPG/JPEG (piexifjs 库限制)

**注意**: 此工具直接修改文件，请确保有备份

---

## 依赖安装

```bash
npm install exifr piexifjs
```

| 依赖 | 用途 |
|------|------|
| `exifr` | 读取 EXIF 信息 (rename_photos.js) |
| `piexifjs` | 写入 EXIF 信息 (fix_dates.js) |

## 通用特性

| 特性 | 说明 |
|------|------|
| 目录参数 | 支持命令行指定，默认当前目录 |
| 跳过隐藏文件 | 自动跳过 `.` 开头的文件 |
| 跳过临时目录 | 自动跳过 `_` 开头的目录 |
| 循环引用防护 | 防止符号链接导致的无限递归 |

## 典型工作流

```bash
# 1. 先用 rename_photos.js 重命名照片 (添加日期到文件名)
node rename_photos.js "/path/to/photos"
bash /path/to/photos/_rename_photos.sh

# 2. 再用 fix_dates.js 将日期写入 EXIF (如果需要)
node fix_dates.js "/path/to/photos"
```

## 注意事项

- `rename_photos.js` 生成脚本，不直接修改文件
- `fix_dates.js` 直接修改 JPG 文件，建议先备份
- RAW 文件的 EXIF 修改需要使用 `exiftool` 等专业工具
