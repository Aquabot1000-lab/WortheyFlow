#!/usr/bin/env node
/**
 * Migrate WortheyFlow to Supabase
 * This script:
 * 1. Creates the wortheyflow_leads table (via SQL output - must be run manually in Supabase SQL Editor)
 * 2. Imports existing leads from leads-data.js
 */

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ylxreuqvofgbpsatfsvr.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlseHJldXF2b2ZnYnBzYXRmc3ZyIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTg1NzE4MCwiZXhwIjoyMDg3NDMzMTgwfQ.DxTv7ZC0oNRHBBS0Jxquh1M0wsGV8fQ005Q9S2iILdE';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    db: { schema: 'public' },
    auth: { persistSession: false }
});

// Load GHL_LEADS from leads-data.js
const fs = require('fs');
const path = require('path');
const leadsFilePath = path.join(__dirname, '..', 'leads-data.js');
const leadsFileContent = fs.readFileSync(leadsFilePath, 'utf-8');
// Extract GHL_LEADS array using eval (safe for this specific file)
const GHL_LEADS = eval(leadsFileContent.match(/const GHL_LEADS = (\[.+\]);/)[1]);

console.log('🚀 WortheyFlow → Supabase Migration\n');

// Map camelCase JS fields to snake_case DB columns
function leadToDbRow(lead) {
    return {
        id: lead.id || `lead-${Date.now()}`,
        name: lead.name || '',
        phone: lead.phone || null,
        email: lead.email || null,
        email_hers: lead.emailHers || null,
        company: lead.company || null,
        address: lead.address || null,
        city: lead.city || null,
        state: lead.state || 'TX',
        zip: lead.zip || null,
        lat: lead.lat || null,
        lng: lead.lng || null,
        job_type: lead.jobType || 'New Pool',
        source: lead.source || null,
        stage: lead.stage || 'New',
        salesperson: lead.salesperson || null,
        quote_amount: lead.quoteAmount || 0,
        notes: lead.notes || null,
        next_action: lead.nextAction || null,
        next_action_date: lead.nextActionDate || null,
        loss_reason: lead.lossReason || null,
        equipment_age: lead.equipmentAge || null,
        ghl_id: lead.ghlId || null,
        ghl_tags: lead.ghlTags || null,
        ghl_contact_id: lead.ghlContactId || null,
        ghl_raw: lead.ghlRaw || null,
        activities: lead.activities || [],
        first_contact_at: lead.firstContactAt || 0,
        created_at: lead.createdAt || Date.now(),
        stage_changed_at: lead.stageChangedAt || Date.now(),
        updated_at: new Date().toISOString()
    };
}

async function testConnection() {
    console.log('📡 Testing Supabase connection...');
    const { data, error } = await supabase.from('wortheyflow_leads').select('count', { count: 'exact', head: true });

    if (error && error.code === '42P01') {
        console.log('⚠️  Table does not exist yet. Please create it first.');
        console.log('\n📝 Run this SQL in Supabase SQL Editor:');
        console.log('   https://supabase.com/dashboard/project/ylxreuqvofgbpsatfsvr/sql/new\n');
        console.log(getCreateTableSQL());
        console.log('\n✅ After running the SQL, run this script again.\n');
        process.exit(1);
    } else if (error) {
        console.error('❌ Connection error:', error.message);
        process.exit(1);
    }

    console.log('✅ Connected to Supabase\n');
}

function getCreateTableSQL() {
    return `CREATE TABLE IF NOT EXISTS wortheyflow_leads (
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
);`;
}

async function importLeads() {
    console.log(`📥 Importing ${GHL_LEADS.length} leads from leads-data.js...`);

    // Convert leads to database format
    const dbRows = GHL_LEADS.map(leadToDbRow);

    // Upsert leads in batches of 100 (Supabase limit)
    const BATCH_SIZE = 100;
    let imported = 0;
    let errors = 0;

    for (let i = 0; i < dbRows.length; i += BATCH_SIZE) {
        const batch = dbRows.slice(i, i + BATCH_SIZE);
        process.stdout.write(`   Batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(dbRows.length / BATCH_SIZE)}: `);

        const { data, error } = await supabase
            .from('wortheyflow_leads')
            .upsert(batch, { onConflict: 'id' });

        if (error) {
            console.log(`❌ Failed - ${error.message}`);
            errors += batch.length;
        } else {
            imported += batch.length;
            console.log(`✅ Imported ${batch.length} leads`);
        }
    }

    console.log(`\n✅ Import complete: ${imported} leads imported, ${errors} errors`);
}

async function verifyImport() {
    console.log('\n🔍 Verifying import...');

    const { data, error, count } = await supabase
        .from('wortheyflow_leads')
        .select('*', { count: 'exact', head: true });

    if (error) {
        console.error('❌ Failed to verify import:', error.message);
        return;
    }

    console.log(`✅ Database contains ${count} leads total`);

    // Show a few sample leads
    const { data: samples } = await supabase
        .from('wortheyflow_leads')
        .select('id, name, phone, stage, salesperson')
        .limit(5);

    if (samples && samples.length > 0) {
        console.log('\n📋 Sample leads:');
        samples.forEach(l => {
            console.log(`   ${l.id}: ${l.name} (${l.stage}) → ${l.salesperson || 'Unassigned'}`);
        });
    }
}

async function main() {
    try {
        await testConnection();
        await importLeads();
        await verifyImport();

        console.log('\n✨ Migration complete!');
        console.log('\n📝 Next steps:');
        console.log('   1. Update server.js to use Supabase instead of leads.json');
        console.log('   2. Update app.js to fetch leads from API');
        console.log('   3. Set Railway env vars (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)');
        console.log('   4. Deploy to Railway\n');
    } catch (error) {
        console.error('\n❌ Migration failed:', error.message);
        console.error(error.stack);
        process.exit(1);
    }
}

main();
