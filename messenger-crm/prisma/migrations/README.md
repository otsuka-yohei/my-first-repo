# Prisma Migrations

このディレクトリには Prisma のマイグレーションファイルが格納されます。現時点では実行済みマイグレーションは存在しないため、以下の手順で初期マイグレーションを作成してください。

```bash
npm run prisma:migrate -- --name init
```

PostgreSQL に接続可能な `DATABASE_URL` を `.env` に設定した上で実行することで、`prisma/migrations/<timestamp>_init` が作成され、`prisma/schema.prisma` の定義に基づいたテーブルが生成されます。

## シードデータ

初期データ投入は `prisma/seed.ts` から行います。`npm run prisma:generate` 実行後、以下のコマンドでシードが可能です。

```bash
npm run prisma:seed
```

（`package.json` の `prisma.seed` に `ts-node` を利用する設定を追加予定）
