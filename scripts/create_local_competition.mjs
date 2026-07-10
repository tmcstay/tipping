import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

async function main(){
  const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL;
  const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!SUPABASE_URL || !SERVICE_ROLE) throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
  const client = createClient(SUPABASE_URL, SERVICE_ROLE, { auth:{autoRefreshToken:false, persistSession:false} });

  // find grand_tour
  const { data: tours, error: tourErr } = await client.from('grand_tours').select('id').limit(1);
  if(tourErr) throw tourErr;
  if(!tours || tours.length===0) throw new Error('No grand_tours found');
  const grandTourId = tours[0].id;
  console.log('Found grand_tour:', grandTourId);

  // check existing grandtour_competitions
  const { data: existing } = await client.from('grandtour_competitions').select('id,competition_id').eq('grand_tour_id', grandTourId).limit(1);
  if(existing && existing.length){
    console.log('grandtour_competition already exists:', existing[0]);
    return;
  }

  // find app id (prefer code 'cycling')
  const { data: apps } = await client.from('apps').select('id,code').eq('code','cycling').limit(1);
  let appId = (apps && apps[0] && apps[0].id) || null;
  if(!appId){
    // try to find any app
    const { data: allApps } = await client.from('apps').select('id').limit(1);
    if(allApps && allApps.length){
      appId = allApps[0].id;
      console.log('Using existing app id:', appId);
    } else {
      // create a minimal app row
      const newAppId = crypto.randomUUID();
      const { error: appErr } = await client.from('apps').insert({ id: newAppId, code: 'cycling', name: 'Cycling App' });
      if(appErr) throw appErr;
      appId = newAppId;
      console.log('Inserted fallback app id:', appId);
    }
  }

  const competitionKey = 'local-dummy-competition';
  const competitionId = crypto.randomUUID();
  const competitionRow = {
    id: competitionId,
    app_id: appId || undefined,
    competition_key: competitionKey,
    name: 'Local Dummy Competition',
    sport_type: 'cycling',
    season: String(new Date().getFullYear()),
    starts_at: new Date().toISOString(),
    ends_at: new Date(Date.now()+24*3600*1000).toISOString(),
    is_active: true,
    is_public: true
  };

  // upsert competition by competition_key
  const { data: compUp, error: compErr } = await client.from('competitions').upsert(competitionRow, { onConflict: 'competition_key' }).select('id').limit(1);
  if(compErr) throw compErr;
  const usedCompetitionId = (compUp && compUp[0] && compUp[0].id) ? compUp[0].id : competitionId;
  console.log('Competition id:', usedCompetitionId);

  const grandCompId = crypto.randomUUID();
  const grandCompRow = {
    id: grandCompId,
    grand_tour_id: grandTourId,
    competition_id: usedCompetitionId,
    name: 'Local Dummy GrandTour Competition',
    is_public: true,
    allow_preselection: true,
    allow_daily: true
  };

  const { data: gcUp, error: gcErr } = await client.from('grandtour_competitions').upsert(grandCompRow, { onConflict: '(grand_tour_id,competition_id)' }).select('id').limit(1);
  if(gcErr) throw gcErr;
  console.log('grandtour_competition created or exists:', gcUp && gcUp[0] ? gcUp[0] : grandCompRow);
}

main().catch(err=>{ console.error(err); process.exit(1); });
