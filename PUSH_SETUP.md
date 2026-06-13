# Web Push セットアップ手順（閉じていても通知）

ページ/アプリを閉じていても「渋滞発生」「渋滞解消」を通知する仕組みです。

```
[5分毎] GitHub Actions (push-notify.yml)
   └─ 最新ツイート取得 → 渋滞/解消を判定
        └─ 前回状態と比較 (Cloudflare Worker KV)
             └─ 遷移時のみ Web Push 送信 → 各端末の Service Worker → 通知表示
```

iPhone は **「ホーム画面に追加」した PWA** でのみ Web Push が動作します（iOS 16.4+）。

VAPID 公開鍵は生成済みで `config.js` / `scripts/push.config.json` に記入済みです。
**秘密鍵はリポジトリに置かず、GitHub Secrets にのみ登録**してください
（秘密鍵の値はチャットに出力したものを使用。気になる場合は
`npx web-push generate-vapid-keys` で再生成し、公開鍵も両ファイルで差し替え）。

---

## 1. Cloudflare Worker をデプロイ（無料）

```bash
cd worker
npm install -g wrangler          # 未導入なら
wrangler login                   # 無料アカウントでログイン

# KV 名前空間を作成し、出力された id を wrangler.toml の <YOUR_KV_NAMESPACE_ID> に貼る
wrangler kv namespace create SUBS

# 管理トークン(任意の長いランダム文字列)をシークレットとして登録
#   例: openssl rand -hex 24  で生成した値を貼る
wrangler secret put ADMIN_TOKEN

wrangler deploy
```

デプロイ後に表示される URL（例 `https://nerv-traffic-push.<sub>.workers.dev`）を控えます。

## 2. Worker URL を記入（2ファイル）

- リポジトリ直下 `config.js` の `PUSH_API` に Worker URL を記入
- `scripts/push.config.json` の `WORKER_URL` に同じ Worker URL を記入

両方コミットしてください。（VAPID 公開鍵・subject は記入済み）

## 3. GitHub Secrets を2つ登録

リポジトリ → Settings → Secrets and variables → Actions → New repository secret：

| Secret 名 | 値 |
|---|---|
| `PUSH_ADMIN_TOKEN` | 手順1の ADMIN_TOKEN と同じ値 |
| `VAPID_PRIVATE_KEY` | VAPID 秘密鍵（上記または再生成した値） |

（WORKER_URL・VAPID 公開鍵・subject は `scripts/push.config.json` から読むので Secrets 不要）

## 4. 端末側で有効化

1. iPhone：Safari で公開URLを開く → 共有 → **「ホーム画面に追加」**
2. 追加したアイコンから起動 → **「🔔 通知を有効化」** をタップ → 許可
   - これで購読が Worker に登録されます

## 動作確認

- Actions タブ → `Push notify (congestion)` → `Run workflow` で手動実行できます。
- 初回実行は基準値の保存のみ（通知なし）。次回以降、渋滞状態が変化した時に通知します。
- ローカル確認：`cd scripts && npm test`（渋滞判定ロジックのテスト）

## 補足

- チェック間隔は `.github/workflows/push-notify.yml` の `cron: '*/5 * * * *'`（5分毎）。GitHub Actions の最小間隔が5分です。
- このワークフローはリポジトリへコミットしないため、GitHub Pages のビルド上限には影響しません。
- `config.js` の PUSH_API が空の間は、アプリ起動中のローカル通知にフォールバックします。
