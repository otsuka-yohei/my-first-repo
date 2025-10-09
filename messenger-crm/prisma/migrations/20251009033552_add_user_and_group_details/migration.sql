-- AlterTable
ALTER TABLE "Group" ADD COLUMN     "address" TEXT,
ADD COLUMN     "phoneNumber" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "address" TEXT,
ADD COLUMN     "countryOfOrigin" TEXT,
ADD COLUMN     "dateOfBirth" TIMESTAMP(3),
ADD COLUMN     "gender" TEXT,
ADD COLUMN     "hireDate" TIMESTAMP(3),
ADD COLUMN     "jobDescription" TEXT,
ADD COLUMN     "phoneNumber" TEXT;
