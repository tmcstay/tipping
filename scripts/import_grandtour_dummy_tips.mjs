import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import XLSX from 'xlsx';
import { createClient } from '@supabase/supabase-js';

function normalizeName(name){
  return String(name || '').trim().toLowerCase().normalize('NFKD').replace(/\p{Diacritic}/gu, '').replace(/\s+/g,' ');
}

function loadWorkbookRows(filePath){
  if(!fs.existsSync(filePath)) throw new Error(`Workbook not found: ${filePath}`);
  const wb = XLSX.readFile(filePath, { cellDates: true });
  const result = {};
  for(const name of wb.SheetNames){
    const sheet = wb.Sheets[name];
    result[name] = XLSX.utils.sheet_to_json(sheet, { header:1, raw:false });
  }
  return result;
}

function sheetToObjects(rows){
  if(!rows || rows.length<1) return [];
  const headers = rows[0].map(h=>String(h).trim());
  return rows.slice(1).map(r=>{
    const obj = {};
    for(let i=0;i<headers.length;i++){ obj[headers[i]] = r[i] ?? null; }
    return obj;
  });
}

function sqlLiteral(value){
  if(value === null || value === undefined) return 'null';
  if(typeof value === 'boolean') return value ? 'true' : 'false';
  return `'${String(value).replace(/'/g, "''")}'`;
}

function runLocalQuery(sql){
  const filePath = path.join(os.tmpdir(), `grandtour-import-${crypto.randomUUID()}.sql`);
  fs.writeFileSync(filePath, sql, 'utf8');
  try {
    const command = `npx supabase db query --local --file "${filePath}" --output json`;
    const result = spawnSync(command, { shell: true, encoding: 'utf8' });
    if(result.error) throw result.error;
    if(result.status !== 0){
      throw new Error(`Local SQL query failed: ${result.stderr || result.stdout}`);
    }
    return JSON.parse(result.stdout);
  } finally {
    fs.rmSync(filePath, { force:true });
  }
}

async function main(){
  const argv = process.argv.slice(2);
  const dryRun = argv.includes('--dry-run') || !argv.includes('--run');
  const filePath = argv.find(a=>!a.startsWith('--')) || 'C:/Users/Tony/OneDrive/Desktop/grandtour_dummy_users_and_tips.xlsx';
  console.log('Loading workbook:', filePath);
  const sheets = loadWorkbookRows(filePath);

  const workbook = {
    notes: sheetToObjects(sheets['Import Notes']),
    users: sheetToObjects(sheets['Dummy Users']),
    riders: sheetToObjects(sheets['Riders']),
    stages: sheetToObjects(sheets['Stages']),
    stageTips: sheetToObjects(sheets['Stage Tips']),
    dailyJerseys: sheetToObjects(sheets['Daily Jersey Tips']),
    overall: sheetToObjects(sheets['Overall Tips'])
  };

  const planned = { users:0, stageTips:0, dailyJerseys:0, overall:0, missingRiders: new Set(), missingStages: new Set() };

  const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL;
  const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const localOverride = String(process.env.GRANDTOUR_ADMIN_OVERRIDE ?? '').toLowerCase() === 'on';
  let client = null;
  if(SUPABASE_URL && SERVICE_ROLE){
    client = createClient(SUPABASE_URL, SERVICE_ROLE, { auth:{autoRefreshToken:false, persistSession:false} });
    console.log('Connected to Supabase');
  } else {
    console.log('No Supabase env found; running offline dry-run only. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to enable DB checks.');
  }

  // Map riders from workbook
  const riderMap = new Map();
  for(const r of workbook.riders){
    const code = r['rider_id'];
    const bib = r['bib_no'];
    const name = r['rider_name'];
    riderMap.set(code, { code, bib, name, normalized: normalizeName(name)});
  }

  // Map stages from workbook
  const stageNumbers = workbook.stages.map(s=>Number(s['stage_no'])).filter(Boolean);

  if(client){
    // find grand_tour id
    const { data: tours } = await client.from('grand_tours').select('id,name,year').limit(10);
    console.log('Found grand_tours:', (tours||[]).length);
  }

  // Plan operations
  // Users
  for(const u of workbook.users){
    planned.users += 1;
  }

  // Stage tips
  for(const t of workbook.stageTips){
    planned.stageTips += 1;
    // verify riders
    for(let i=1;i<=5;i++){
      const rid = t[`pick_${i}_rider_id`];
      if(rid && !riderMap.has(rid)) planned.missingRiders.add(rid);
    }
    const sn = t['stage_no']; if(!stageNumbers.includes(Number(sn))) planned.missingStages.add(sn);
  }

  // Daily jerseys
  for(const j of workbook.dailyJerseys) planned.dailyJerseys += 1;
  for(const o of workbook.overall) planned.overall += 1;

  const report = {
    dryRun,
    workbookSummary: {
      users: workbook.users.length,
      riders: workbook.riders.length,
      stages: workbook.stages.length,
      stageTips: workbook.stageTips.length,
      dailyJerseys: workbook.dailyJerseys.length,
      overallTips: workbook.overall.length
    },
    plannedCounts: {
      users: planned.users,
      stageTips: planned.stageTips,
      dailyJerseys: planned.dailyJerseys,
      overall: planned.overall
    },
    missingRiders: Array.from(planned.missingRiders),
    missingStages: Array.from(planned.missingStages),
    note: 'This is a dry-run summary. Run with --run to perform real imports. The script uses SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY for DB checks and inserts. Set GRANDTOUR_ADMIN_OVERRIDE=on to allow local lock bypass for import-only SQL inserts.'
  };

  console.log(JSON.stringify(report, null, 2));
  if(!dryRun && client){
    console.log('Real run requested: performing idempotent upserts into Supabase');

    // Helpers
    async function ensureUserByEmail(email, displayName){
      const { data: userPage, error: listError } = await client.auth.admin.listUsers({ page:1, perPage:1000 });
      if(listError) throw listError;
      const found = userPage.users.find(u=>u.email === email);
      if(found) return found;
      const password = `Dummy-${crypto.randomUUID()}-Aa1!`;
      const { data, error } = await client.auth.admin.createUser({ email, email_confirm: true, password });
      if(error) throw error;
      // upsert profile
      const { error: pErr } = await client.from('profiles').upsert({ id: data.user.id, display_name: displayName ?? data.user.email, is_dummy: true }, { onConflict: 'id' });
      if(pErr) throw pErr;
      return data.user;
    }

    async function findOrCreateGrandTour(){
      const { data } = await client.from('grand_tours').select('id').limit(1);
      if(data && data.length) return data[0].id;
      throw new Error('No grand_tours found in DB. Create one before importing.');
    }

    async function buildRiderMap(grandTourId){
      const dbById = new Map();
      const dbByBib = new Map();
      const dbByName = new Map();
      const workbookCodeToDb = new Map();

      const { data, error } = await client.from('grandtour_riders').select('id,display_name,normalized_name,bib_number').eq('grand_tour_id', grandTourId);
      if(error) throw error;
      for(const r of data||[]){
        const idKey = String(r.id);
        dbById.set(idKey, r);
        if(r.bib_number != null) dbByBib.set(String(r.bib_number), r);
        if(r.normalized_name) dbByName.set(r.normalized_name, r);
        if(r.display_name) dbByName.set(normalizeName(r.display_name), r);
      }

      const missing = [];
      for(const workbookRider of workbook.riders){
        const code = workbookRider['rider_id'];
        const normalized = normalizeName(workbookRider['rider_name']);
        const bib = workbookRider['bib_no'] != null ? String(workbookRider['bib_no']).trim() : null;
        const match = dbById.get(String(code)) || (bib ? dbByBib.get(bib) : null) || dbByName.get(normalized);
        if(!match){
          missing.push(code ?? workbookRider['rider_name']);
          continue;
        }
        workbookCodeToDb.set(code, match);
      }

      if(missing.length){
        throw new Error(`Missing existing DB riders for workbook rider identifiers: ${[...new Set(missing)].join(', ')}`);
      }

      return {
        dbById,
        dbByBib,
        dbByName,
        workbookCodeToDb
      };
    }

    function resolveWorkbookRider(riderCache, rid){
      if(!rid) return null;
      const normalized = normalizeName(rid);
      return riderCache.workbookCodeToDb.get(rid)
        || riderCache.dbById.get(String(rid))
        || riderCache.dbByBib.get(String(rid))
        || riderCache.dbByName.get(normalized)
        || null;
    }

    async function resolveGrandTourId(){
      const envId = process.env.GRAND_TOUR_ID?.trim();
      if(envId){
        const { data, error } = await client.from('grand_tours').select('id').eq('id', envId).limit(1).single();
        if(error || !data) throw new Error(`GRAND_TOUR_ID ${envId} not found in grand_tours.`);
        return data.id;
      }
      const { data, error } = await client.from('grand_tours').select('id,name,year,source_url,sport');
      if(error) throw error;
      if(!data || !data.length) throw new Error('No grand_tours found in DB. Create one before importing or set GRAND_TOUR_ID.');
      if(data.length === 1) return data[0].id;

      const candidates = data.filter((tour) => tour.year === 2026 && tour.sport === 'cycling');
      const tdfByName = candidates.filter((tour) => String(tour.name||'').toLowerCase().includes('tour de france'));
      if(tdfByName.length === 1) return tdfByName[0].id;
      if(candidates.length === 1) return candidates[0].id;

      const tourList = data.map(t => `${t.id} (${t.name||'unknown'} ${t.year||'unknown'})`).join(', ');
      throw new Error(`Multiple grand_tours found. Set GRAND_TOUR_ID to the target tour. Available tours: ${tourList}`);
    }

    async function loadStageMap(grandTourId){
      const { data, error } = await client.from('grandtour_stages').select('id,stage_number').eq('grand_tour_id', grandTourId);
      if(error) throw error;
      const existing = new Map();
      for(const s of data||[]) existing.set(Number(s.stage_number), s.id);

      const missing = [];
      for(const s of workbook.stages){
        const num = Number(s.stage_no);
        if(!Number.isFinite(num) || !existing.has(num)) missing.push(s.stage_no);
      }
      if(missing.length){
        throw new Error(`Missing existing DB stages for stage numbers: ${[...new Set(missing)].join(', ')}`);
      }
      return existing;
    }

    function validateWorkbookRiders(riderCache){
      const missing = new Set();
      for(const t of workbook.stageTips){
        for(let i=1;i<=5;i++){
          const rid = t[`pick_${i}_rider_id`];
          if(!rid) continue;
          if(!resolveWorkbookRider(riderCache, rid)) missing.add(rid);
        }
        for(const jt of ['yellow_holder','green_holder','kom_holder','white_holder']){
          const rid = t[jt] || t[`${jt}_rider_id`];
          if(!rid) continue;
          if(!resolveWorkbookRider(riderCache, rid)) missing.add(rid);
        }
      }
      return [...missing];
    }

    // Find target competition and stage map
    const grandTourId = await resolveGrandTourId();
    const stageMap = await loadStageMap(grandTourId);
    const riderCache = await buildRiderMap(grandTourId);
    const missingRidersDb = validateWorkbookRiders(riderCache);
    if(missingRidersDb.length){
      throw new Error(`Missing existing DB riders for workbook rider identifiers: ${missingRidersDb.join(', ')}`);
    }
    const { data: comps } = await client.from('grandtour_competitions').select('id').eq('grand_tour_id', grandTourId).limit(1);
    if(!comps || !comps.length) throw new Error('No grandtour_competitions found for the tour.');
    const competitionId = comps[0].id;

    // Ensure users
    const usersByEmail = new Map();
    for(const u of workbook.users){
      const email = u.email || `dummy.${crypto.randomUUID()}@example.invalid`;
      const display = u.display_name || u.email || email;
      const user = await ensureUserByEmail(email, display);
      usersByEmail.set(u.user_id, user);
    }

    // Insert tips
    let insertedTips = 0;
    for(const t of workbook.stageTips){
      const userRef = workbook.users.find(uu=>uu.user_id === t.user_id) || workbook.users[0];
      const user = usersByEmail.get(userRef.user_id);
      const stageNo = Number(t.stage_no);
      const stageId = stageMap.get(stageNo);
      if(!stageId) { console.warn('Missing stage for', stageNo); continue; }

      // Build tip row (omit id to allow default UUID)
      const tipRow = {
        user_id: user.id,
        competition_id: competitionId,
        stage_id: stageId,
        tip_mode: 'daily',
        tip_scope: 'stage',
        status: t.status || 'submitted',
        is_dummy: true
      };

      const selectionRows = [];
      for(let i = 1; i <= 5; i += 1){
        const rid = t[`pick_${i}_rider_id`];
        if(!rid) continue;
        const mapped = resolveWorkbookRider(riderCache, rid);
        if(!mapped) { console.warn('Missing rider mapping for', rid); continue; }
        selectionRows.push({ selection_type: 'stage_top_5', rider_id: mapped.id, predicted_position: i });
      }
      for(const jt of ['yellow_holder','green_holder','kom_holder','white_holder']){
        const rid = t[jt] || t[`${jt}_rider_id`];
        if(!rid) continue;
        const mapped = resolveWorkbookRider(riderCache, rid);
        if(!mapped) { console.warn('Missing jersey rider mapping for', rid); continue; }
        selectionRows.push({ selection_type: jt, rider_id: mapped.id, predicted_position: null });
      }

      if(localOverride){
        const values = selectionRows.map((selection) => `(
          ${sqlLiteral(selection.selection_type)}::public.grandtour_tip_selection_type,
          ${sqlLiteral(selection.rider_id)},
          ${selection.predicted_position === null ? 'null' : String(selection.predicted_position)}
        )`).join(',\n        ');

        const sql = `BEGIN;
SET LOCAL search_path = 'public';
SET LOCAL grandtour.admin_override = 'on';
WITH upserted_tip AS (
  INSERT INTO public.grandtour_tips (
    user_id, competition_id, stage_id, tip_mode, tip_scope, status, is_dummy
  ) VALUES (
    ${sqlLiteral(tipRow.user_id)},
    ${sqlLiteral(tipRow.competition_id)},
    ${sqlLiteral(tipRow.stage_id)},
    ${sqlLiteral(tipRow.tip_mode)},
    ${sqlLiteral(tipRow.tip_scope)},
    ${sqlLiteral(tipRow.status)},
    ${sqlLiteral(tipRow.is_dummy)}
  )
  ON CONFLICT (user_id, competition_id, stage_id, tip_mode)
  DO UPDATE SET
    status = EXCLUDED.status,
    is_dummy = EXCLUDED.is_dummy,
    updated_at = now()
  RETURNING id
)${values.length ? `,
selection_rows(selection_type, rider_id, predicted_position) AS (
  VALUES
        ${values}
)` : ''}
DELETE FROM public.grandtour_tip_selections
WHERE tip_id = (SELECT id FROM upserted_tip);
${values.length ? `INSERT INTO public.grandtour_tip_selections (
  tip_id, selection_type, rider_id, predicted_position
)
SELECT upserted_tip.id, selection_type, rider_id, predicted_position
FROM upserted_tip
CROSS JOIN selection_rows;
` : ''}COMMIT;`;

        runLocalQuery(sql);
        insertedTips += 1;
      } else {
        const { data: upserted, error: tipErr } = await client.from('grandtour_tips')
          .upsert(tipRow, { onConflict: 'user_id,competition_id,stage_id,tip_mode' })
          .select('id');
        let tipId = null;
        if(tipErr) throw tipErr;
        if(upserted && upserted[0] && upserted[0].id) tipId = upserted[0].id;
        if(!tipId){
          const { data: found } = await client.from('grandtour_tips')
            .select('id')
            .match({ user_id: tipRow.user_id, competition_id: tipRow.competition_id, stage_id: tipRow.stage_id, tip_mode: tipRow.tip_mode })
            .limit(1)
            .single();
          if(found) tipId = found.id;
        }
        if(!tipId) throw new Error('Failed to get tip id after upsert');

        const { error: delErr } = await client.from('grandtour_tip_selections').delete().eq('tip_id', tipId);
        if(delErr) throw delErr;

        if(selectionRows.length){
          const insertRows = selectionRows.map((selection) => ({
            tip_id: tipId,
            selection_type: selection.selection_type,
            rider_id: selection.rider_id,
            predicted_position: selection.predicted_position
          }));
          const { error: insErr } = await client.from('grandtour_tip_selections').insert(insertRows);
          if(insErr) throw insErr;
        }

        const { error: updErr } = await client.from('grandtour_tips').update({ status: 'submitted' }).eq('id', tipId);
        if(updErr) throw updErr;
        insertedTips += 1;
      }
    }

    console.log(JSON.stringify({ insertedTips, users: workbook.users.length }, null, 2));
  }
}

main().catch(err=>{ console.error(err); process.exit(1); });
