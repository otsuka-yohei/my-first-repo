-- CreateEnum
CREATE TYPE "HealthConsultationState" AS ENUM ('INITIAL_DETECTED', 'WAITING_FOR_INTENT', 'WAITING_FOR_SCHEDULE', 'PROVIDING_FACILITIES', 'PROVIDING_INSTRUCTIONS', 'COMPLETED');

-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "healthConsultationData" JSONB,
ADD COLUMN     "healthConsultationState" "HealthConsultationState";
