# Messenger CRM Architecture Proposal

## 1. Overview
Messenger CRM delivers multilingual chat, consultation tracking, and AI-assisted responses for foreign workers and store management teams. The system runs on the existing Next.js frontend, extended with API Routes, Prisma ORM, and a managed PostgreSQL database. Authentication and authorization govern access across four roles, while LLM services translate incoming messages and draft reply suggestions.

## 2. Deployment Target
- **Frontend & API**: Next.js 15 deployed on Vercel (Node runtime). Edge functions are optional; core APIs run on the default server runtime.
- **Database**: Managed PostgreSQL (Neon, Supabase, Render, etc.). Connection string injected through environment variables.
- **Secrets & LLM Providers**: OpenAI (or Azure OpenAI) API keys stored in environment variables, configured via Vercel project settings.

## 3. Core Technology Stack
- Next.js App Router with client/server components.
- Prisma 5.x with PostgreSQL provider.
- NextAuth v5 ("next-auth") for session management, credential login, and optional OAuth in the future.
- Zod for runtime validation of request payloads.
- bcrypt for password hashing.
- Testing: Vitest for unit tests, Playwright (optional) for E2E.

## 4. Data Model (Prisma Schema Draft)
```
model User {
  id              String              @id @default(cuid())
  email           String              @unique
  passwordHash    String
  name            String
  role            UserRole
  locale          String              @default("ja-JP")
  avatarUrl       String?
  timeZone        String?             @default("Asia/Tokyo")
  memberships     GroupMembership[]
  conversations   Conversation[]      @relation("ConversationOwner")
  messages        Message[]
  createdAt       DateTime            @default(now())
  updatedAt       DateTime            @updatedAt
}

enum UserRole {
  WORKER          // 外国人労働者
  MANAGER         // 店長
  AREA_MANAGER    // エリアマネージャー
  SYSTEM_ADMIN    // システム管理者
}

model Organization {
  id              String              @id @default(cuid())
  name            String
  description     String?
  groups          Group[]
  createdAt       DateTime            @default(now())
  updatedAt       DateTime            @updatedAt
}

model Group {
  id              String              @id @default(cuid())
  organization    Organization        @relation(fields: [organizationId], references: [id])
  organizationId  String
  name            String
  description     String?
  memberships     GroupMembership[]
  conversations   Conversation[]
  createdAt       DateTime            @default(now())
  updatedAt       DateTime            @updatedAt
}

model GroupMembership {
  id              String              @id @default(cuid())
  group           Group               @relation(fields: [groupId], references: [id])
  groupId         String
  user            User                @relation(fields: [userId], references: [id])
  userId          String
  role            MembershipRole
  createdAt       DateTime            @default(now())
}

enum MembershipRole {
  MEMBER          // 一般閲覧
  MANAGER         // グループ管理
}

model Conversation {
  id              String              @id @default(cuid())
  group           Group               @relation(fields: [groupId], references: [id])
  groupId         String
  worker          User                @relation("ConversationOwner", fields: [workerId], references: [id])
  workerId        String
  subject         String?
  status          ConversationStatus  @default(ACTIVE)
  messages        Message[]
  consultation    ConsultationCase?
  createdAt       DateTime            @default(now())
  updatedAt       DateTime            @updatedAt
}

enum ConversationStatus {
  ACTIVE
  CLOSED
  ESCALATED
}

model Message {
  id              String              @id @default(cuid())
  conversation    Conversation        @relation(fields: [conversationId], references: [id])
  conversationId  String
  sender          User                @relation(fields: [senderId], references: [id])
  senderId        String
  body            String
  language        String              // ISO language tag
  type            MessageType         @default(TEXT)
  contentUrl      String?
  metadata        Json?
  llmArtifacts    MessageLLMArtifact?
  createdAt       DateTime            @default(now())
}

enum MessageType {
  TEXT
  IMAGE
  FILE
}

model MessageLLMArtifact {
  id              String              @id @default(cuid())
  message         Message             @relation(fields: [messageId], references: [id])
  messageId       String
  translation     String?
  translationLang String?             // ex: "ja-JP"
  suggestions     Json?               // array of suggestion objects
  sentiment       String?
  extra           Json?
  createdAt       DateTime            @default(now())
}

model ConsultationCase {
  id              String              @id @default(cuid())
  conversation    Conversation        @relation(fields: [conversationId], references: [id])
  conversationId  String
  summary         String?
  category        String
  description     String?
  status          CaseStatus          @default(IN_PROGRESS)
  priority        CasePriority        @default(MEDIUM)
  closedAt        DateTime?
  createdAt       DateTime            @default(now())
  updatedAt       DateTime            @updatedAt
}

enum CaseStatus {
  IN_PROGRESS
  RESOLVED
  ESCALATED
  ON_HOLD
}

enum CasePriority {
  HIGH
  MEDIUM
  LOW
}

model AuditLog {
  id              String              @id @default(cuid())
  actor           User?               @relation(fields: [actorId], references: [id])
  actorId         String?
  action          String
  entityType      String
  entityId        String
  changes         Json?
  createdAt       DateTime            @default(now())
}
```

### Relations Summary
- User ↔ Group: many-to-many via GroupMembership.
- Conversation belongs to one Group and one worker (User with WORKER role).
- Messages belong to Conversations; each Message may have a corresponding LLM artifact row.
- ConsultationCase gives structured follow-up for a Conversation.
- AuditLog captures key mutations for compliance.

## 5. Authentication & Authorization
- NextAuth credentials provider backed by Prisma `User`. Passwords hashed with bcrypt.
- Session stored via JWT (default) with role, organization IDs, and membership metadata.
- Middleware (`middleware.ts`) guards `/app/(secure)` routes. Server components use `getServerSession`.
- Authorization helpers expose role checks:
  - WORKER: read/write messages in their own conversations.
  - MANAGER: manage users and conversations within assigned group(s).
  - AREA_MANAGER: access multiple groups inside their organization.
  - SYSTEM_ADMIN: global access; can manage organizations, groups, users.
- Add RBAC utility (e.g., `hasPermission(user, resource, action)`).

## 6. API Surface (Route Handlers)
- `POST /api/auth/register` – for admin provisioning (optional self-signup).
- `GET/POST /api/users` – system-admin operations, includes role assignment.
- `GET /api/groups` – list groups visible to the authenticated user.
- `GET/POST /api/conversations` – fetch or open worker conversations.
- `GET/POST /api/conversations/[id]/messages` – send and fetch chat messages.
- `POST /api/conversations/[id]/messages/[msgId]/llm` – trigger translation/suggestions refresh.
- `GET/PUT /api/consultations/[conversationId]` – manage consultation metadata.
- `GET /api/reports` – aggregate metrics, permission-scoped.
- Shared validation with Zod; responses follow JSON:API style payloads.

## 7. LLM Integration Strategy
- `src/server/llm/client.ts`: wrapper around OpenAI SDK. Functions: `translateMessage`, `generateSuggestions`, `summarizeConversation`.
- `MessageService` triggers translation and suggestions after a message is stored. For synchronous MVP, perform LLM calls inline; later swap to background jobs (e.g., Vercel Cron + Upstash queue) using `LLMTask` table to track status.
- Cache translations/suggestions in `MessageLLMArtifact` to avoid redundant calls. Include fields for source/target language codes and model version.
- Fallback path logs failures to `AuditLog` with retry flag.

## 8. Frontend Integration
- Client components fetch conversations via SWR/React Query or Next.js Server Actions.
- Role-specific dashboards:
  - Worker view: personal conversation thread, knowledge base.
  - Manager/Area Manager: conversation list filtered by group(s), consultation board, reports.
  - System Admin: organization setup screens.
- Update existing mock data to use real API calls. Introduce `ConversationLayout` component that handles responsive split views (list/chat/suggestions/info) with actual data.

## 9. Environment & DevOps
- `.env` variables:
  - `DATABASE_URL` (PostgreSQL connection string)
  - `NEXTAUTH_SECRET`, `NEXTAUTH_URL`
  - `OPENAI_API_KEY`
- `prisma/schema.prisma` with datasource + generator blocks.
- `npx prisma migrate dev` for local migrations; `prisma migrate deploy` in CI/CD.
- Seed script to bootstrap roles, admin account, sample data.
- CI pipeline: lint, typecheck, prisma format, tests. Ensure migrations run against ephemeral DB.

## 10. Implementation Roadmap
1. Initialize Prisma, create schema, generate client.
2. Add NextAuth configuration, secure app routes, seed admin.
3. Build conversation/message APIs with validation and RBAC checks.
4. Integrate LLM service wrapper and update message flow to persist artifacts.
5. Replace frontend mock data with API consumption, add optimistic UI for chat.
6. Implement reports/consultation screens, add role-specific navigation.
7. Harden with tests (unit + integration) and monitoring (audit logs, error tracking).
8. Prepare deployment scripts (Vercel + managed Postgres) and documentation.
