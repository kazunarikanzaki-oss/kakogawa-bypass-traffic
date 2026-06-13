// ============================================================
//  NERV TRAFFIC — クライアント設定
//  Web Push を有効にするには、Cloudflare Worker をデプロイ後に
//  下の2つを設定してください（PUSH_SETUP.md 参照）。
//  空のままなら「アプリ起動中のみのローカル通知」にフォールバックします。
// ============================================================
window.NERV_CONFIG = {
  // 例: 'https://nerv-traffic-push.<your-subdomain>.workers.dev'
  //   Worker をデプロイ後に記入してください。
  PUSH_API: '',
  // VAPID 公開鍵 (この場で生成済み。秘密鍵は GitHub Secrets に入れてください)
  VAPID_PUBLIC_KEY: 'BKKPwQMJXztmB3Glv0kAxqef1TNyn0ewWMXU5CNBA-k2VGzFE-NZrUZN8rQAAxVg_0a_9cdwkX2dERXriInlx2Q',
};
