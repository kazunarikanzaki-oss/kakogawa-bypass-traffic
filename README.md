# 加古川・姫路バイパス 渋滞ビューア

国道2号 姫路バイパス（太子東〜高砂西）と加古川バイパス（高砂西〜明石西）の渋滞状況を、Google マップの交通レイヤと国土交通省ライブカメラへのリンクで一画面にまとめたモバイル向け静的サイト。

## ローカル確認
`index.html` をブラウザで直接開く。

## GitHub Pages へのデプロイ
1. GitHub で public リポジトリを作成（例: `kakogawa-bypass-traffic`）。
2. このフォルダの中身一式を push。
3. リポジトリの Settings → Pages → Source を `main` ブランチのルート (`/`) に設定。
4. 数十秒後に `https://<ユーザー名>.github.io/<リポジトリ名>/` で公開される。
5. iPhone Safari で開き、共有ボタンから「ホーム画面に追加」。

## カスタマイズ
- マップの中心座標・ズームは `index.html` の各 `iframe` の `src` 内 `ll=` と `z=` を編集。
- ライブカメラ・公式情報のリンクは `index.html` の `<section class="card">` 内 `<ul class="links">` を編集。

## 注意
- 渋滞色は Google マップの推定値で、深夜帯は表示されないことがある。
- ライブカメラのリンクは姫路河川国道事務所サイトの URL に依存。リニューアル等でリンク切れしたら `index.html` を更新。
