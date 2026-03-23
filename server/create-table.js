#!/usr/bin/env node
/**
 * Create wortheyflow_leads table in Supabase using SQL via HTTP
 */

const https = require('https');

const SUPABASE_URL = 'https://ylxreuqvofgbpsatfsvr.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlseHJldXF2b2ZnYnBzYXRmc3ZyIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTg1NzE4MCwiZXhwIjoyMDg3NDMzMTgwfQ.DxTv7ZC0oNRHBBS0Jxquh1M0wsGV8fQ005Q9S2iILdE';

// Try creating via Postgres connection using node-postgres
const { Client } = require('pg');

const client = new Client({
    connectionString: 'postgresql://postgres:h1AVVY1oXH9kJcwz@db.ylxreuqvofgbpsatfsvr.supabase.co:5432/postgres',
    ssl: { rejectUnauthorized: false }
});

const SQL = `
CREATE TABLE IF NOT EXISTS wortheyflow_leads (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  phone TEXT,
  email TEXT,
  email_hers TEXT,
  company TEXT,
  address TEXT,
  city TEXT,
  state TEXT DEFAULT 'TX',
  zip TEXT,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  job_type TEXT DEFAULT 'New Pool',
  source TEXT,
  stage TEXT DEFAULT 'New',
  salesperson TEXT,
  quote_amount NUMERIC DEFAULT 0,
  notes TEXT,
  next_action TEXT,
  next_action_date TEXT,
  loss_reason TEXT,
  equipment_age TEXT,
  ghl_id TEXT,
  ghl_tags TEXT,
  ghl_contact_id TEXT,
  ghl_raw JSONB,
  activities JSONB DEFAULT '[]',
  first_contact_at BIGINT DEFAULT 0,
  created_at BIGINT NOT NULL DEFAULT 0,
  stage_changed_at BIGINT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
`;

async function createTable() {
    try {
        console.log('🔌 Connecting to Supabase Postgres...');
        await client.connect();
        console.log('✅ Connected!');

        console.log('\n📝 Creating wortheyflow_leads table...');
        await client.query(SQL);
        console.log('✅ Table created successfully!');

        // Verify table exists
        const result = await client.query(`
            SELECT table_name
            FROM information_schema.tables
            WHERE table_schema = 'public'
            AND table_name = 'wortheyflow_leads'
        `);

        if (result.rows.length > 0) {
            console.log('✅ Verified: wortheyflow_leads table exists');
        } else {
            console.log('⚠️  Warning: Table was not found after creation');
        }

        await client.end();
        console.log('\n✨ Done! You can now run: node migrate-to-supabase.js\n');
    } catch (error) {
        console.error('❌ Error:', error.message);
        console.error('\n📝 Please create the table manually in Supabase SQL Editor:');
        console.error('   https://supabase.com/dashboard/project/ylxreuqvofgbpsatfsvr/sql/new\n');
        console.error(SQL);
        process.exit(1);
    }
}

createTable();
