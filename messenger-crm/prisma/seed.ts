import { hash } from "bcryptjs"
import { PrismaClient, UserRole, MembershipRole } from "@prisma/client"

const prisma = new PrismaClient()

async function seed() {
  const password = await hash("ChangeMe123!", 10)

  const organization = await prisma.organization.upsert({
    where: { id: "org-global" },
    update: {},
    create: {
      id: "org-global",
      name: "Global Support Org",
      description: "多言語チャットを提供する組織",
    },
  })

  const group = await prisma.group.upsert({
    where: {
      organizationId_name: {
        organizationId: organization.id,
        name: "Default Store",
      },
    },
    update: {},
    create: {
      id: "group-default-store",
      name: "Default Store",
      organizationId: organization.id,
      description: "初期導入用の店舗グループ",
    },
  })

  const systemAdmin = await prisma.user.upsert({
    where: { email: "admin@example.com" },
    update: {},
    create: {
      id: "user-admin",
      email: "admin@example.com",
      name: "System Admin",
      passwordHash: password,
      role: UserRole.SYSTEM_ADMIN,
      locale: "ja-JP",
    },
  })

  const manager = await prisma.user.upsert({
    where: { email: "manager@example.com" },
    update: {},
    create: {
      id: "user-manager",
      email: "manager@example.com",
      name: "Default Manager",
      passwordHash: password,
      role: UserRole.MANAGER,
      locale: "ja-JP",
    },
  })

  await prisma.groupMembership.upsert({
    where: {
      groupId_userId: {
        groupId: group.id,
        userId: manager.id,
      },
    },
    update: { role: MembershipRole.MANAGER },
    create: {
      id: "membership-manager-default",
      groupId: group.id,
      userId: manager.id,
      role: MembershipRole.MANAGER,
    },
  })

  const worker = await prisma.user.upsert({
    where: { email: "worker@example.com" },
    update: {},
    create: {
      id: "user-worker",
      email: "worker@example.com",
      name: "Foreign Worker",
      passwordHash: password,
      role: UserRole.WORKER,
      locale: "vi",
    },
  })

  await prisma.groupMembership.upsert({
    where: {
      groupId_userId: {
        groupId: group.id,
        userId: worker.id,
      },
    },
    update: { role: MembershipRole.MEMBER },
    create: {
      id: "membership-worker-default",
      groupId: group.id,
      userId: worker.id,
      role: MembershipRole.MEMBER,
    },
  })

  const conversation = await prisma.conversation.upsert({
    where: { id: "seed-default-conversation" },
    update: {},
    create: {
      id: "seed-default-conversation",
      workerId: worker.id,
      groupId: group.id,
      subject: "初期問い合わせ",
    },
  })

  await prisma.message.createMany({
    data: [
      {
        id: "seed-message-1",
        conversationId: conversation.id,
        senderId: worker.id,
        body: "Xin chào! Tôi cần hỗ trợ.",
        language: "vi",
      },
      {
        id: "seed-message-2",
        conversationId: conversation.id,
        senderId: manager.id,
        body: "こんにちは。どのようなサポートが必要ですか？",
        language: "ja",
      },
    ],
    skipDuplicates: true,
  })

  console.log("Seed completed.")
}

seed()
  .catch((error) => {
    console.error("Seed failed", error)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
