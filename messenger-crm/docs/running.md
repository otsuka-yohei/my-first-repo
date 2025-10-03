# 開発用動作確認手順

以下はローカル環境で Messenger CRM を起動し、画面を操作して動作確認するまでの流れです。

## 前提
- Docker が利用できること（PostgreSQL をコンテナで起動します）。
- Node.js 18 以上 / npm がインストール済みであること。

## 1. 依存パッケージのインストール
```bash
npm install
```

## 2. 環境変数の設定
`.env` には以下が定義済みです（必要に応じて書き換えてください）。
- `DATABASE_URL` … ローカル PostgreSQL への接続文字列。
- `NEXTAUTH_SECRET` … 任意のランダム文字列に置き換え推奨。
- `OPENAI_API_KEY` … LLM 接続を行う場合に設定。テスト時はダミーでも可。

## 3. データベースの起動
```bash
npm run dev:db
```
Docker が利用できない環境では、手元に PostgreSQL を用意して同じ接続情報を指定してください。

## 4. Prisma マイグレーション & シード
```bash
npm run prisma:migrate -- --name init
npm run prisma:seed
```
これで管理者（`admin@example.com / ChangeMe123!`）などの初期データが投入されます。

## 5. 開発サーバーの起動
```bash
npm run dev
```
`http://localhost:3000` にアクセスし、上記アカウントでログインします。チャット画面から以下を確認できます。
- 会話一覧 / 新規相談作成
- メッセージ送信と LLM 翻訳のスタブ表示
- 相談記録（カテゴリ・優先度・ステータス等）の編集

## 6. 終了
```bash
npm run dev:db:down
```

## トラブルシューティング
- **DB 接続エラー**: PostgreSQL が起動しているか確認し、`.env` の `DATABASE_URL` を実際の接続情報に合わせてください。
- **LLM エラー**: `OPENAI_API_KEY` が未設定の場合、翻訳・提案はフォールバック動作（固定文言）になります。

これで動作確認が可能です。
