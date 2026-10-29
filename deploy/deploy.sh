#!/usr/bin/env bash
# 一键部署：提交并推送本地改动，然后让服务器 git pull
# 用法：bash deploy/deploy.sh "提交信息"
set -e
cd "$(dirname "$0")/.."

MSG="${1:-update site}"
git add -A
git diff --cached --quiet || git commit -m "$MSG"
git push

ssh -i ~/.ssh/id_ed25519 root@8.147.63.58 "cd /var/www/ylxsite && git pull -q && echo 服务器已更新"
