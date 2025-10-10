import { hash } from "bcryptjs"
import { PrismaClient, UserRole, MembershipRole } from "@prisma/client"

const prisma = new PrismaClient()

async function seed() {
  console.log("🌱 Starting database seed...")

  const password = await hash("ChangeMe123!", 10)

  // 組織の作成
  console.log("Creating organization...")
  const organization = await prisma.organization.upsert({
    where: { id: "org-global" },
    update: {},
    create: {
      id: "org-global",
      name: "Global Support Org",
      description: "多言語チャットを提供する組織",
    },
  })

  // グループの作成
  console.log("Creating groups...")
  const defaultStore = await prisma.group.upsert({
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
      description: "江東区の製造・倉庫拠点",
      phoneNumber: "03-5500-1234",
      address: "〒135-0064 東京都江東区青海2-7-4 りんかい線国際展示場駅前ビル3F",
    },
  })

  const tokyoStore = await prisma.group.upsert({
    where: {
      organizationId_name: {
        organizationId: organization.id,
        name: "Tokyo Store",
      },
    },
    update: {},
    create: {
      id: "group-tokyo-store",
      name: "Tokyo Store",
      organizationId: organization.id,
      description: "新宿区の食品加工センター",
      phoneNumber: "03-3360-5678",
      address: "〒160-0023 東京都新宿区西新宿8-14-24 西新宿KFビル2F",
    },
  })

  // ユーザーの作成
  console.log("Creating users...")

  // システム管理者
  const systemAdmin = await prisma.user.upsert({
    where: { email: "admin@example.com" },
    update: {},
    create: {
      id: "user-admin",
      email: "admin@example.com",
      name: "システム管理者",
      passwordHash: password,
      role: UserRole.SYSTEM_ADMIN,
      locale: "ja",
    },
  })

  // マネージャー1（Default Store）
  const manager1 = await prisma.user.upsert({
    where: { email: "manager1@example.com" },
    update: {},
    create: {
      id: "user-manager-1",
      email: "manager1@example.com",
      name: "マネージャー 1",
      passwordHash: password,
      role: UserRole.MANAGER,
      locale: "ja",
    },
  })

  // マネージャー2（Tokyo Store）
  const manager2 = await prisma.user.upsert({
    where: { email: "manager2@example.com" },
    update: {},
    create: {
      id: "user-manager-2",
      email: "manager2@example.com",
      name: "マネージャー 2",
      passwordHash: password,
      role: UserRole.MANAGER,
      locale: "ja",
    },
  })

  // ワーカー1（ベトナム語）
  const worker1 = await prisma.user.upsert({
    where: { email: "worker1@example.com" },
    update: {},
    create: {
      id: "user-worker-1",
      email: "worker1@example.com",
      name: "Nguyễn Văn An",
      passwordHash: password,
      role: UserRole.MEMBER,
      locale: "vi",
      dateOfBirth: new Date("1995-03-15"),
      gender: "男性",
      address: "〒135-0064 東京都江東区青海2-7-4",
      phoneNumber: "090-1234-5678",
      countryOfOrigin: "ベトナム",
      jobDescription: "製造ライン作業、検品作業",
      hireDate: new Date("2023-04-01"),
    },
  })

  // ワーカー2（ベトナム語）
  const worker2 = await prisma.user.upsert({
    where: { email: "worker2@example.com" },
    update: {},
    create: {
      id: "user-worker-2",
      email: "worker2@example.com",
      name: "Trần Thị Bình",
      passwordHash: password,
      role: UserRole.MEMBER,
      locale: "vi",
      dateOfBirth: new Date("1998-07-22"),
      gender: "女性",
      address: "〒144-0052 東京都大田区蒲田5-13-1",
      phoneNumber: "080-9876-5432",
      countryOfOrigin: "ベトナム",
      jobDescription: "倉庫管理、ピッキング作業",
      hireDate: new Date("2023-06-15"),
    },
  })

  // ワーカー3（英語）
  const worker3 = await prisma.user.upsert({
    where: { email: "worker3@example.com" },
    update: {},
    create: {
      id: "user-worker-3",
      email: "worker3@example.com",
      name: "Maria Santos",
      passwordHash: password,
      role: UserRole.MEMBER,
      locale: "en",
      dateOfBirth: new Date("1992-11-08"),
      gender: "女性",
      address: "〒160-0023 東京都新宿区西新宿8-14-24",
      phoneNumber: "070-5555-1234",
      countryOfOrigin: "フィリピン",
      jobDescription: "食品加工、パッケージング",
      hireDate: new Date("2022-10-01"),
    },
  })

  // グループメンバーシップの作成
  console.log("Creating group memberships...")

  // Default Storeのメンバーシップ
  await prisma.groupMembership.upsert({
    where: {
      groupId_userId: {
        groupId: defaultStore.id,
        userId: manager1.id,
      },
    },
    update: { role: MembershipRole.MANAGER },
    create: {
      id: "membership-manager1-default",
      groupId: defaultStore.id,
      userId: manager1.id,
      role: MembershipRole.MANAGER,
    },
  })

  await prisma.groupMembership.upsert({
    where: {
      groupId_userId: {
        groupId: defaultStore.id,
        userId: worker1.id,
      },
    },
    update: { role: MembershipRole.MEMBER },
    create: {
      id: "membership-worker1-default",
      groupId: defaultStore.id,
      userId: worker1.id,
      role: MembershipRole.MEMBER,
    },
  })

  await prisma.groupMembership.upsert({
    where: {
      groupId_userId: {
        groupId: defaultStore.id,
        userId: worker2.id,
      },
    },
    update: { role: MembershipRole.MEMBER },
    create: {
      id: "membership-worker2-default",
      groupId: defaultStore.id,
      userId: worker2.id,
      role: MembershipRole.MEMBER,
    },
  })

  // Tokyo Storeのメンバーシップ
  await prisma.groupMembership.upsert({
    where: {
      groupId_userId: {
        groupId: tokyoStore.id,
        userId: manager2.id,
      },
    },
    update: { role: MembershipRole.MANAGER },
    create: {
      id: "membership-manager2-tokyo",
      groupId: tokyoStore.id,
      userId: manager2.id,
      role: MembershipRole.MANAGER,
    },
  })

  await prisma.groupMembership.upsert({
    where: {
      groupId_userId: {
        groupId: tokyoStore.id,
        userId: worker3.id,
      },
    },
    update: { role: MembershipRole.MEMBER },
    create: {
      id: "membership-worker3-tokyo",
      groupId: tokyoStore.id,
      userId: worker3.id,
      role: MembershipRole.MEMBER,
    },
  })

  console.log("✅ Seed completed successfully!")
  console.log("\n🏢 Organization: Global Support Org")
  console.log("\n📍 Groups:")
  console.log("  - Default Store (江東区の製造・倉庫拠点)")
  console.log("    TEL: 03-5500-1234")
  console.log("    住所: 〒135-0064 東京都江東区青海2-7-4 りんかい線国際展示場駅前ビル3F")
  console.log("\n  - Tokyo Store (新宿区の食品加工センター)")
  console.log("    TEL: 03-3360-5678")
  console.log("    住所: 〒160-0023 東京都新宿区西新宿8-14-24 西新宿KFビル2F")
  console.log("\n📋 Created accounts:")
  console.log("  - System Admin: admin@example.com")
  console.log("  - Manager 1: manager1@example.com (Default Store)")
  console.log("  - Manager 2: manager2@example.com (Tokyo Store)")
  console.log("\n  Workers (Default Store):")
  console.log("  - Worker 1: worker1@example.com (Nguyễn Văn An - Vietnamese)")
  console.log("    入社日: 2023/04/01 | 業務: 製造ライン作業、検品作業")
  console.log("  - Worker 2: worker2@example.com (Trần Thị Bình - Vietnamese)")
  console.log("    入社日: 2023/06/15 | 業務: 倉庫管理、ピッキング作業")
  console.log("\n  Workers (Tokyo Store):")
  console.log("  - Worker 3: worker3@example.com (Maria Santos - English)")
  console.log("    入社日: 2022/10/01 | 業務: 食品加工、パッケージング")
  console.log("\n🔑 All passwords: ChangeMe123!")
  console.log("\n💬 No conversations created - start fresh!")
}

seed()
  .catch((error) => {
    console.error("Seed failed", error)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
