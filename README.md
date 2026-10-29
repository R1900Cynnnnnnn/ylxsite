# ylxsite — 个人网站完全手册

个人网站 [r1900ylx.xyz](https://r1900ylx.xyz/) 的源码仓库。纯静态 HTML/CSS/JS，**无构建步骤**，改完即用。

- 线上地址：https://r1900ylx.xyz/
- GitHub 仓库：https://github.com/R1900Cynnnnnnn/ylxsite
- 服务器：阿里云 ECS（乌兰察布），Ubuntu 22.04 + nginx
- 本地工作目录：`D:\skd_courses\ylxsite`

---

## 目录结构

```
ylxsite/
├── index.html                  主页（中英双语，所有文字集中在文件内的 DATA 对象里）
├── README.md                   本文件
├── justforfun/                 「Just For Fun」角落 https://r1900ylx.xyz/justforfun/
│   ├── index.html              角落首页（游戏卡片集中在文件内的 GAMES 数组里）
│   ├── jelly-tetris/           软体俄罗斯方块
│   └── wwwtodo/                WWWtodo 番茄钟（番茄钟 + 每日计划 + 日记）
├── assets/                     站点图标与 logo
│   ├── favicon.svg
│   └── logos/                  主页引用的学校 logo
├── deploy/
│   ├── deploy.sh               一键部署脚本（见下文）
│   └── nginx-ylxsite.conf      服务器 nginx 配置备份
└── nameplate/                  铭牌设计素材（未被任何页面引用，可删）
```

**关键约定**：每个页面的文字内容都集中写在该 HTML 文件内的 `DATA` / `GAMES` / `I18N` 对象里，改内容不需要碰布局代码。

---

## 一、如何连接服务器

### 服务器信息

| 项目 | 值 |
|---|---|
| 公网 IP | `8.147.63.58` |
| 实例 ID | i-0jl558oa8lar314qhxfr（阿里云控制台可查） |
| 系统 | Ubuntu 22.04 LTS |
| 登录用户 | `root` |
| 认证方式 | 本机密钥 `~/.ssh/id_ed25519`（免密，已配置好） |
| 网站根目录 | `/var/www/ylxsite`（就是这个仓库的 clone） |
| Web 服务 | nginx 1.18，配置见 `deploy/nginx-ylxsite.conf` |

### 日常连接（本机 Git Bash / 终端）

```bash
ssh root@8.147.63.58
```

### 如果换了一台新电脑（密钥不存在）

1. 新电脑生成密钥：`ssh-keygen -t ed25519`
2. 把公钥 `~/.ssh/id_ed25519.pub` 的内容追加到服务器的 `/root/.ssh/authorized_keys`
   （可通过阿里云控制台 → ECS 实例 → 「远程连接」用 VNC/Workbench 登录后粘贴）
3. 之后即可免密 ssh。

### 常用服务器命令

```bash
cd /var/www/ylxsite     # 进入网站目录
git pull                # 拉取最新代码（网站即更新，无需重启 nginx）
nginx -t                # 改了 nginx 配置后先测试
systemctl reload nginx  # 再重载配置
```

服务器上还有一个旧版备份目录 `/var/www/ylxsite.old-<时间戳>`（部署改造时留的底），确认线上一切正常后可以删掉。

---

## 二、改了代码之后如何上传（日常更新流程）

**一句话：在本地 `D:\skd_courses\ylxsite` 改文件，然后运行一键部署脚本。**

```bash
cd /d/skd_courses/ylxsite
# …… 随便改任何文件 ……
bash deploy/deploy.sh "本次改了什么（提交信息）"
```

脚本会自动完成三件事：

1. `git add + commit + push` → 代码上传到 GitHub 云端仓库
2. ssh 到服务器执行 `git pull` → 网站立即更新
3. 全程约几秒钟，刷新 https://r1900ylx.xyz/ 即可看到效果

### 如果你想手动分步执行

```bash
cd /d/skd_courses/ylxsite
git add -A
git commit -m "改了什么"
git push                                        # 上传到 GitHub
ssh root@8.147.63.58 "cd /var/www/ylxsite && git pull"   # 更新线上网站
```

### 只上传 GitHub、暂不更新网站

只执行 `git push`，不执行服务器那一步即可。想更新网站时随时 `ssh root@8.147.63.58 "cd /var/www/ylxsite && git pull"`。

---

## 三、如何添加一个新的小项目（以 Just For Fun 为例）

假设新做的小玩意叫 `my-game`：

**第 1 步：放进 justforfun 目录**

```
justforfun/my-game/index.html   ← 入口必须叫 index.html，资源全部用相对路径
```

这样它的访问地址自动就是 `https://r1900ylx.xyz/justforfun/my-game/`。
注意：项目内的 css/js/图片引用**必须用相对路径**（如 `src="js/main.js"`），不要写 `/` 开头的绝对路径。

**第 2 步：在角落首页注册卡片**

编辑 `justforfun/index.html`，在 `GAMES` 数组里加一项（插到「敬请期待」之前）：

```js
{
  icon: '🎮',
  title: { zh: '我的小游戏', en: 'My Game' },
  desc:  { zh: '中文简介。', en: 'English description.' },
  tags:  { zh: ['#标签'], en: ['#tag'] },
  href:  'my-game/',
},
```

**第 3 步：一键部署**

```bash
bash deploy/deploy.sh "新增 my-game"
```

完成。主页导航不用动（主页的「好玩」入口已指向 justforfun/）。

---

## 四、GitHub 云端管理说明

- 仓库：https://github.com/R1900Cynnnnnnn/ylxsite （public）
- 本地目录 `D:\skd_courses\ylxsite` 就是这个仓库的 clone，二者通过 git 同步
- 网站页脚有 GitHub 链接，仓库的 homepage 字段指向网站域名，双向关联

### 常用 git 命令

```bash
git status          # 看有哪些改动
git log --oneline   # 看历史版本
git diff            # 看具体改了什么
git push            # 推送到 GitHub
git pull            # 从 GitHub 拉取（在别的电脑改过代码后用）
```

### 在另一台电脑上继续工作

```bash
git clone https://github.com/R1900Cynnnnnnn/ylxsite.git
# 改完后同样 git push，服务器上 git pull 即更新网站
```

### 回滚到历史版本

```bash
git log --oneline            # 找到想回到的版本号，如 abc1234
git revert abc1234           # 安全撤销某次提交（推荐）
bash deploy/deploy.sh "回滚" # 部署
```

---

## 五、故障排查

| 症状 | 排查 |
|---|---|
| 网站没更新 | ① 本地 push 了吗 ② 服务器 `git pull` 了吗 ③ 浏览器强刷 Ctrl+Shift+R |
| ssh 连不上 | ① 网络是否通：`ping 8.147.63.58` ② 密钥是否在：`ls ~/.ssh/id_ed25519` ③ 阿里云控制台安全组是否放行 22 端口 |
| 网站 502/404 | ssh 上去看 nginx：`nginx -t`、`tail /var/log/nginx/error.log` |
| git pull 报冲突 | 服务器上直接改文件了？`cd /var/www/ylxsite && git status` 查看，建议所有改动都走本地仓库流程 |

---

## 备忘

- 网站是纯静态的，**任何改动都不需要重启服务**，文件覆盖即生效
- 域名解析：r1900ylx.xyz → 8.147.63.58（A 记录，在域名服务商处管理）
- HTTPS 证书：自签名证书位于服务器 `/etc/nginx/ssl/ylxsite.crt`（配置见 `deploy/nginx-ylxsite.conf`）
- 备案信息在主页页脚（蜀ICP备、沪公网安备），改页脚时注意保留
