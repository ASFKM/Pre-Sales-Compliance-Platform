import "dotenv/config";
import { defineConfig, env } from "prisma/config";

// Prisma 7 removed schema-file datasource URLs and the package.json#prisma config block
// entirely - both the CLI (migrate/generate/seed) and the runtime client now need their
// connection info supplied explicitly. This file covers the CLI side; the runtime client
// (src/prisma.ts) gets its connection string separately via a @prisma/adapter-pg driver
// adapter, since Prisma 7 also removed the bundled Rust query engine the client used to read
// the schema's datasource url from automatically.
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: env("DATABASE_URL"),
  },
});
