require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'fallback-secret-change-me';
const AUTOMATIONS_FILE = path.join(__dirname, 'automations.json');
const LOG_FILE = path.join(__dirname, 'notification-log.json');
const USERS_FILE = path.join(__dirname, 'users.json');

// ========== SUPABASE CLIENT ==========
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ylxreuqvofgbpsatfsvr.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlseHJldXF2b2ZnYnBzYXRmc3ZyIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTg1NzE4MCwiZXhwIjoyMDg3NDMzMTgwfQ.DxTv7ZC0oNRHBBS0Jxquh1M0wsGV8fQ005Q9S2iILdE';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    db: { schema: 'public' },
    auth: { persistSession: false }
});

// ========== DATABASE HELPERS ==========

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
        ghl_id: lead.ghlId || lead.ghlContactId || null,
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

// Map snake_case DB columns to camelCase JS fields
function dbRowToLead(row) {
    return {
        id: row.id,
        name: row.name || '',
        phone: row.phone || '',
        email: row.email || '',
        emailHers: row.email_hers || '',
        company: row.company || '',
        address: row.address || '',
        city: row.city || '',
        state: row.state || 'TX',
        zip: row.zip || '',
        lat: row.lat || null,
        lng: row.lng || null,
        jobType: row.job_type || 'New Pool',
        source: row.source || '',
        stage: row.stage || 'New',
        salesperson: row.salesperson || '',
        quoteAmount: Number(row.quote_amount) || 0,
        notes: row.notes || '',
        nextAction: row.next_action || '',
        nextActionDate: row.next_action_date || '',
        lossReason: row.loss_reason || null,
        equipmentAge: row.equipment_age || null,
        ghlId: row.ghl_id || null,
        ghlTags: row.ghl_tags || null,
        ghlContactId: row.ghl_contact_id || null,
        ghlRaw: row.ghl_raw || null,
        activities: row.activities || [],
        firstContactAt: row.first_contact_at || 0,
        createdAt: row.created_at || Date.now(),
        stageChangedAt: row.stage_changed_at || Date.now()
    };
}

// ========== HELPERS ==========

function loadAutomations() {
    try {
        return JSON.parse(fs.readFileSync(AUTOMATIONS_FILE, 'utf-8'));
    } catch (e) {
        return [];
    }
}

function saveAutomations(rules) {
    fs.writeFileSync(AUTOMATIONS_FILE, JSON.stringify(rules, null, 2));
}

function loadLog() {
    try {
        return JSON.parse(fs.readFileSync(LOG_FILE, 'utf-8'));
    } catch (e) {
        return [];
    }
}

function appendLog(entry) {
    const log = loadLog();
    log.push({ ...entry, timestamp: new Date().toISOString() });
    // Keep last 500 entries
    if (log.length > 500) log.splice(0, log.length - 500);
    fs.writeFileSync(LOG_FILE, JSON.stringify(log, null, 2));
}

// Template variable replacement
function renderTemplate(template, lead, contactDir) {
    if (!template) return '';
    return template.replace(/\{\{lead\.(\w+)\}\}/g, (match, key) => {
        if (key === 'salesperson_phone') {
            const entry = findContact(contactDir, lead.salesperson);
            return entry ? entry.phone : '(no phone on file)';
        }
        if (key === 'salesperson_email') {
            const entry = findContact(contactDir, lead.salesperson);
            return entry ? entry.email : '(no email on file)';
        }
        if (key === 'salesperson_title') {
            const entry = findContact(contactDir, lead.salesperson);
            return entry ? entry.title : 'Consultant';
        }
        if (key === 'salesperson_fullName') {
            const entry = findContact(contactDir, lead.salesperson);
            return entry ? entry.fullName : lead.salesperson || '';
        }
        if (key === 'salesperson_phone_display') {
            const entry = findContact(contactDir, lead.salesperson);
            if (!entry) return '(no phone on file)';
            // Format +12105636099 → (210) 563-6099
            const digits = entry.phone.replace(/\D/g, '').slice(-10);
            return '(' + digits.slice(0,3) + ') ' + digits.slice(3,6) + '-' + digits.slice(6);
        }
        if (key === 'quoteAmount') {
            const v = lead.quoteAmount || 0;
            return '$' + v.toLocaleString('en-US');
        }
        if (key === 'createdAgo') {
            if (!lead.createdAt) return 'unknown';
            const mins = Math.floor((Date.now() - lead.createdAt) / 60000);
            if (mins < 60) return mins + ' min';
            if (mins < 1440) return Math.floor(mins / 60) + ' hr';
            return Math.floor(mins / 1440) + ' days';
        }
        return lead[key] !== undefined && lead[key] !== null ? String(lead[key]) : '';
    });
}

function resolveRecipient(toField, lead, contactDir) {
    if (toField === '{{lead.salesperson_phone}}') {
        const entry = findContact(contactDir, lead.salesperson);
        return entry ? entry.phone : null;
    }
    if (toField === '{{lead.salesperson_email}}') {
        const entry = findContact(contactDir, lead.salesperson);
        return entry ? entry.email : null;
    }
    return renderTemplate(toField, lead, contactDir);
}

// ========== NOTIFICATION SENDERS ==========

let twilioClient = null;
let sgMail = null;

function getTwilio() {
    if (!twilioClient && process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
        const twilio = require('twilio');
        twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    }
    return twilioClient;
}

function getSendGrid() {
    if (!sgMail && process.env.SENDGRID_API_KEY) {
        sgMail = require('@sendgrid/mail');
        sgMail.setApiKey(process.env.SENDGRID_API_KEY);
    }
    return sgMail;
}

async function sendSMS(to, message) {
    const client = getTwilio();
    if (!client) {
        console.log('[DRY RUN] SMS to', to, ':', message);
        return { success: true, dry: true, to, message };
    }
    try {
        const result = await client.messages.create({
            body: message,
            from: process.env.TWILIO_SMS_NUMBER || process.env.TWILIO_PHONE_NUMBER,
            to
        });
        console.log('[SMS SENT]', to, result.sid);
        return { success: true, sid: result.sid, to, message };
    } catch (err) {
        console.error('[SMS ERROR]', err.message);
        return { success: false, error: err.message, to, message };
    }
}

async function sendEmail(to, subject, body, options = {}) {
    const sg = getSendGrid();
    if (!sg) {
        console.log('[DRY RUN] Email to', to, ':', subject);
        return { success: true, dry: true, to, subject };
    }
    try {
        const msg = {
            to,
            from: process.env.SENDGRID_FROM_EMAIL || 'notifications@wortheyaquatics.com',
            subject,
            html: body,
            text: body.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
        };
        // Reply-To: route replies to the assigned salesperson
        if (options.replyTo) {
            msg.replyTo = options.replyTo;
        }
        // BCC: notifications + AquaBot for reply tracking
        msg.bcc = [
            { email: 'notifications@wortheyaquatics.com' },
            { email: 'aquabot1000@icloud.com' }
        ];
        await sg.send(msg);
        console.log('[EMAIL SENT]', to, subject, options.replyTo ? `(reply-to: ${options.replyTo})` : '');
        return { success: true, to, subject };
    } catch (err) {
        console.error('[EMAIL ERROR]', err.message);
        return { success: false, error: err.message, to, subject };
    }
}

// ========== AUTOMATION ENGINE ==========

function evaluateConditions(conditions, lead) {
    if (!conditions || conditions.length === 0) return true;
    return conditions.every(cond => {
        const val = lead[cond.field];
        const target = cond.value;
        switch (cond.operator) {
            case 'equals': return String(val) === String(target);
            case 'notEquals': return String(val) !== String(target);
            case 'greaterThan': return Number(val) > Number(target);
            case 'lessThan': return Number(val) < Number(target);
            case 'contains': return String(val || '').toLowerCase().includes(String(target).toLowerCase());
            case 'in': return String(target).split(',').map(s => s.trim().toLowerCase()).includes(String(val || '').toLowerCase());
            case 'notIn': return !String(target).split(',').map(s => s.trim().toLowerCase()).includes(String(val || '').toLowerCase());
            default: return true;
        }
    });
}

function matchesTrigger(rule, event) {
    const t = rule.trigger;
    if (!t) return false;

    if (t.type === 'lead_created' && event.type === 'lead_created') return true;
    if (t.type === 'manual_flag' && event.type === 'manual_flag') return true;

    if (t.type === 'stage_change' && event.type === 'stage_change') {
        if (t.stage && t.stage !== 'any' && t.stage !== event.newStage) return false;
        if (t.fromStage && t.fromStage !== event.oldStage) return false;
        return true;
    }

    if (t.type === 'stage_enter' && event.type === 'stage_change') {
        if (t.stage && t.stage !== 'any' && t.stage !== event.newStage) return false;
        return true;
    }

    // stage_duration is handled by the check-durations endpoint
    if (t.type === 'stage_duration' && event.type === 'stage_duration') {
        if (t.stage && t.stage !== 'any' && t.stage !== event.lead?.stage) return false;
        const mins = event.minutesInStage || 0;
        return mins >= (t.durationMinutes || 0);
    }

    return false;
}

async function executeActions(actions, lead, contactDir) {
    const results = [];
    for (const action of actions) {
        const to = resolveRecipient(action.to, lead, contactDir);
        if (!to) {
            results.push({ type: action.type, error: 'Could not resolve recipient', to: action.to });
            continue;
        }
        if (action.type === 'sms') {
            const msg = renderTemplate(action.message, lead, contactDir);
            const r = await sendSMS(to, msg);
            results.push({ type: 'sms', ...r });
            // Record delivery on lead's activity log
            if (!r.error) {
                recordDeliveryOnLead(lead.id, { type: 'sms', to, message: msg, status: 'sent', sid: r.sid });
            }
        } else if (action.type === 'email') {
            const subject = renderTemplate(action.subject, lead, contactDir);
            const body = renderTemplate(action.body || action.message, lead, contactDir);
            // Set Reply-To to the assigned salesperson's email
            const spEmail = lead.salesperson_email || (contactDir || []).find(c => c.name === lead.salesperson || c.name === lead.salesperson_fullName)?.email;
            const emailOpts = spEmail ? { replyTo: spEmail } : {};
            const r = await sendEmail(to, subject, body, emailOpts);
            results.push({ type: 'email', ...r });
            // Record delivery on lead's activity log
            if (!r.error) {
                recordDeliveryOnLead(lead.id, { type: 'email', to, subject, status: 'sent' });
            }
        }
    }
    return results;
}

// Record automated delivery to a lead's activity history in Supabase
async function recordDeliveryOnLead(leadId, delivery) {
    try {
        // Fetch lead from Supabase
        const { data: lead, error: fetchError } = await supabase
            .from('wortheyflow_leads')
            .select('activities')
            .eq('id', leadId)
            .single();

        if (fetchError || !lead) {
            console.error('Failed to fetch lead for delivery record:', fetchError?.message);
            return;
        }

        const activities = lead.activities || [];
        activities.push({
            type: delivery.type === 'sms' ? 'auto_sms' : 'auto_email',
            note: delivery.type === 'sms'
                ? `📤 Auto SMS to ${delivery.to}: "${delivery.message.substring(0, 80)}${delivery.message.length > 80 ? '...' : ''}"`
                : `📤 Auto Email to ${delivery.to}: "${delivery.subject}"`,
            timestamp: Date.now(),
            automated: true,
            deliveryDetails: delivery
        });

        // Update lead in Supabase
        const { error: updateError } = await supabase
            .from('wortheyflow_leads')
            .update({ activities, updated_at: new Date().toISOString() })
            .eq('id', leadId);

        if (updateError) {
            console.error('Failed to record delivery on lead:', updateError.message);
        }
    } catch(e) {
        console.error('Failed to record delivery on lead:', e.message);
    }
}

// ========== AUTH ==========

function loadUsers() {
    try { return JSON.parse(fs.readFileSync(USERS_FILE, 'utf-8')); } catch (e) { return []; }
}
function saveUsers(users) { fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2)); }

function authMiddleware(req, res, next) {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) return res.status(401).json({ error: 'No token provided' });
    try {
        const decoded = jwt.verify(header.slice(7), JWT_SECRET);
        req.user = decoded;
        next();
    } catch (e) { return res.status(401).json({ error: 'Invalid token' }); }
}

function adminOnly(req, res, next) {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
    next();
}

// Login — no auth required
app.post('/api/auth/login', (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    const users = loadUsers();
    const user = users.find(u => u.email.toLowerCase() === email.toLowerCase());
    if (!user || !bcrypt.compareSync(password, user.password)) return res.status(401).json({ error: 'Invalid credentials' });
    const token = jwt.sign({ userId: user.id, name: user.name, role: user.role, salesperson: user.salesperson }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role, salesperson: user.salesperson, mustChangePassword: user.mustChangePassword } });
});

// Health check (no auth required)
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Marketing Dashboard — PUBLIC read-only endpoint (no auth)
app.get('/api/marketing/data', (req, res) => {
    try {
        const stateFile = path.join(__dirname, '..', 'marketing', 'dashboard-state.json');
        if (fs.existsSync(stateFile)) {
            const data = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
            return res.json(data);
        }
        res.json({ kpis: {}, companies: {}, channels: [], dailyTrends: {}, recentLeads: [], alerts: [] });
    } catch (err) {
        res.status(500).json({ error: 'Failed to load dashboard data' });
    }
});

// ========== GHL WEBHOOK (no auth — secured by secret) ==========
const GHL_WEBHOOK_SECRET = process.env.GHL_WEBHOOK_SECRET || 'worthey-ghl-2026';

app.post('/api/webhook/ghl', async (req, res) => {
    // Verify secret (passed as query param or header)
    const secret = req.query.secret || req.headers['x-webhook-secret'];
    if (secret !== GHL_WEBHOOK_SECRET) {
        console.log('[GHL WEBHOOK] Rejected — invalid secret');
        return res.status(403).json({ error: 'Invalid secret' });
    }

    const data = req.body;
    console.log('[GHL WEBHOOK] Received:', JSON.stringify(data).slice(0, 500));

    // Map GHL fields to WortheyFlow lead format
    const lead = {
        id: 'ghl-' + (data.contact_id || data.id || Date.now()),
        name: [data.first_name, data.last_name].filter(Boolean).join(' ') || data.full_name || data.name || 'GHL Lead',
        phone: data.phone || data.Phone || '',
        email: data.email || data.Email || '',
        emailHers: '',
        source: 'GoHighLevel - ' + (data.tags || data.source || 'Quiz Funnel'),
        stage: 'New',
        salesperson: '', // Will be auto-assigned by CRM
        jobType: detectJobType(data),
        quoteAmount: 0,
        notes: buildGHLNotes(data),
        address: data.address1 || data.address || '',
        city: data.city || '',
        state: data.state || 'TX',
        zip: data.postal_code || data.zip || '',
        createdAt: Date.now(),
        stageChangedAt: Date.now(),
        ghlContactId: data.contact_id || data.id || '',
        ghlRaw: data // Store full payload for reference
    };

    // Auto-assign salesperson based on job type (use short names to match CRM frontend)
    if (['Pool Construction', 'Pool Remodel', 'Commercial'].includes(lead.jobType)) {
        // Rotate between Ricardo and Anibal
        const assignFile = path.join(__dirname, 'assign-counter.json');
        let counter = 0;
        try { counter = JSON.parse(fs.readFileSync(assignFile, 'utf-8')).counter || 0; } catch(e) {}
        lead.salesperson = counter % 2 === 0 ? 'Ricardo' : 'Anibal';
        fs.writeFileSync(assignFile, JSON.stringify({ counter: counter + 1 }));
    } else {
        lead.salesperson = 'Richard';
    }

    // Save lead to Supabase
    // Check for duplicate by phone
    if (lead.phone) {
        const normalizedPhone = lead.phone.replace(/\D/g, '');
        const { data: existingLeads } = await supabase
            .from('wortheyflow_leads')
            .select('*')
            .ilike('phone', `%${normalizedPhone}%`);

        if (existingLeads && existingLeads.length > 0) {
            const existing = existingLeads[0];
            console.log('[GHL WEBHOOK] Duplicate phone detected:', lead.phone, '— updating existing lead');

            const updatedNotes = (existing.notes || '') + '\n\n--- GHL Update ' + new Date().toLocaleString() + ' ---\n' + lead.notes;
            const { error } = await supabase
                .from('wortheyflow_leads')
                .update({
                    notes: updatedNotes,
                    email: lead.email && !existing.email ? lead.email : existing.email,
                    ghl_contact_id: lead.ghlContactId,
                    updated_at: new Date().toISOString()
                })
                .eq('id', existing.id);

            if (error) {
                console.error('[GHL WEBHOOK] Failed to update existing lead:', error.message);
                return res.status(500).json({ error: 'Failed to update lead' });
            }

            return res.json({ success: true, action: 'updated', leadId: existing.id });
        }
    }

    // Insert new lead to Supabase
    const dbRow = leadToDbRow(lead);
    const { error: insertError } = await supabase
        .from('wortheyflow_leads')
        .insert([dbRow]);

    if (insertError) {
        console.error('[GHL WEBHOOK] Failed to insert lead:', insertError.message);
        return res.status(500).json({ error: 'Failed to create lead' });
    }

    // Fire lead_created automation triggers
    const rules = loadAutomations();
    const contactDir = loadContactDirectory();
    const event = { type: 'lead_created' };
    for (const rule of rules) {
        if (!rule.enabled) continue;
        if (!matchesTrigger(rule, event)) continue;
        if (!evaluateConditions(rule.conditions, lead)) continue;
        const actionResults = await executeActions(rule.actions, lead, contactDir);
        appendLog({ action: 'ghl_webhook_trigger', ruleName: rule.name, ruleId: rule.id, leadId: lead.id, leadName: lead.name, actionResults });
    }

    // 🆕 INSTANT SMS ALERT: Notify assigned salesperson immediately
    sendNewLeadSMS(lead, contactDir);

    // 🆕 SET 10-MINUTE UNTOUCHED ALERT: Check if lead goes untouched
    scheduleUntouchedAlert(lead);

    console.log('[GHL WEBHOOK] Lead created:', lead.id, lead.name, '→', lead.salesperson);
    res.json({ success: true, action: 'created', leadId: lead.id, salesperson: lead.salesperson });
});

function detectJobType(data) {
    const tags = (data.tags || '').toLowerCase();
    const source = (data.source || '').toLowerCase();
    const notes = (data.notes || '').toLowerCase();
    const all = tags + ' ' + source + ' ' + notes;
    if (all.includes('build') || all.includes('new pool') || all.includes('construction') || all.includes('new-build')) return 'Pool Construction';
    if (all.includes('service') || all.includes('maintenance') || all.includes('clean')) return 'Pool Service';
    if (all.includes('remodel') || all.includes('renovation') || all.includes('resurface')) return 'Pool Remodel';
    if (all.includes('repair') || all.includes('equipment') || all.includes('pump') || all.includes('heater')) return 'Equipment Repair';
    return 'Pool Construction'; // Default for quiz funnel leads
}

function buildGHLNotes(data) {
    const parts = ['Source: GoHighLevel Quiz Funnel'];
    if (data.tags) parts.push('Tags: ' + data.tags);
    if (data.source) parts.push('Source: ' + data.source);
    // Capture any custom fields / quiz answers
    const skip = ['first_name','last_name','full_name','name','phone','Phone','email','Email','contact_id','id','address1','address','city','state','postal_code','zip','tags','source','country'];
    for (const [key, val] of Object.entries(data)) {
        if (!skip.includes(key) && val && typeof val !== 'object') {
            parts.push(key.replace(/_/g,' ') + ': ' + val);
        }
    }
    return parts.join('\n');
}

function loadContactDirectory() {
    try {
        const settingsFile = path.join(__dirname, 'contact-directory.json');
        return JSON.parse(fs.readFileSync(settingsFile, 'utf-8'));
    } catch(e) {
        return [
            { name: 'Anibal', fullName: 'Anibal Lopez', phone: '+12105636099', email: 'anibal@wortheyaquatics.com', role: 'Pool Construction' },
            { name: 'Ricardo', fullName: 'Ricardo Jaurez', phone: '+15124504426', email: 'Ricardo@wortheyaquatics.com', role: 'Pool Construction' },
            { name: 'Richard', fullName: 'Richard Castille', phone: '+12102501416', email: 'Richardc@wortheyaquatics.com', role: 'Service/Equipment' },
            { name: 'Tyler', fullName: 'Tyler Worthey', phone: '+12105598725', email: 'tyler@wortheyaquatics.com', role: 'Owner' }
        ];
    }
}

// Find contact by name (matches short name, full name, or fullName field)
function findContact(contactDir, name) {
    if (!name || !contactDir) return null;
    const lower = name.toLowerCase().trim();
    return contactDir.find(c =>
        (c.name && c.name.toLowerCase() === lower) ||
        (c.fullName && c.fullName.toLowerCase() === lower) ||
        (c.name && lower.startsWith(c.name.toLowerCase())) ||
        (c.fullName && lower.startsWith(c.fullName.toLowerCase()))
    );
}

// ========== MISSION CONTROL V2 API (public — MC pages handle their own auth) ==========

// In-memory stores for MC data
const mcAgents = [];
const mcRevenueEvents = [];

// Seed data
const mcSeedOverview = {
    totalMRR: 26910,
    businesses: {
        wortheyAquatics: {
            name: 'Worthey Aquatics', color: '#00b4d8',
            pipeline: 847000, activeDeals: 12, closeRate: 34, serviceMRR: 18400,
            serviceAccounts: 147, routes: 5, revenuePerRoute: 3680,
            salespeople: [
                { name: 'Anibal Lopez', leads: 18, proposals: 9, signed: 4, closeRate: 44, revenue: 312000 },
                { name: 'Ricardo Jaurez', leads: 15, proposals: 7, signed: 3, closeRate: 43, revenue: 267000 },
                { name: 'Richard Castille', leads: 12, proposals: 5, signed: 2, closeRate: 40, revenue: 198000 },
            ],
            leadSources: { 'Google/SEO': 32, 'Referrals': 28, 'Home Shows': 18, 'Google Ads': 14, 'Social Media': 8 },
        },
        overAssessed: {
            name: 'OverAssessed.ai', color: '#6c5ce7',
            clients: 23, appealsFiled: 18, successRate: 72, mrr: 4200,
            googleAds: { accountId: '351-343-8695', spend: 1850, clicks: 342, conversions: 28, costPerConv: 66.07, convRate: 8.2 },
            deadlines: [
                { county: 'Bexar County', type: 'Protest', date: '2026-05-15' },
                { county: 'Comal County', type: 'Protest', date: '2026-05-31' },
            ],
        },
        profitBlueprint: {
            name: 'ProfitBlueprintCo', color: '#ff6b6b',
            productsBuilt: 17, bundles: 4, premiumInProgress: 6, listed: 11, mrr: 620,
            platforms: {
                etsy: { status: 'frozen', products: 8, revenue: 0 },
                gumroad: { status: 'live', products: 11, revenue: 380 },
                payhip: { status: 'live', products: 11, revenue: 240 },
                creativeMarket: { status: 'pending', products: 0, revenue: 0 },
            },
        },
        milePilot: {
            name: 'MilePilot', color: '#00b894',
            downloads: 284, activeUsers: 67, mrr: 890,
            subs: { free: 198, pro: 62, business: 5 },
            features: { 'Auto-tracking': 'done', 'IRS Reports': 'done', 'Multi-vehicle': 'in-progress', 'Fleet Dashboard': 'planned' },
        },
        aiAnalyst: {
            name: 'AI Analyst Service', color: '#ffd93d',
            activeClients: 4, mrr: 2800, satisfaction: 96,
            reportsThisMonth: 12, onTimeDelivery: 100, avgTurnaround: 2.3,
        },
    },
};

app.get('/api/mc/overview', (req, res) => res.json(mcSeedOverview));

app.get('/api/mc/agents', (req, res) => {
    const seedAgents = [
        { id: 'aquabot', name: 'AquaBot', task: 'CRM lead monitoring & follow-up', business: 'Worthey Aquatics', status: 'running', runtime: '24/7', model: 'Claude Opus 4', startedAt: new Date().toISOString() },
        { id: 'contentbot', name: 'ContentBot', task: 'Blog post generation', business: 'ProfitBlueprintCo', status: 'running', runtime: '2h 14m', model: 'Claude Sonnet 4', startedAt: new Date(Date.now() - 8040000).toISOString() },
        { id: 'adoptimizer', name: 'AdOptimizer', task: 'Google Ads bid adjustment', business: 'OverAssessed.ai', status: 'completed', runtime: '45m', model: 'GPT-4o', startedAt: new Date(Date.now() - 2700000).toISOString() },
    ];
    res.json({ agents: [...seedAgents, ...mcAgents] });
});

app.post('/api/mc/agents', (req, res) => {
    const { name, task, business, status, model } = req.body;
    if (!name || !task) return res.status(400).json({ error: 'name and task required' });
    const agent = { id: uuidv4(), name, task, business: business || 'General', status: status || 'running', model: model || 'unknown', startedAt: new Date().toISOString() };
    mcAgents.push(agent);
    if (mcAgents.length > 100) mcAgents.splice(0, mcAgents.length - 100);
    res.json(agent);
});

app.get('/api/mc/revenue', (req, res) => {
    const monthly = [
        { month: 'Sep 2025', wa: 14200, oa: 2100, mp: 0, pb: 0, ai: 0 },
        { month: 'Oct 2025', wa: 15800, oa: 2400, mp: 0, pb: 0, ai: 0 },
        { month: 'Nov 2025', wa: 16100, oa: 2800, mp: 120, pb: 80, ai: 0 },
        { month: 'Dec 2025', wa: 17200, oa: 3200, mp: 280, pb: 180, ai: 700 },
        { month: 'Jan 2026', wa: 17800, oa: 3600, mp: 450, pb: 320, ai: 1400 },
        { month: 'Feb 2026', wa: 18400, oa: 3900, mp: 680, pb: 480, ai: 2100 },
        { month: 'Mar 2026', wa: 19200, oa: 4200, mp: 890, pb: 620, ai: 2800 },
    ];
    res.json({ totalMRR: 26910, monthly, events: mcRevenueEvents });
});

app.post('/api/mc/revenue', (req, res) => {
    const { business, amount, type, description } = req.body;
    if (!business || amount === undefined) return res.status(400).json({ error: 'business and amount required' });
    const event = { id: uuidv4(), business, amount, type: type || 'revenue', description: description || '', timestamp: new Date().toISOString() };
    mcRevenueEvents.push(event);
    if (mcRevenueEvents.length > 500) mcRevenueEvents.splice(0, mcRevenueEvents.length - 500);
    res.json(event);
});

// ========== AQUABOT API (secret-key auth, read/write access) ==========
const AQUABOT_API_KEY = process.env.AQUABOT_API_KEY || 'wb-aquabot-2026-secret';

function aquabotAuth(req, res, next) {
    const key = req.headers['x-api-key'] || req.query.apiKey;
    if (key !== AQUABOT_API_KEY) return res.status(401).json({ error: 'Invalid API key' });
    req.user = { userId: 'aquabot', name: 'AquaBot', role: 'admin' };
    next();
}

// AquaBot: Get all leads (with phone, salesperson, stage)
app.get('/api/bot/leads', aquabotAuth, async (req, res) => {
    try {
        const { data } = await supabase.from('wortheyflow_leads').select('*');
        const leads = (data || []).map(dbRowToLead);
        res.json(leads);
    } catch (e) { res.json([]); }
});

// AquaBot: Get single lead by email
app.get('/api/bot/leads/by-email/:email', aquabotAuth, async (req, res) => {
    try {
        const { data } = await supabase
            .from('wortheyflow_leads')
            .select('*')
            .ilike('email', req.params.email)
            .limit(1);

        if (!data || data.length === 0) return res.status(404).json({ error: 'Lead not found' });
        res.json(dbRowToLead(data[0]));
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// AquaBot: Search leads by name fragment
app.get('/api/bot/leads/search', aquabotAuth, async (req, res) => {
    try {
        const q = (req.query.q || '').toLowerCase();
        if (!q) return res.status(400).json({ error: 'q parameter required' });

        const { data } = await supabase
            .from('wortheyflow_leads')
            .select('*')
            .or(`name.ilike.%${q}%,email.ilike.%${q}%,phone.ilike.%${q}%`);

        const results = (data || []).map(dbRowToLead);
        res.json(results);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// AquaBot: Pipeline summary (counts by stage + salesperson)
app.get('/api/bot/pipeline', aquabotAuth, async (req, res) => {
    try {
        const { data } = await supabase.from('wortheyflow_leads').select('stage, salesperson');
        const leads = (data || []).map(dbRowToLead);
        const stages = {};
        const bySalesperson = {};
        for (const l of leads) {
            const s = l.stage || 'Unknown';
            const sp = l.salesperson || 'Unassigned';
            stages[s] = (stages[s] || 0) + 1;
            if (!bySalesperson[sp]) bySalesperson[sp] = {};
            bySalesperson[sp][s] = (bySalesperson[sp][s] || 0) + 1;
        }
        res.json({ total: leads.length, stages, bySalesperson });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// All other /api routes require auth
app.use('/api', authMiddleware);

// Change password
app.post('/api/auth/change-password', (req, res) => {
    const { currentPassword, newPassword } = req.body;
    if (!newPassword || newPassword.length < 4) return res.status(400).json({ error: 'New password must be at least 4 characters' });
    const users = loadUsers();
    const user = users.find(u => u.id === req.user.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (!bcrypt.compareSync(currentPassword, user.password)) return res.status(401).json({ error: 'Current password is incorrect' });
    user.password = bcrypt.hashSync(newPassword, 10);
    user.mustChangePassword = false;
    saveUsers(users);
    res.json({ success: true });
});

// User management (admin only)
app.get('/api/users', adminOnly, (req, res) => {
    const users = loadUsers().map(u => ({ id: u.id, name: u.name, email: u.email, role: u.role, salesperson: u.salesperson, mustChangePassword: u.mustChangePassword }));
    res.json(users);
});

app.post('/api/users', adminOnly, (req, res) => {
    const { name, email, role, salesperson, password } = req.body;
    if (!name || !email || !role || !password) return res.status(400).json({ error: 'Missing required fields' });
    const users = loadUsers();
    if (users.find(u => u.email.toLowerCase() === email.toLowerCase())) return res.status(409).json({ error: 'Email already exists' });
    const newUser = { id: 'u' + Date.now(), name, email, role, salesperson: salesperson || name.split(' ')[0], password: bcrypt.hashSync(password, 10), mustChangePassword: true };
    users.push(newUser);
    saveUsers(users);
    res.json({ success: true, user: { id: newUser.id, name: newUser.name, email: newUser.email, role: newUser.role, salesperson: newUser.salesperson } });
});

// ========== DEDUP CACHE ==========
const DEDUP_FILE = path.join(__dirname, 'dedup-cache.json');
const DEDUP_HOURS = 24;

function loadDedup() {
    try { return JSON.parse(fs.readFileSync(DEDUP_FILE, 'utf-8')); } catch (e) { return {}; }
}

function saveDedup(cache) {
    fs.writeFileSync(DEDUP_FILE, JSON.stringify(cache));
}

function isDuplicate(ruleId, leadId) {
    const cache = loadDedup();
    const key = `${ruleId}::${leadId}`;
    const lastSent = cache[key];
    if (!lastSent) return false;
    const hoursSince = (Date.now() - lastSent) / 3600000;
    return hoursSince < DEDUP_HOURS;
}

function markSent(ruleId, leadId) {
    const cache = loadDedup();
    const key = `${ruleId}::${leadId}`;
    cache[key] = Date.now();
    // Clean old entries
    const cutoff = Date.now() - (DEDUP_HOURS * 3600000);
    for (const k in cache) { if (cache[k] < cutoff) delete cache[k]; }
    saveDedup(cache);
}

// ========== ROUTES ==========

// List automations
app.get('/api/automations', (req, res) => {
    res.json(loadAutomations());
});

// Create/update automation
app.post('/api/automations', (req, res) => {
    const rules = loadAutomations();
    const rule = req.body;
    if (!rule.id) rule.id = 'auto-' + uuidv4().slice(0, 8);
    const idx = rules.findIndex(r => r.id === rule.id);
    if (idx >= 0) {
        rules[idx] = rule;
    } else {
        rules.push(rule);
    }
    saveAutomations(rules);
    res.json({ success: true, rule });
});

// Delete automation
app.delete('/api/automations/:id', (req, res) => {
    let rules = loadAutomations();
    const before = rules.length;
    rules = rules.filter(r => r.id !== req.params.id);
    saveAutomations(rules);
    res.json({ success: true, deleted: before !== rules.length });
});

// Send notification directly
app.post('/api/notify', async (req, res) => {
    const { type, to, message, subject, body } = req.body;
    let result;
    if (type === 'sms') {
        result = await sendSMS(to, message);
    } else if (type === 'email') {
        result = await sendEmail(to, subject, body);
    } else {
        return res.status(400).json({ error: 'Invalid type. Use "sms" or "email".' });
    }
    appendLog({ action: 'notify', type, to, result });
    res.json(result);
});

// Trigger automation evaluation
app.post('/api/automations/trigger', async (req, res) => {
    const { event, lead, contactDirectory } = req.body;
    if (!event || !lead) return res.status(400).json({ error: 'Missing event or lead data' });

    const rules = loadAutomations();
    const results = [];

    for (const rule of rules) {
        if (!rule.enabled) continue;
        if (!matchesTrigger(rule, event)) continue;
        if (!evaluateConditions(rule.conditions, lead)) continue;
        if (rule.trigger?.type === 'stage_duration' && isDuplicate(rule.id, lead.id)) continue;

        const actionResults = await executeActions(rule.actions, lead, contactDirectory);
        markSent(rule.id, lead.id);
        results.push({ rule: rule.name, ruleId: rule.id, actions: actionResults });
        appendLog({ action: 'trigger', ruleName: rule.name, ruleId: rule.id, leadId: lead.id, leadName: lead.name, event, actionResults });
    }

    res.json({ triggered: results.length, results });
});

// ========== SMART DRIP CHECK HELPERS ==========
const TERMINAL_STAGES = ['Signed', 'Lost', 'DNS', 'DQ Service', 'DQ Budget', 'Imported'];
const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;

function shouldSkipDrip(lead) {
    // 1. Terminal stage — skip permanently
    if (TERMINAL_STAGES.includes(lead.stage)) {
        return { skip: true, reason: `terminal stage (${lead.stage})` };
    }

    const now = Date.now();

    // 2. Recent activity in last 24 hours
    let latestActivity = 0;
    if (lead.lastContact) latestActivity = Math.max(latestActivity, lead.lastContact);
    if (Array.isArray(lead.activities)) {
        lead.activities.forEach(a => {
            const t = new Date(a.date).getTime();
            if (t > latestActivity) latestActivity = t;
        });
    }
    if (Array.isArray(lead.activityNotes)) {
        lead.activityNotes.forEach(n => {
            if (n.timestamp > latestActivity) latestActivity = n.timestamp;
        });
    }
    if (latestActivity && (now - latestActivity) < TWENTY_FOUR_HOURS) {
        return { skip: true, reason: `recent activity on ${new Date(latestActivity).toISOString()}` };
    }

    // 3. Stage changed in last 24 hours
    if (lead.stageChangedAt && (now - lead.stageChangedAt) < TWENTY_FOUR_HOURS) {
        return { skip: true, reason: `stage changed ${Math.round((now - lead.stageChangedAt) / 3600000)}h ago` };
    }

    return { skip: false };
}

// Check duration-based triggers
app.post('/api/automations/check-durations', async (req, res) => {
    const { leads: leadsData, contactDirectory } = req.body;
    if (!leadsData || !Array.isArray(leadsData)) return res.status(400).json({ error: 'Missing leads array' });

    // Validate leads against server's Supabase — reject stale/cached leads from browser
    const { data: serverLeadsDb } = await supabase
        .from('wortheyflow_leads')
        .select('id');
    const serverIds = new Set((serverLeadsDb || []).map(l => l.id));
    const validLeads = leadsData.filter(l => serverIds.has(l.id));
    if (validLeads.length < leadsData.length) {
        console.log(`[Duration Check] Filtered ${leadsData.length - validLeads.length} stale leads from browser cache`);
    }

    const rules = loadAutomations().filter(r => r.enabled && r.trigger?.type === 'stage_duration');
    const results = [];
    const skipped = [];

    for (const lead of validLeads) {
        // Smart drip check — skip if recent activity, stage change, or terminal
        const dripCheck = shouldSkipDrip(lead);
        if (dripCheck.skip) {
            console.log(`[DRIP SKIP] Skipped drip for ${lead.name || lead.id} — ${dripCheck.reason}`);
            skipped.push({ lead: lead.name, leadId: lead.id, reason: dripCheck.reason });
            continue;
        }

        const minsInStage = lead.stageChangedAt ? Math.floor((Date.now() - lead.stageChangedAt) / 60000) : 0;

        for (const rule of rules) {
            if (!matchesTrigger(rule, { type: 'stage_duration', lead, minutesInStage: minsInStage })) continue;
            if (!evaluateConditions(rule.conditions, lead)) continue;
            if (isDuplicate(rule.id, lead.id)) continue;

            const actionResults = await executeActions(rule.actions, lead, contactDirectory);
            markSent(rule.id, lead.id);
            results.push({ rule: rule.name, ruleId: rule.id, lead: lead.name, leadId: lead.id, minutesInStage: minsInStage, actions: actionResults });
            appendLog({ action: 'duration_check', ruleName: rule.name, ruleId: rule.id, leadId: lead.id, leadName: lead.name, minutesInStage: minsInStage, actionResults });
        }
    }

    res.json({ checked: leadsData.length, triggered: results.length, skipped: skipped.length, skippedDetails: skipped, results });
});

// Contact directory CRUD
app.get('/api/contacts', (req, res) => {
    res.json(loadContactDirectory());
});

app.put('/api/contacts', (req, res) => {
    const contacts = req.body;
    if (!Array.isArray(contacts)) return res.status(400).json({ error: 'Expected array of contacts' });
    const settingsFile = path.join(__dirname, 'contact-directory.json');
    fs.writeFileSync(settingsFile, JSON.stringify(contacts, null, 2));
    res.json({ success: true, contacts });
});

// Get notification log
app.get('/api/logs', (req, res) => {
    res.json(loadLog());
});

// Get activity timeline for a lead (SMS/Email history)
app.get('/api/activity/:leadId', authMiddleware, (req, res) => {
    try {
        const { leadId } = req.params;

        // Get lead's activities from leads.json
        const LEADS_FILE = path.join(__dirname, 'leads.json');
        let leads = [];
        try { leads = JSON.parse(fs.readFileSync(LEADS_FILE, 'utf-8')); } catch(e) {}

        const lead = leads.find(l => l.id === leadId);
        if (!lead) return res.status(404).json({ error: 'Lead not found' });

        // Extract activity from lead.activities array (automated messages)
        const activities = [];
        if (Array.isArray(lead.activities)) {
            lead.activities.forEach(act => {
                if (act.type === 'auto_sms' || act.type === 'auto_email') {
                    activities.push({
                        type: act.type === 'auto_sms' ? 'sms' : 'email',
                        direction: 'sent',
                        timestamp: act.timestamp,
                        preview: act.note || '',
                        automated: true
                    });
                }
            });
        }

        // Also check notification logs for this lead
        const logs = loadLog();
        logs.forEach(entry => {
            if (entry.leadId === leadId && entry.actionResults) {
                entry.actionResults.forEach(result => {
                    if (result.type === 'sms' || result.type === 'email') {
                        activities.push({
                            type: result.type,
                            direction: 'sent',
                            timestamp: new Date(entry.timestamp).getTime(),
                            preview: result.type === 'sms'
                                ? (result.message || '').substring(0, 100)
                                : (result.subject || ''),
                            to: result.to,
                            automated: true
                        });
                    }
                });
            }
        });

        // Sort by timestamp descending (newest first)
        activities.sort((a, b) => b.timestamp - a.timestamp);

        res.json({ leadId, activities });
    } catch (err) {
        console.error('[Activity API] Error:', err);
        res.status(500).json({ error: 'Failed to load activity' });
    }
});

// Get all leads (for webhook sync)
app.get('/api/leads', authMiddleware, async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('wortheyflow_leads')
            .select('*')
            .order('created_at', { ascending: false });

        if (error) {
            console.error('[GET /api/leads] Error:', error.message);
            return res.status(500).json({ error: 'Failed to load leads' });
        }

        // Convert snake_case DB rows to camelCase JS objects
        const leads = data.map(dbRowToLead);
        res.json(leads);
    } catch (err) {
        console.error('[GET /api/leads] Error:', err.message);
        res.status(500).json({ error: 'Failed to load leads' });
    }
});

// Export all leads as JSON (for backup)
app.get('/api/leads/export', authMiddleware, async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('wortheyflow_leads')
            .select('*')
            .order('created_at', { ascending: false });

        if (error) {
            console.error('[GET /api/leads/export] Error:', error.message);
            return res.status(500).json({ error: 'Failed to export leads' });
        }

        const leads = data.map(dbRowToLead);
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename="wortheyflow-leads-${new Date().toISOString().split('T')[0]}.json"`);
        res.json(leads);
    } catch (err) {
        console.error('[GET /api/leads/export] Error:', err.message);
        res.status(500).json({ error: 'Failed to export leads' });
    }
});

// ========== MARKETING DASHBOARD API (public — read-only) ==========
app.get('/api/marketing/dashboard', (req, res) => {
    try {
        const stateFile = path.join(__dirname, '..', 'marketing', 'dashboard-state.json');
        if (fs.existsSync(stateFile)) {
            const data = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
            return res.json(data);
        }
        res.json({ kpis: {}, companies: {}, channels: [], dailyTrends: {}, recentLeads: [], alerts: [] });
    } catch (err) {
        console.error('[Marketing Dashboard] Error:', err);
        res.status(500).json({ error: 'Failed to load dashboard data' });
    }
});

// ========== BOOTH LEAD INTAKE (public, no auth) ==========
app.post('/api/booth-lead', async (req, res) => {
    try {
        const { firstName, lastName, phone, email, jobType, city, notes, source } = req.body;

        if (!firstName || !lastName || !phone || !jobType) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        const lead = {
            id: 'booth-' + Date.now(),
            name: firstName + ' ' + lastName,
            phone: phone.replace(/\D/g, ''),
            email: email || '',
            emailHers: '',
            source: source || 'Trade Show',
            stage: 'New',
            salesperson: '',
            jobType: jobType,
            quoteAmount: 0,
            notes: (city ? 'City: ' + city + '\n' : '') + (notes || ''),
            address: '',
            city: city || '',
            state: 'TX',
            zip: '',
            createdAt: Date.now(),
            stageChangedAt: Date.now()
        };

        // Auto-assign salesperson
        if (['Pool Construction', 'Pool Remodel', 'Commercial'].includes(jobType)) {
            const assignFile = path.join(__dirname, 'assign-counter.json');
            let counter = 0;
            try { counter = JSON.parse(fs.readFileSync(assignFile, 'utf-8')).counter || 0; } catch(e) {}
            lead.salesperson = counter % 2 === 0 ? 'Ricardo' : 'Anibal';
            fs.writeFileSync(assignFile, JSON.stringify({ counter: counter + 1 }));
        } else {
            lead.salesperson = 'Richard';
        }

        // Save to Supabase
        // Duplicate check by phone
        const digits = lead.phone.replace(/\D/g, '');
        const { data: existingLeads } = await supabase
            .from('wortheyflow_leads')
            .select('*')
            .ilike('phone', `%${digits}%`);

        if (existingLeads && existingLeads.length > 0) {
            const existing = existingLeads[0];
            const updatedNotes = (existing.notes || '') + '\n\n--- Booth Update ' + new Date().toLocaleString() + ' ---\n' + lead.notes;
            const { error } = await supabase
                .from('wortheyflow_leads')
                .update({
                    notes: updatedNotes,
                    email: lead.email && !existing.email ? lead.email : existing.email,
                    updated_at: new Date().toISOString()
                })
                .eq('id', existing.id);

            if (error) {
                console.error('[BOOTH] Failed to update existing lead:', error.message);
                return res.status(500).json({ error: 'Failed to update lead' });
            }

            console.log('[BOOTH] Duplicate updated:', existing.id, existing.name);
            return res.json({ success: true, action: 'updated', leadId: existing.id });
        }

        // Insert new lead
        const dbRow = leadToDbRow(lead);
        const { error: insertError } = await supabase
            .from('wortheyflow_leads')
            .insert([dbRow]);

        if (insertError) {
            console.error('[BOOTH] Failed to insert lead:', insertError.message);
            return res.status(500).json({ error: 'Failed to create lead' });
        }

        // Fire automations
        const rules = loadAutomations();
        const contactDir = loadContactDirectory();
        const event = { type: 'lead_created' };
        for (const rule of rules) {
            if (!rule.enabled) continue;
            if (!matchesTrigger(rule, event)) continue;
            if (!evaluateConditions(rule.conditions, lead)) continue;
            const actionResults = await executeActions(rule.actions, lead, contactDir);
            appendLog({ action: 'booth_lead_trigger', ruleName: rule.name, ruleId: rule.id, leadId: lead.id, leadName: lead.name, actionResults });
        }

        // 🆕 INSTANT SMS ALERT: Notify assigned salesperson immediately
        sendNewLeadSMS(lead, contactDir);

        // 🆕 SET 10-MINUTE UNTOUCHED ALERT: Check if lead goes untouched
        scheduleUntouchedAlert(lead);

        console.log('[BOOTH] Lead created:', lead.id, lead.name, '→', lead.salesperson);
        res.json({ success: true, action: 'created', leadId: lead.id, salesperson: lead.salesperson });
    } catch (err) {
        console.error('[BOOTH] Error:', err);
        res.status(500).json({ error: 'Internal error' });
    }
});

// ========== NEW LEAD SMS ALERTS ==========

async function sendNewLeadSMS(lead, contactDir) {
    try {
        // Find salesperson phone number
        const salesperson = contactDir.find(c =>
            c.name === lead.salesperson ||
            c.fullName === lead.salesperson ||
            c.name.toLowerCase() === lead.salesperson.toLowerCase()
        );

        if (!salesperson || !salesperson.phone) {
            console.log('[New Lead SMS] No phone for salesperson:', lead.salesperson);
            return;
        }

        const message = `🚨 NEW LEAD ASSIGNED TO YOU!\n\n` +
            `Name: ${lead.name}\n` +
            `Phone: ${lead.phone || 'N/A'}\n` +
            `Job: ${lead.jobType}\n` +
            `Source: ${lead.source}\n` +
            `Value: $${lead.quoteAmount.toLocaleString()}\n\n` +
            `👉 Log in to WortheyFlow to contact them NOW!\n` +
            `https://wortheyflow-production.up.railway.app`;

        const result = await sendSMS(salesperson.phone, message);
        if (result.success) {
            console.log(`[New Lead SMS] ✅ Sent to ${lead.salesperson} at ${salesperson.phone}`);
        } else {
            console.error(`[New Lead SMS] ❌ Failed to send to ${lead.salesperson}:`, result.error);
        }
    } catch (err) {
        console.error('[New Lead SMS] Error:', err.message);
    }
}

async function scheduleUntouchedAlert(lead) {
    // Wait 10 minutes, then check if lead has been contacted
    setTimeout(async () => {
        try {
            const { data: currentLead, error } = await supabase
                .from('wortheyflow_leads')
                .select('*')
                .eq('id', lead.id)
                .single();

            if (error || !currentLead) {
                console.log('[Untouched Alert] Lead not found:', lead.id);
                return; // Lead was deleted
            }

            // Check if lead has been contacted (firstContactAt timestamp or activity)
            const hasActivity = currentLead.first_contact_at ||
                (currentLead.activities && currentLead.activities.length > 0) ||
                currentLead.stage !== 'New';

            if (hasActivity) {
                console.log('[Untouched Alert] Lead was contacted, skipping alert for:', lead.name);
                return;
            }

            // Send alert to Tyler
            const tylerPhone = '+12105598725';
            const message = `⚠️ UNTOUCHED LEAD ALERT!\n\n` +
                `Lead: ${lead.name}\n` +
                `Assigned to: ${lead.salesperson}\n` +
                `Phone: ${lead.phone || 'N/A'}\n` +
                `Job: ${lead.jobType}\n` +
                `Source: ${lead.source}\n\n` +
                `This lead has gone 10+ minutes without contact.\n` +
                `https://wortheyflow-production.up.railway.app`;

            const result = await sendSMS(tylerPhone, message);
            if (result.success) {
                console.log('[Untouched Alert] ✅ Sent to Tyler for lead:', lead.name);
            } else {
                console.error('[Untouched Alert] ❌ Failed to send:', result.error);
            }
        } catch (err) {
            console.error('[Untouched Alert] Error:', err.message);
        }
    }, 10 * 60 * 1000); // 10 minutes
}

// ========== START ==========

// Serve the CRM frontend (after API routes)

// Webhook leads only endpoint (for frontend sync - MUST be before catch-all)
app.get('/api/webhook-leads', authMiddleware, async (req, res) => {
    try {
        const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
        const { data, error } = await supabase
            .from('wortheyflow_leads')
            .select('*')
            .like('id', 'ghl-%')
            .gte('created_at', sevenDaysAgo);

        if (error) {
            console.error('[GET /api/webhook-leads] Error:', error.message);
            return res.json([]);
        }

        const webhookLeads = data.map(dbRowToLead);
        res.json(webhookLeads);
    } catch(err) {
        console.error('[GET /api/webhook-leads] Error:', err.message);
        res.json([]);
    }
});

// Update a lead (for stage changes, edits)
app.put('/api/leads/:id', authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const leadUpdate = req.body;

        // Convert to database format
        const dbUpdate = leadToDbRow(leadUpdate);
        delete dbUpdate.id; // Don't update the ID

        const { error } = await supabase
            .from('wortheyflow_leads')
            .update(dbUpdate)
            .eq('id', id);

        if (error) {
            console.error('[PUT /api/leads/:id] Error:', error.message);
            return res.status(500).json({ error: 'Failed to update lead' });
        }

        res.json({ success: true, leadId: id });
    } catch (err) {
        console.error('[PUT /api/leads/:id] Error:', err.message);
        res.status(500).json({ error: 'Failed to update lead' });
    }
});

// Delete a lead (soft delete - just mark as deleted)
app.delete('/api/leads/:id', authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;

        // For now, we'll do a hard delete
        // In future, could add a 'deleted_at' column for soft deletes
        const { error } = await supabase
            .from('wortheyflow_leads')
            .delete()
            .eq('id', id);

        if (error) {
            console.error('[DELETE /api/leads/:id] Error:', error.message);
            return res.status(500).json({ error: 'Failed to delete lead' });
        }

        res.json({ success: true, leadId: id });
    } catch (err) {
        console.error('[DELETE /api/leads/:id] Error:', err.message);
        res.status(500).json({ error: 'Failed to delete lead' });
    }
});

app.use(express.static(path.join(__dirname, '..')));

// Serve MC pages directly, fallback to index.html for SPA routes
const mcPages = ['mission-control.html', 'mc-agents.html', 'mc-revenue.html', 'mc-marketing.html', 'booth.html'];
app.get('*', (req, res) => {
    const requested = req.path.replace(/^\//, '');
    if (mcPages.includes(requested)) {
        return res.sendFile(path.join(__dirname, '..', requested));
    }
    res.sendFile(path.join(__dirname, '..', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`WortheyFlow Automation Server running on port ${PORT}`);
    console.log(`Twilio: ${process.env.TWILIO_ACCOUNT_SID ? 'configured' : 'DRY RUN mode'}`);
    console.log(`SendGrid: ${process.env.SENDGRID_API_KEY ? 'configured' : 'DRY RUN mode'}`);

    // ── Server-side duration check (runs every 5 minutes) ──
    // This ensures drip automations fire even when nobody has the CRM open
    setInterval(async () => {
        try {
            // Fetch all leads from Supabase
            const { data: leadsDb } = await supabase
                .from('wortheyflow_leads')
                .select('*');

            if (!leadsDb) return;

            // Convert to camelCase
            const leads = leadsDb.map(dbRowToLead);
            const contactDirectory = loadContactDirectory();
            const rules = loadAutomations().filter(r => r.enabled && r.trigger?.type === 'stage_duration');
            let triggered = 0;

            for (const lead of leads) {
                const dripCheck = shouldSkipDrip(lead);
                if (dripCheck.skip) continue;

                const minsInStage = lead.stageChangedAt ? Math.floor((Date.now() - lead.stageChangedAt) / 60000) : 0;

                for (const rule of rules) {
                    if (!matchesTrigger(rule, { type: 'stage_duration', lead, minutesInStage: minsInStage })) continue;
                    if (!evaluateConditions(rule.conditions, lead)) continue;
                    if (isDuplicate(rule.id, lead.id)) continue;

                    const actionResults = await executeActions(rule.actions, lead, contactDirectory);
                    markSent(rule.id, lead.id);
                    triggered++;
                    appendLog({ action: 'server_duration_check', ruleName: rule.name, ruleId: rule.id, leadId: lead.id, leadName: lead.name, minutesInStage: minsInStage, actionResults });
                    console.log(`[AUTO] ${rule.name} → ${lead.name} (${minsInStage} min in ${lead.stage})`);
                }
            }
            if (triggered > 0) console.log(`[AUTO] Duration check: ${triggered} automations fired`);
        } catch(err) {
            console.error('[AUTO] Duration check error:', err.message);
        }
    }, 300000); // every 5 minutes
    console.log('Server-side duration checks: ACTIVE (every 5 min)');
    console.log(`Supabase: ${SUPABASE_URL}`);
});

// ─── Inbound SMS Handler (Twilio Webhook) ──────────────────────────
// When a lead replies to a CRM text, forward to assigned salesperson + Tyler
app.post('/api/sms/inbound', async (req, res) => {
  try {
    const { From, Body, To } = req.body;
    console.log(`📨 Inbound SMS from ${From}: ${Body}`);
    
    // Find the lead by phone number from Supabase
    const normalizePhone = (p) => (p || '').replace(/\D/g, '').slice(-10);
    const fromNorm = normalizePhone(From);

    const { data: leadsDb } = await supabase
        .from('wortheyflow_leads')
        .select('*')
        .ilike('phone', `%${fromNorm}%`);

    const leadDb = leadsDb && leadsDb.length > 0 ? leadsDb[0] : null;
    const lead = leadDb ? dbRowToLead(leadDb) : null;

    const contactDir = loadContactDirectory();
    const tyler = contactDir.find(c => c.name === 'Tyler Worthey') || { phone: '+12105598725' };
    
    // Format the forward message
    const leadName = lead ? lead.name : 'Unknown';
    const salesperson = lead ? lead.salesperson : 'Unassigned';
    const fwdMsg = `💬 LEAD REPLY from ${leadName} (${From}):\n"${Body}"\n\nAssigned to: ${salesperson}`;
    
    // Find salesperson phone
    let salespersonPhone = null;
    if (lead && lead.salesperson) {
      const sp = contactDir.find(c => c.name.toLowerCase().includes(lead.salesperson.toLowerCase()));
      if (sp) salespersonPhone = sp.phone;
    }
    
    // Forward to Tyler always
    const twilio = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    const fromNum = process.env.TWILIO_PHONE || '+18302716166';
    
    await twilio.messages.create({
      body: fwdMsg,
      from: fromNum,
      to: tyler.phone || '+12105598725'
    });
    console.log(`  ✅ Forwarded to Tyler`);
    
    // Forward to assigned salesperson (if different from Tyler)
    if (salespersonPhone && salespersonPhone !== tyler.phone) {
      await twilio.messages.create({
        body: fwdMsg,
        from: fromNum,
        to: salespersonPhone
      });
      console.log(`  ✅ Forwarded to ${salesperson} at ${salespersonPhone}`);
    }
    
    // Log it
    appendLog({ 
      action: 'sms_inbound_forwarded', 
      from: From, 
      body: Body, 
      leadName, 
      salesperson, 
      forwardedTo: [tyler.phone, salespersonPhone].filter(Boolean)
    });
    
    // Respond with TwiML (empty response - don't auto-reply)
    res.type('text/xml');
    res.send('<Response></Response>');
  } catch (err) {
    console.error('❌ Inbound SMS error:', err.message);
    res.type('text/xml');
    res.send('<Response></Response>');
  }
});
// deploy 1774058894
