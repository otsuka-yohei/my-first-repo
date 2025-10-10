-- AlterEnum: Rename WORKER to MEMBER in UserRole enum
-- First, add the new MEMBER value to the enum
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'MEMBER';

-- Update all existing WORKER records to MEMBER
UPDATE "User" SET role = 'MEMBER' WHERE role = 'WORKER';

-- Update all existing message senders with WORKER role to MEMBER
-- Note: This is handled by the foreign key, so no direct update needed

-- Remove the old WORKER value from the enum
-- This is done by creating a new enum and replacing the old one
CREATE TYPE "UserRole_new" AS ENUM ('MEMBER', 'MANAGER', 'AREA_MANAGER', 'SYSTEM_ADMIN');

-- Update the User table to use the new enum
ALTER TABLE "User" ALTER COLUMN role TYPE "UserRole_new" USING (role::text::"UserRole_new");

-- Drop the old enum and rename the new one
DROP TYPE "UserRole";
ALTER TYPE "UserRole_new" RENAME TO "UserRole";
