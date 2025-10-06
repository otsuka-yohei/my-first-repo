import { z } from "zod"

const optionalString = z
  .string()
  .optional()
  .transform((val) => {
    if (!val) {
      return undefined
    }
    const trimmed = val.trim()
    return trimmed.length > 0 ? trimmed : undefined
  })

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]),
  DATABASE_URL: z.string().url(),
  NEXTAUTH_SECRET: z.string().min(1),
  NEXTAUTH_URL: z.preprocess((val) => {
    if (typeof val !== "string") return val
    const trimmed = val.trim()
    return trimmed.length === 0 ? undefined : trimmed
  }, z.string().url().optional()),
  OPENAI_API_KEY: optionalString,
  GOOGLE_TRANSLATE_API_KEY: optionalString,
  GOOGLE_SUGGEST_API_KEY: optionalString,
})

const rawEnv = {
  NODE_ENV: process.env.NODE_ENV,
  DATABASE_URL: process.env.DATABASE_URL,
  NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET,
  NEXTAUTH_URL: process.env.NEXTAUTH_URL,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  GOOGLE_TRANSLATE_API_KEY: process.env.GOOGLE_TRANSLATE_API_KEY,
  GOOGLE_SUGGEST_API_KEY: process.env.GOOGLE_SUGGEST_API_KEY,
}

const parsed = envSchema.safeParse(rawEnv)

if (!parsed.success) {
  console.error("[env] Missing or invalid environment variables", parsed.error.flatten().fieldErrors)
  throw new Error("Invalid environment configuration")
}

export const env = parsed.data
