#!/usr/bin/env node
/**
 * Setup Supabase database for WortheyFlow
 * Creates the wortheyflow_leads table and imports existing leads
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ylxreuqvofgbpsatfsvr.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlseHJldXF2b2ZnYnBzYXRmc3ZyIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTg1NzE4MCwiZXhwIjoyMDg3NDMzMTgwfQ.DxTv7ZC0oNRHBBS0Jxquh1M0wsGV8fQ005Q9S2iILdE';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    db: { schema: 'public' },
    auth: { persistSession: false }
});

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

async function createTable() {
    console.log('📝 Step 1: Create wortheyflow_leads table');
    console.log('\nPlease run the following SQL in Supabase SQL Editor:');
    console.log('https://supabase.com/dashboard/project/ylxreuqvofgbpsatfsvr/sql/new\n');

    const sql = `
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
);`;

    console.log(sql);
    console.log('\n✅ Copy and paste the above SQL into Supabase SQL Editor');
    console.log('   Press any key when done...');

    // Wait for user confirmation
    await new Promise(resolve => {
        process.stdin.setRawMode(true);
        process.stdin.resume();
        process.stdin.on('data', () => {
            process.stdin.setRawMode(false);
            resolve();
        });
    });
}

async function importLeads() {
    console.log('\n📥 Step 2: Import existing leads from leads-data.js');

    // Load leads from leads-data.js
    const leadsDataPath = path.join(__dirname, '..', 'leads-data.js');
    if (!fs.existsSync(leadsDataPath)) {
        console.error('❌ leads-data.js not found at:', leadsDataPath);
        process.exit(1);
    }

    // Execute leads-data.js to get GHL_LEADS array
    const leadsDataContent = fs.readFileSync(leadsDataPath, 'utf-8');
    // Extract the GHL_LEADS array using regex (safe for this specific file)
    const match = leadsDataContent.match(/const GHL_LEADS = (\[[\s\S]*?\]);/);
    if (!match) {
        console.error('❌ Could not find GHL_LEADS array in leads-data.js');
        process.exit(1);
    }

    const leads = eval(match[1]); // Execute the array literal
    console.log(`Found ${leads.length} leads to import`);

    // Convert leads to database format
    const dbRows = leads.map(leadToDbRow);

    // Upsert leads in batches of 100 (Supabase limit)
    const BATCH_SIZE = 100;
    let imported = 0;
    let errors = 0;

    for (let i = 0; i < dbRows.length; i += BATCH_SIZE) {
        const batch = dbRows.slice(i, i + BATCH_SIZE);
        console.log(`Importing batch ${Math.floor(i / BATCH_SIZE) + 1} (${batch.length} leads)...`);

        const { data, error } = await supabase
            .from('wortheyflow_leads')
            .upsert(batch, { onConflict: 'id' });

        if (error) {
            console.error(`❌ Batch ${Math.floor(i / BATCH_SIZE) + 1} failed:`, error.message);
            errors += batch.length;
        } else {
            imported += batch.length;
            console.log(`✅ Batch ${Math.floor(i / BATCH_SIZE) + 1} imported`);
        }
    }

    console.log(`\n✅ Import complete: ${imported} leads imported, ${errors} errors`);
}

async function verifyImport() {
    console.log('\n🔍 Step 3: Verify import');

    const { data, error, count } = await supabase
        .from('wortheyflow_leads')
        .select('*', { count: 'exact', head: true });

    if (error) {
        console.error('❌ Failed to verify import:', error.message);
        return;
    }

    console.log(`✅ Database contains ${count} leads`);
}

async function main() {
    console.log('🚀 WortheyFlow Supabase Setup\n');

    try {
        await createTable();
        await importLeads();
        await verifyImport();

        console.log('\n✨ Setup complete! You can now update server.js to use Supabase.');
    } catch (error) {
        console.error('\n❌ Setup failed:', error.message);
        process.exit(1);
    }

    process.exit(0);
}

main();
