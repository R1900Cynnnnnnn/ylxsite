# ylxsite

个人网站 [r1900ylx.xyz](https://r1900ylx.xyz/) 的源码仓库。纯静态 HTML/CSS/JS，无构建步骤。

## 结构

```
index.html                  主页（中英双语，内容集中在文件内 DATA 对象）
justforfun/                 Just For Fun 角落
  ├── jelly-tetris/         软体俄罗斯方块
  └── wwwtodo/              WWWtodo 番茄钟（番茄钟 + 每日计划 + 日记）
assets/                     站点图标与 logo
deploy/nginx-ylxsite.conf   服务器 nginx 配置
nameplate/                  铭牌设计素材（未被页面引用）
```

## 部署

服务器通过 nginx 以 `/var/www/ylxsite` 为站点根目录（见 `deploy/nginx-ylxsite.conf`）。更新流程：在本仓库推送后，到服务器上 `git pull`（或将文件 rsync 到 `/var/www/ylxsite`）。
