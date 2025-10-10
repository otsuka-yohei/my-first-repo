-- AlterEnum: Rename WORKER to MEMBER in UserRole enum
-- PostgreSQLのenum制約により、enum値の追加と削除を同一トランザクションで行うため
-- 直接新しいenumを作成して置き換える方法を使用

-- Create new enum with MEMBER instead of WORKER
CREATE TYPE "UserRole_new" AS ENUM ('MEMBER', 'MANAGER', 'AREA_MANAGER', 'SYSTEM_ADMIN');

-- Update the User table to use the new enum
-- WORKER values will be mapped to MEMBER
ALTER TABLE "User" ALTER COLUMN role TYPE "UserRole_new"
  USING (CASE
    WHEN role::text = 'WORKER' THEN 'MEMBER'::text
    ELSE role::text
  END)::"UserRole_new";

-- Drop the old enum and rename the new one
DROP TYPE "UserRole";
ALTER TYPE "UserRole_new" RENAME TO "UserRole";
