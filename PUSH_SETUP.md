# Web Push セットアップ手順（閉じていても通知）

ページ/アプリを閉じていても「渋滞発生」「渋滞解消」を通知する仕組みです。

```
[5分毎] GitHub Actions (push-notify.yml)
   └─ 最新ツイート取得 → 渋滞/解消を判定
        └─ 前回状態と比較 (Cloudflare Worker KV)
             └─ 遷移時のみ Web Push 送信 → 各端末の Service Worker → 通知表示
```

iPhone は **「ホーム画面に追加」した PWA** でのみ Web Push が動作します（iOS 16.4+）。

---

## 1. VAPID 鍵を生成

```bash
npx web-push generate-vapid-keys
```

出力された `Public Key` と `Private Key` を控えます。

## 2. Cloudflare Worker をデプロイ（無料）

```bash
cd worker
npm install -g wrangler          # 未導入なら
wrangler login                   # 無料アカウントでログイン

# KV 名前空間を作成し、出力された id を wrangler.toml の <YOUR_KV_NAMESPACE_ID> に貼る
wrangler kv namespace create SUBS

# 管理トークン（任意の長いランダム文字列）をシークレットとして登録
wrangler secret put ADMIN_TOKEN

wrangler deploy
```

デプロイ後に表示される URL（例 `https://nerv-traffic-push.<sub>.workers.dev`）を控えます。

## 3. クライアント設定（config.js）

リポジトリ直下の `config.js` を編集してコミット：

```js
window.NERV_CONFIG = {
  PUSH_API: 'https://nerv-traffic-push.<sub>.workers.dev',
  VAPID_PUBLIC_KEY: '<手順1の Public Key>',
};
```

## 4. GitHub Secrets を登録

リポジトリ → Settings → Secrets and variables → Actions → New repository secret：

| Secret 名 | 値 |
|---|---|
| `PUSH_WORKER_URL` | 手順2の Worker URL |
| `PUSH_ADMIN_TOKEN` | 手順2の ADMIN_TOKEN と同じ値 |
| `VAPID_PUBLIC_KEY` | 手順1の Public Key |
| `VAPID_PRIVATE_KEY` | 手順1の Private Key |
| `VAPID_SUBJECT` | `mailto:あなたのメール` |

## 5. 端末側で有効化

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
- `config.js` が未設定でも、アプリ起動中はローカル通知にフォールバックします。
