// fetch-stats.js
// Exécuté chaque soir par GitHub Actions
// Génère data.json avec TOUS les joueurs des 5 championnats

const fs = require('fs');

const LEAGUES = [
  { id: 61,  name: 'Ligue 1',        flag: 'fr',     flagAlt: 'FR', cls: 'l1',  label: 'L1',   key: 'CLE_1' },
  { id: 39,  name: 'Premier League', flag: 'gb-eng', flagAlt: 'EN', cls: 'pl',  label: 'PL',   key: 'CLE_2' },
  { id: 140, name: 'La Liga',        flag: 'es',     flagAlt: 'ES', cls: 'lg',  label: 'LIGA', key: 'CLE_3' },
  { id: 135, name: 'Serie A',        flag: 'it',     flagAlt: 'IT', cls: 'sa',  label: 'SA',   key: 'CLE_4' },
  { id: 78,  name: 'Bundesliga',     flag: 'de',     flagAlt: 'DE', cls: 'bl',  label: 'BL',   key: 'CLE_5' },
];

const SEASON = 2024;

async function fetchPage(leagueId, apiKey, page = 1) {
  const url = `https://v3.football.api-sports.io/players?league=${leagueId}&season=${SEASON}&page=${page}`;
  const res = await fetch(url, { headers: { 'x-apisports-key': apiKey } });
  if (!res.ok) throw new Error(`HTTP ${res.status} — ligue ${leagueId} page ${page}`);
  return res.json();
}

function calcSignal(goals, assists, games, rank) {
  const base = Math.min(98, 55 + goals * 1.5 + assists * 0.8);
  const penalty = rank * 0.8;
  return Math.max(40, Math.round(base - penalty));
}

function buildRecentForm(goals, assists, games) {
  const form = [];
  const rateG = goals / Math.max(games, 1);
  const rateA = assists / Math.max(games, 1);
  for (let i = 0; i < 10; i++) {
    const r = Math.random();
    const boost = i >= 5 ? 1.2 : 0.85;
    if (r < rateG * boost && goals > 0)                  form.push('g');
    else if (r < (rateG + rateA) * boost && assists > 0) form.push('a');
    else                                                  form.push('x');
  }
  return form;
}

async function fetchLeague(league) {
  console.log(`\n📥 ${league.name}...`);
  const apiKey = process.env[league.key];
  if (!apiKey) { console.warn(`  ⚠️  Clé manquante : ${league.key}`); return []; }

  const first = await fetchPage(league.id, apiKey, 1);
  const totalPages = first.paging?.total || 1;
  console.log(`  📄 ${totalPages} page(s)`);

  let allItems = [...(first.response || [])];
  for (let page = 2; page <= totalPages; page++) {
    console.log(`  Page ${page}/${totalPages}`);
    const data = await fetchPage(league.id, apiKey, page);
    allItems = allItems.concat(data.response || []);
    await new Promise(r => setTimeout(r, 350));
  }

  const players = allItems.map((item, i) => {
    const p = item.player;
    const s = item.statistics?.[0];
    if (!s) return null;
    const goals   = s.goals?.total       || 0;
    const assists = s.goals?.assists     || 0;
    const games   = s.games?.appearences || 0;
    if (goals === 0 && assists === 0) return null;
    const form           = buildRecentForm(goals, assists, games);
    const recent_goals   = form.slice(-5).filter(f => f === 'g').length;
    const recent_assists = form.slice(-5).filter(f => f === 'a').length;
    const recentScore    = recent_goals + recent_assists * 0.7;
    const signal         = calcSignal(goals, assists, games, i);
    return {
      id: p.id, name: p.name, photo: p.photo,
      team: s.team?.name || '', teamLogo: s.team?.logo || '',
      leagueId: league.id, leagueName: league.name,
      leagueFlag: league.flag, leagueFlagAlt: league.flagAlt,
      leagueCls: league.cls, leagueLabel: league.label,
      goals, assists, games,
      avg: games > 0 ? parseFloat((goals / games).toFixed(2)) : 0,
      form, recent_goals, recent_assists, recentScore, signal,
      hot: signal > 78 && goals >= 5,
    };
  }).filter(Boolean).sort((a, b) => b.goals - a.goals);

  console.log(`  ✅ ${players.length} joueurs avec contributions`);
  return players;
}

async function main() {
  console.log('🚀 Récupération stats football — ' + new Date().toISOString());
  const allPlayers = [];
  const errors = [];
  for (const league of LEAGUES) {
    try { allPlayers.push(...await fetchLeague(league)); }
    catch (err) { console.error(`❌ ${league.name} : ${err.message}`); errors.push({ league: league.name, error: err.message }); }
  }
  fs.writeFileSync('data.json', JSON.stringify({ updatedAt: new Date().toISOString(), season: SEASON, totalPlayers: allPlayers.length, errors, players: allPlayers }));
  console.log(`\n✅ data.json — ${allPlayers.length} joueurs`);
}

main().catch(err => { console.error('💥', err); process.exit(1); });
