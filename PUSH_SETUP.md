# Web Push セットアップ（Cloudflare Worker 完結版）

ページ/アプリを閉じていても「渋滞発生」「渋滞解消」を通知します。
**定期処理はすべて Cloudflare Worker の Cron Trigger で実行**します
（GitHub Actions はスケジュールが間引かれて遅延するため使いません）。

```
[日中2分毎] Cloudflare Worker Cron (JST 6:00-23:55 / 夜間停止)
   └─ syndication からツイート取得 → 変化時のみ KV に保存
        └─ 渋滞/解消を判定 → 前回状態(KV)と比較
             └─ 遷移時のみ Web Push 送信 → 各端末の Service Worker → 通知表示
アプリ表示は Worker の GET /tweets から最新データを取得（GitHub の tweets.json はフォールバック）
```

iPhone は **「ホーム画面に追加」した PWA** でのみ Web Push が動作します（iOS 16.4+）。

---

## 1. Worker を再デプロイ（PC の `worker/` で実行）

```bash
cd worker

# VAPID 秘密鍵をシークレット登録（公開鍵・subject は wrangler.toml の [vars] に記入済み）
#   ※リポジトリには秘密鍵を置かないこと
echo "<VAPID秘密鍵>" | wrangler secret put VAPID_PRIVATE_KEY

# 管理トークンは登録済みのはず（未登録なら）:
#   echo "<管理トークン>" | wrangler secret put ADMIN_TOKEN

wrangler deploy
```

デプロイすると `[triggers] crons = ["*/2 0-14,21-23 * * *"]` が有効になり、
日中(JST 6:00-23:55)のみ2分毎に自動実行されます（夜間は停止）。
KV書込(無料枠1日1000回)は「ツイート集合や渋滞状態が変化した時だけ」行うため、
巡回頻度を上げても書込は増えず(1日数十回)、無料枠に十分収まります。

## 2. 動作確認

```bash
# 手動で1回実行（取得→判定→遷移時はプッシュ送信）
curl -X POST https://nerv-traffic-push.kazunari-kanzaki.workers.dev/run \
  -H "Authorization: Bearer <管理トークン>"

# 最新ツイートが取れているか（公開エンドポイント）
curl https://nerv-traffic-push.kazunari-kanzaki.workers.dev/tweets
```

- 初回は基準値の保存のみ（通知なし）。次回以降、渋滞状態が変化した時に通知します。
- Cloudflare ダッシュボード → Workers → ログ で実行状況を確認できます。

## 3. 端末側で有効化

1. iPhone：Safari で公開URLを開く → 共有 → **「ホーム画面に追加」**
2. 追加したアイコンから起動 → **「🔔 通知を有効化」** → 許可
   - 購読が Worker に登録されます

---

## 構成メモ

- 取得元: `https://syndication.twitter.com/srv/timeline-profile/screen-name/mlit_himeji`
- Worker: `worker/worker.js`（取得・判定・暗号化付き Web Push 送信を内蔵）
- KV `SUBS` キー: `sub:<hash>`（購読）/ `state`（渋滞状態）/ `tweets`（最新ツイート）
- 判定ロジックは `scripts/congestion.js` とアプリ `app.js` に一致（`INCIDENT_TTL_MS`=3時間で続報未取得時も自動解消）
- `.github/workflows/fetch-tweets.yml` は Worker 障害時のフォールバック用に tweets.json をコミットし続けます（通知は送りません）。
- VAPID 公開鍵 / 秘密鍵はチャットで生成済みの値を使用。再生成する場合は
  `npx web-push generate-vapid-keys` で作り直し、`worker/wrangler.toml` の
  `VAPID_PUBLIC_KEY` と `config.js` を更新してください。
