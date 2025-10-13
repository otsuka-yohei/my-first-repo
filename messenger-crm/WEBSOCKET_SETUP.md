# WebSocket実装ガイド

## 概要

メッセージングシステムを**ポーリング方式からWebSocket方式**に移行しました。
これにより、リアルタイムでのメッセージ送受信が可能になり、サーバー負荷も削減されます。

## 実装内容

### 追加・変更したファイル

1. **server.ts** (新規作成)
   - Socket.ioサーバーを統合したカスタムNext.jsサーバー
   - 会話ルーム機能（join/leave）を実装

2. **src/lib/socket.ts** (新規作成)
   - Socket.ioクライアントのシングルトン管理
   - 接続・切断・再接続の自動処理

3. **src/app/api/conversations/[conversationId]/messages/route.ts** (変更)
   - メッセージ送信時にWebSocketでブロードキャスト

4. **src/app/_components/chat-dashboard.tsx** (変更)
   - ポーリングロジックを削除
   - WebSocketリスナーを実装
   - リアルタイムメッセージ受信

5. **package.json** (変更)
   - socket.io、socket.io-client を追加
   - devスクリプトを変更（tsx server.ts）

## 開発環境での起動方法

### 1. データベースの起動

```bash
cd /Users/yohei_otsuka/my-first-repo-1/messenger-crm
npm run dev:db
```

### 2. アプリケーションの起動

```bash
npm run dev
```

これで、WebSocketサーバー付きのNext.jsが起動します。

### 3. 動作確認

1. ブラウザで http://localhost:3000 を開く
2. 別のブラウザ（またはシークレットモード）で同じURLを開く
3. 一方でメッセージを送信
4. もう一方のブラウザで**即座に**メッセージが表示されることを確認

### 4. ログで確認

サーバーコンソールに以下のようなログが表示されます：

```
> Ready on http://localhost:3000
> WebSocket server is running
[WebSocket] Client connected: abc123
[WebSocket] abc123 joined conversation-xxx
[API] Message created successfully. ID: msg-123
[WebSocket] Broadcasted new message to conversation-xxx
```

ブラウザコンソールには：

```
[Socket] Connected to WebSocket server
[WebSocket] Received new message msg-123
```

## 技術詳細

### アーキテクチャ

```
┌─────────────┐         WebSocket          ┌─────────────┐
│  Browser 1  │ ◄────────────────────────► │             │
└─────────────┘                             │             │
                                            │   Server    │
┌─────────────┐         WebSocket          │  (Node.js)  │
│  Browser 2  │ ◄────────────────────────► │   Socket.io │
└─────────────┘                             │             │
                                            └─────────────┘
```

### 会話ルーム機能

- 各会話に対して `conversation-{conversationId}` というルームを作成
- ユーザーが会話を開くとそのルームに参加
- メッセージ送信時、同じルームの全員にブロードキャスト

### 楽観的UI更新との連携

1. ユーザーがメッセージを送信
2. フロントエンドで即座に表示（楽観的UI）
3. サーバーでメッセージ保存後、WebSocketでブロードキャスト
4. フロントエンドで重複チェック（既に表示済みの場合はスキップ）

## 削除されたコード

以下のポーリング関連コードは削除されました：

- `setInterval` によるポーリングロジック（約140行）
- `pollingIntervalRef` の管理コード
- `lastMessageTimeRef` によるタイムスタンプ追跡
- 健康相談フロー用の継続的ポーリング

## トラブルシューティング

### WebSocketが接続できない

1. サーバーが正常に起動しているか確認
   ```bash
   lsof -i :3000
   ```

2. ブラウザコンソールでエラーを確認
   - F12 → Console タブ

3. CORSエラーが出る場合
   - server.ts の CORS設定を確認

### メッセージが重複表示される

- ブラウザコンソールで `[WebSocket] Message already exists, skipping` が表示されているか確認
- 重複チェックロジックは正常に動作しています

### 古いポーリングコードが残っている

- `git status` で変更を確認
- `grep -r "setInterval" src/app/_components/chat-dashboard.tsx` で検索

## 本番環境への展開について

**注意：現在の実装はローカル開発環境専用です**

本番環境（Vercel等）にデプロイする場合は以下の対応が必要：

1. **別途WebSocketサーバーを構築**
   - AWS EC2、Railway、Render.com等
   - Socket.io専用サーバーとして運用

2. **環境変数の設定**
   ```bash
   NEXT_PUBLIC_SOCKET_URL=https://your-websocket-server.com
   ```

3. **Next.jsは通常通りデプロイ**
   - Vercelでのデプロイ時は `npm run dev:next` を使用
   - カスタムサーバー（server.ts）は使わない

4. **または、マネージドサービスを利用**
   - Pusher
   - Ably
   - Socket.io Cloud

## 今後の改善案

- [ ] 認証トークンをWebSocket接続時に検証
- [ ] 接続ステータスの UI表示（オンライン/オフライン）
- [ ] 再接続時の自動メッセージ同期
- [ ] タイピングインジケーター（○○が入力中...）
- [ ] オンラインユーザー数の表示
- [ ] メッセージ既読機能

## 参考資料

- [Socket.io 公式ドキュメント](https://socket.io/docs/v4/)
- [Next.js カスタムサーバー](https://nextjs.org/docs/pages/building-your-application/configuring/custom-server)
