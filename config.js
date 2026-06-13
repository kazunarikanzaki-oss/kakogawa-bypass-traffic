// ============================================================
//  NERV TRAFFIC — クライアント設定
//  Web Push を有効にするには、Cloudflare Worker をデプロイ後に
//  下の2つを設定してください（PUSH_SETUP.md 参照）。
//  空のままなら「アプリ起動中のみのローカル通知」にフォールバックします。
// ============================================================
window.NERV_CONFIG = {
  // 例: 'https://nerv-traffic-push.<your-subdomain>.workers.dev'
  PUSH_API: '',
  // `npx web-push generate-vapid-keys` の Public Key
  VAPID_PUBLIC_KEY: '',
};
