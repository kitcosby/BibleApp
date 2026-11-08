import pg from "pg";
const { Pool } = pg;
const connectionString = process.env.HEBREW_VARIANT_DATABASE_URL;
export const hebrewVariantPool = connectionString
  ? new Pool({
      connectionString,
      max: 5,
      connectionTimeoutMillis: 3000,
      idleTimeoutMillis: 30000,
      statement_timeout: 5000,
      query_timeout: 7000,
      application_name: "bible-hebrew-variant-api",
      options: "-c default_transaction_read_only=on -c search_path=public",
    })
  : null;