#!/usr/bin/env bash
set -euo pipefail
source_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
st_dir="${1:-$HOME/SillyTavern}"
if [ ! -f "$st_dir/public/script.js" ] || [ ! -f "$st_dir/package.json" ]; then
  echo "找不到 SillyTavern。用法：bash install-termux.sh /你的/SillyTavern/路徑" >&2
  exit 1
fi
destination="$st_dir/public/scripts/extensions/third-party/csb-character-state"
if [ -L "$destination" ]; then echo "目標是符號連結，請改用手動安裝。" >&2; exit 1; fi
if [ -d "$destination" ]; then
  backup="$st_dir/data/csb-extension-backups/$(date +%Y%m%d-%H%M%S)-$$"
  mkdir -p "$backup"
  cp -R "$destination" "$backup/"
  echo "舊版插件已備份：$backup"
fi
mkdir -p "$destination"
cp "$source_dir/manifest.json" "$source_dir/index.js" "$source_dir/style.css" "$source_dir/README.md" "$destination/"
cp -R "$source_dir/src" "$destination/"
echo "安裝完成。重新整理酒館，在擴充功能中開啟『角色信息』。"
echo "目前聊天資料未被改動；資料會在啟用插件後由酒館保存。"
