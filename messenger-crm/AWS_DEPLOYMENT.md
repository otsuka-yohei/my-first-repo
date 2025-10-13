# AWS環境へのデプロイガイド

## 概要

WebSocketを使用したNext.jsアプリケーションをAWSにデプロイする際の考慮事項と推奨アーキテクチャをまとめました。

## 主要な考慮事項

### 1. WebSocketの制約

AWSの多くのサービスにはWebSocketに関する制約があります：

| サービス | WebSocket対応 | 備考 |
|---------|--------------|------|
| AWS Lambda | ❌ 長時間接続不可 | タイムアウト15分、状態を保持できない |
| Amazon API Gateway (REST) | ❌ 非対応 | HTTP通信のみ |
| Amazon API Gateway (WebSocket) | ✅ 対応 | 別途実装が必要 |
| AWS Fargate / ECS | ✅ 対応 | コンテナでNode.jsサーバーを起動 |
| Amazon EC2 | ✅ 対応 | 通常のサーバーとして動作 |
| AWS App Runner | ✅ 対応 | コンテナベース、簡単デプロイ |
| Elastic Beanstalk | ✅ 対応 | Node.jsプラットフォーム |

---

## 推奨アーキテクチャパターン

### パターンA: ECS Fargate + ALB（推奨）

**最もスケーラブルで管理しやすい構成**

```
┌──────────────┐
│   Route 53   │ DNS管理
└──────┬───────┘
       │
┌──────▼────────────────────────────────────┐
│   CloudFront (Optional)                   │ CDN、静的アセットキャッシュ
└──────┬────────────────────────────────────┘
       │
┌──────▼────────────────────────────────────┐
│   Application Load Balancer (ALB)        │ HTTPSターミネーション、WebSocket対応
└──────┬────────────────────────────────────┘
       │
       │ Target Group (Sticky Session有効)
       │
┌──────▼────────────────────────────────────┐
│   ECS Fargate Cluster                     │
│   ┌─────────────────────────────────┐    │
│   │  Task 1: Next.js + Socket.io    │    │
│   │  (server.ts)                     │    │
│   └─────────────────────────────────┘    │
│   ┌─────────────────────────────────┐    │
│   │  Task 2: Next.js + Socket.io    │    │ Auto Scaling
│   └─────────────────────────────────┘    │
└───────────────────────────────────────────┘
       │
       │ VPC Peering / PrivateLink
       │
┌──────▼────────────────────────────────────┐
│   RDS (PostgreSQL / MySQL)                │ データベース
└───────────────────────────────────────────┘
```

#### メリット
- ✅ フルマネージド、サーバー管理不要
- ✅ 自動スケーリング対応
- ✅ コンテナベースで環境再現性が高い
- ✅ ALBがWebSocketを完全サポート
- ✅ ヘルスチェック、ログ管理が充実

#### コスト目安
- ALB: 約$22/月 + トラフィック料金
- Fargate: 0.25vCPU/0.5GB × 2タスク = 約$30-40/月
- 合計: 約$50-70/月（小規模）

---

### パターンB: EC2 + Auto Scaling Group

**従来型、最も柔軟性が高い**

```
┌──────────────┐
│   Route 53   │
└──────┬───────┘
       │
┌──────▼────────────────────────────────────┐
│   Application Load Balancer               │
└──────┬────────────────────────────────────┘
       │
┌──────▼────────────────────────────────────┐
│   Auto Scaling Group                      │
│   ┌─────────────────────────────────┐    │
│   │  EC2 Instance 1 (t3.small)      │    │
│   │  - Node.js                       │    │
│   │  - PM2                           │    │
│   │  - nginx (reverse proxy)         │    │
│   └─────────────────────────────────┘    │
│   ┌─────────────────────────────────┐    │
│   │  EC2 Instance 2                  │    │
│   └─────────────────────────────────┘    │
└───────────────────────────────────────────┘
```

#### メリット
- ✅ 完全なコントロールが可能
- ✅ デバッグが容易
- ✅ 既存のEC2運用知識を活用

#### デメリット
- ❌ サーバー管理が必要（パッチ適用、セキュリティ更新）
- ❌ スケーリングの設定が複雑

#### コスト目安
- EC2 (t3.small × 2): 約$30/月
- ALB: 約$22/月
- 合計: 約$50-60/月

---

### パターンC: App Runner（最も簡単）

**シンプルさ重視、小規模アプリに最適**

```
┌──────────────┐
│   Route 53   │
└──────┬───────┘
       │
┌──────▼────────────────────────────────────┐
│   AWS App Runner                          │
│   - 自動的にHTTPS、ドメイン提供           │
│   - コンテナを自動デプロイ                │
│   - WebSocket完全対応                     │
│   - 自動スケーリング                      │
└───────────────────────────────────────────┘
```

#### メリット
- ✅ 最もシンプルな設定
- ✅ GitHubと連携した自動デプロイ
- ✅ HTTPSが自動設定
- ✅ WebSocket対応

#### デメリット
- ❌ カスタマイズ性が低い
- ❌ VPC統合が限定的

#### コスト目安
- 約$25-40/月（トラフィック次第）

---

### パターンD: API Gateway WebSocket + Lambda（非推奨）

**理論上は可能だが、複雑で推奨しない**

```
┌──────────────┐
│   Route 53   │
└──────┬───────┘
       │
┌──────▼────────────────────────────────────┐
│   API Gateway (WebSocket API)             │
└──────┬────────────────────────────────────┘
       │
┌──────▼────────────────────────────────────┐
│   Lambda Functions                        │
│   - $connect                              │
│   - $disconnect                           │
│   - $default (メッセージハンドラ)        │
└──────┬────────────────────────────────────┘
       │
┌──────▼────────────────────────────────────┐
│   DynamoDB (接続管理テーブル)             │
└───────────────────────────────────────────┘
```

#### デメリット
- ❌ Socket.ioとの互換性なし（完全な書き換えが必要）
- ❌ 複雑な状態管理が必要
- ❌ 接続情報をDynamoDBで管理する必要がある
- ❌ 実装コストが高い

---

## 推奨構成：ECS Fargate + ALBの詳細設計

### 1. Dockerfileの作成

```dockerfile
# /Users/yohei_otsuka/my-first-repo-1/messenger-crm/Dockerfile
FROM node:20-alpine AS base

# 依存関係のインストール
FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ビルド
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Prismaクライアント生成
RUN npx prisma generate

# Next.jsビルド（静的アセット生成）
RUN npm run build

# 本番環境
FROM base AS runner
WORKDIR /app

ENV NODE_ENV production

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/server.ts ./server.ts

USER nextjs

EXPOSE 3000

ENV PORT 3000
ENV HOSTNAME "0.0.0.0"

# カスタムサーバー（server.ts）で起動
CMD ["node", "server.ts"]
```

### 2. next.config.tsの更新

```typescript
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'standalone', // Dockerビルド用
  // 本番環境用の設定
};

export default nextConfig;
```

### 3. server.tsの本番環境対応

現在の [server.ts](messenger-crm/server.ts#L7) は `localhost` 固定なので、以下のように修正：

```typescript
const dev = process.env.NODE_ENV !== 'production'
const hostname = process.env.HOSTNAME || '0.0.0.0' // すべてのインターフェースでリッスン
const port = parseInt(process.env.PORT || '3000', 10)

// CORS設定を環境変数から取得
const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || [
  'http://localhost:3000',
  'https://yourdomain.com'
]

const io = new SocketIOServer(httpServer, {
  cors: {
    origin: allowedOrigins,
    methods: ['GET', 'POST'],
    credentials: true
  },
  transports: ['websocket', 'polling']
})
```

### 4. ECS Task Definitionのサンプル

```json
{
  "family": "messenger-crm-websocket",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "256",
  "memory": "512",
  "containerDefinitions": [
    {
      "name": "messenger-crm",
      "image": "123456789.dkr.ecr.ap-northeast-1.amazonaws.com/messenger-crm:latest",
      "portMappings": [
        {
          "containerPort": 3000,
          "protocol": "tcp"
        }
      ],
      "environment": [
        {"name": "NODE_ENV", "value": "production"},
        {"name": "PORT", "value": "3000"},
        {"name": "HOSTNAME", "value": "0.0.0.0"},
        {"name": "DATABASE_URL", "value": "postgresql://..."}
      ],
      "secrets": [
        {
          "name": "NEXTAUTH_SECRET",
          "valueFrom": "arn:aws:secretsmanager:ap-northeast-1:123456789:secret:nextauth-secret"
        }
      ],
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/ecs/messenger-crm",
          "awslogs-region": "ap-northeast-1",
          "awslogs-stream-prefix": "ecs"
        }
      }
    }
  ]
}
```

### 5. ALBの設定（重要）

#### Sticky Session（セッション固定）を有効化

WebSocketでは、クライアントが同じサーバーインスタンスに接続し続ける必要があります。

```bash
# AWS CLIで設定
aws elbv2 modify-target-group-attributes \
  --target-group-arn <your-target-group-arn> \
  --attributes \
    Key=stickiness.enabled,Value=true \
    Key=stickiness.type,Value=lb_cookie \
    Key=stickiness.lb_cookie.duration_seconds,Value=86400
```

#### ヘルスチェックパス

```
Protocol: HTTP
Path: /api/health
Port: 3000
Healthy threshold: 2
Unhealthy threshold: 3
Timeout: 5 seconds
Interval: 30 seconds
```

ヘルスチェック用のAPIエンドポイントを作成：

```typescript
// src/app/api/health/route.ts
import { NextResponse } from 'next/server'

export async function GET() {
  return NextResponse.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    websocket: global.io ? 'connected' : 'not initialized'
  })
}
```

### 6. Redis Adapterの導入（複数インスタンス対応）

複数のECSタスクで動作させる場合、Redisを使ってSocket.ioの状態を共有：

```bash
npm install @socket.io/redis-adapter redis
```

```typescript
// server.ts
import { createAdapter } from '@socket.io/redis-adapter'
import { createClient } from 'redis'

const pubClient = createClient({
  url: process.env.REDIS_URL || 'redis://localhost:6379'
})
const subClient = pubClient.duplicate()

Promise.all([pubClient.connect(), subClient.connect()]).then(() => {
  io.adapter(createAdapter(pubClient, subClient))
  console.log('[WebSocket] Redis adapter connected')
})
```

---

## デプロイ手順（ECS Fargate）

### ステップ1: ECRにDockerイメージをプッシュ

```bash
# ECRリポジトリ作成
aws ecr create-repository --repository-name messenger-crm

# ログイン
aws ecr get-login-password --region ap-northeast-1 | \
  docker login --username AWS --password-stdin 123456789.dkr.ecr.ap-northeast-1.amazonaws.com

# ビルド
cd /Users/yohei_otsuka/my-first-repo-1/messenger-crm
docker build -t messenger-crm:latest .

# タグ付け
docker tag messenger-crm:latest \
  123456789.dkr.ecr.ap-northeast-1.amazonaws.com/messenger-crm:latest

# プッシュ
docker push 123456789.dkr.ecr.ap-northeast-1.amazonaws.com/messenger-crm:latest
```

### ステップ2: RDSデータベースのセットアップ

```bash
# RDS PostgreSQL作成（AWS Consoleまたはterraform/CDKで）
# 接続文字列をSecrets Managerに保存
aws secretsmanager create-secret \
  --name messenger-crm/database-url \
  --secret-string "postgresql://user:password@rds-endpoint:5432/messenger_crm"
```

### ステップ3: ECSクラスターとサービス作成

```bash
# ECSクラスター作成
aws ecs create-cluster --cluster-name messenger-crm-cluster

# タスク定義を登録
aws ecs register-task-definition --cli-input-json file://task-definition.json

# サービス作成
aws ecs create-service \
  --cluster messenger-crm-cluster \
  --service-name messenger-crm-service \
  --task-definition messenger-crm-websocket \
  --desired-count 2 \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[subnet-xxx],securityGroups=[sg-xxx],assignPublicIp=ENABLED}" \
  --load-balancers "targetGroupArn=arn:aws:elasticloadbalancing:...,containerName=messenger-crm,containerPort=3000"
```

### ステップ4: データベースマイグレーション

```bash
# 一時的なECSタスクでマイグレーション実行
aws ecs run-task \
  --cluster messenger-crm-cluster \
  --task-definition messenger-crm-websocket \
  --overrides '{
    "containerOverrides": [{
      "name": "messenger-crm",
      "command": ["npx", "prisma", "migrate", "deploy"]
    }]
  }'
```

---

## 環境変数の設定

### 必須の環境変数

```bash
# Next.js
NODE_ENV=production
PORT=3000
HOSTNAME=0.0.0.0
NEXTAUTH_URL=https://yourdomain.com
NEXTAUTH_SECRET=<your-secret>

# データベース
DATABASE_URL=postgresql://...

# WebSocket
ALLOWED_ORIGINS=https://yourdomain.com,https://www.yourdomain.com
NEXT_PUBLIC_SOCKET_URL=wss://yourdomain.com

# Redis（複数インスタンス時）
REDIS_URL=redis://elasticache-endpoint:6379

# AWS
AWS_REGION=ap-northeast-1
```

---

## モニタリングとログ

### CloudWatch Logsの設定

```bash
# ロググループ作成
aws logs create-log-group --log-group-name /ecs/messenger-crm

# メトリクスフィルター（WebSocket接続数）
aws logs put-metric-filter \
  --log-group-name /ecs/messenger-crm \
  --filter-name WebSocketConnections \
  --filter-pattern "[WebSocket] Client connected" \
  --metric-transformations \
    metricName=WebSocketConnections,metricNamespace=MessengerCRM,metricValue=1
```

### CloudWatch Alarms

```bash
# CPU使用率アラーム
aws cloudwatch put-metric-alarm \
  --alarm-name messenger-crm-high-cpu \
  --comparison-operator GreaterThanThreshold \
  --evaluation-periods 2 \
  --metric-name CPUUtilization \
  --namespace AWS/ECS \
  --period 300 \
  --statistic Average \
  --threshold 80 \
  --alarm-actions <sns-topic-arn>
```

---

## トラブルシューティング

### WebSocket接続が確立できない

1. **ALBのSticky Sessionが有効か確認**
   ```bash
   aws elbv2 describe-target-group-attributes --target-group-arn <arn>
   ```

2. **セキュリティグループでポート3000が開いているか**
   ```bash
   aws ec2 describe-security-groups --group-ids <sg-id>
   ```

3. **CORS設定が正しいか確認**
   - server.tsのallowedOriginsに本番ドメインが含まれているか

### メッセージが一部のクライアントに届かない

- **Redis Adapterが設定されているか確認**
  - 複数インスタンスの場合は必須

### データベース接続エラー

```bash
# RDSセキュリティグループでECSからの接続を許可
aws ec2 authorize-security-group-ingress \
  --group-id <rds-sg-id> \
  --protocol tcp \
  --port 5432 \
  --source-group <ecs-sg-id>
```

---

## コスト最適化

### Auto Scalingポリシー

```json
{
  "targetTrackingScaling": {
    "targetValue": 70.0,
    "predefinedMetricType": "ECSServiceAverageCPUUtilization",
    "scaleOutCooldown": 60,
    "scaleInCooldown": 300
  }
}
```

### Spot Instancesの活用（EC2パターン）

- On-Demand価格の最大90%削減
- WebSocket接続は切れる可能性があるため、フォールバック設計が必要

---

## セキュリティ考慮事項

### 1. 認証の強化

```typescript
// server.ts - 接続時に認証トークンを検証
io.use(async (socket, next) => {
  const token = socket.handshake.auth.token

  if (!token) {
    return next(new Error('Authentication required'))
  }

  try {
    // NextAuthのトークンを検証
    const decoded = await verifyToken(token)
    socket.data.userId = decoded.userId
    next()
  } catch (err) {
    next(new Error('Invalid token'))
  }
})
```

### 2. Rate Limiting

```typescript
import rateLimit from 'socket.io-rate-limiter'

io.use(rateLimit({
  tokensPerInterval: 10,
  interval: 1000, // 1秒あたり10メッセージ
  fireImmediately: true
}))
```

### 3. WAFの設定

```bash
# AWS WAFをALBに関連付け
aws wafv2 associate-web-acl \
  --web-acl-arn <waf-acl-arn> \
  --resource-arn <alb-arn>
```

---

## まとめ

### 推奨デプロイ方法の比較

| 項目 | App Runner | ECS Fargate | EC2 |
|------|-----------|-------------|-----|
| 難易度 | ⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐ |
| コスト | 中 | 中 | 低〜中 |
| スケーラビリティ | 高 | 高 | 中 |
| カスタマイズ性 | 低 | 高 | 最高 |
| 運用負荷 | 最低 | 低 | 高 |

**小規模〜中規模**: App Runner
**中規模〜大規模**: ECS Fargate + ALB + Redis
**エンタープライズ**: ECS Fargate + ALB + Redis + CloudFront

次のステップとして、実際にどの構成で進めるか決定しましょう！
