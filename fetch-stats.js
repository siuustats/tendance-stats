// fetch-stats.js — Tendance Stats
// Logique : stats saison + analyse 5 derniers matchs pour top 15 par ligue

const fs = require('fs');

const API_KEY = process.env.CLE_1;
const SEASON  = 2024;

const LEAGUES = [
  { id: 61,  name: 'Ligue 1',        flag: 'fr',     flagAlt: 'FR', cls: 'l1',  label: 'L1'   },
  { id: 39,  name: 'Premier League', flag: 'gb-eng', flagAlt: 'EN', cls: 'pl',  label: 'PL'   },
  { id: 140, name: 'La Liga',        flag: 'es',     flagAlt: 'ES', cls: 'lg',  label: 'LIGA' },
  { id: 135, name: 'Serie A',        flag: 'it',     flagAlt: 'IT', cls: 'sa',  label: 'SA'   },
  { id: 78,  name: 'Bundesliga',     flag: 'de',     flagAlt: 'DE', cls: 'bl',  label: 'BL'   },
];

let reqCount = 0;

async function apiFetch(url) {
  reqCount++;
  console.log(`  [${reqCount}] GET ${url}`);
  const res = await fetch(url, { headers: { 'x-apisports-key': API_KEY } });
  const data = await res.json();
  if (data.errors && Object.keys(data.errors).length > 0) {
    console.warn(`  ⚠️  Erreurs API:`, JSON.stringify(data.errors));
  }
  await new Promise(r => setTimeout(r, 300));
  return data;
}

// ── Calculs ──────────────────────────────────────────────────────────────────

function calcTrendScore(recentMatches) {
  // recentMatches = tableau des 5 derniers matchs { goals, assists, played, teamWon }
  if (!recentMatches || recentMatches.length === 0) return 0;

  let score = 0;
  recentMatches.forEach((m, i) => {
    const weight = i === 0 ? 1.0 : 0.9; // match le plus récent = poids légèrement plus fort
    score += (m.goals + m.assists) * weight;
    if (m.teamWon)  score += 0.5;
  });

  // Malus si n'a pas joué le dernier match
  if (!recentMatches[0].played) score -= 3;

  // Bonus forme équipe : nombre de victoires sur 5 matchs
  const wins = recentMatches.filter(m => m.teamWon).length;
  if (wins >= 4)      score += 2;
  else if (wins >= 3) score += 1;

  return parseFloat(score.toFixed(2));
}

function buildFormDots(recentMatches) {
  return recentMatches.map(m => {
    if (!m.played) return 'x';
    if (m.goals > 0 && m.assists > 0) return 'g'; // but prioritaire
    if (m.goals > 0)   return 'g';
    if (m.assists > 0) return 'a';
    return 'x';
  });
}

function calcSeasonSignal(goals, assists, games, rank) {
  const base = Math.min(98, 55 + goals * 1.5 + assists * 0.8);
  return Math.max(40, Math.round(base - rank * 0.8));
}

// ── Fetch helpers ─────────────────────────────────────────────────────────────

async function getTopPlayers(leagueId) {
  const base = `https://v3.football.api-sports.io`;
  const seen = new Map();

  const endpoints = [
    `${base}/players/topscorers?league=${leagueId}&season=${SEASON}`,
    `${base}/players/topscorers?league=${leagueId}&season=${SEASON}&page=2`,
    `${base}/players/topassists?league=${leagueId}&season=${SEASON}`,
    `${base}/players/topassists?league=${leagueId}&season=${SEASON}&page=2`,
  ];

  for (const url of endpoints) {
    const data = await apiFetch(url);
    for (const item of (data.response || [])) {
      const p = item.player;
      const s = item.statistics?.find(st => st.league?.id === leagueId) || item.statistics?.[0];
      if (!s || seen.has(p.id)) continue;
      const goals   = s.goals?.total       || 0;
      const assists = s.goals?.assists     || 0;
      const games   = s.games?.appearences || 0;
      seen.set(p.id, {
        id: p.id, name: p.name, photo: p.photo,
        teamId:   s.team?.id,
        teamName: s.team?.name  || '',
        teamLogo: s.team?.logo  || '',
        goals, assists, games,
        avg: games > 0 ? parseFloat((goals / games).toFixed(2)) : 0,
      });
    }
  }

  return [...seen.values()].sort((a, b) => b.goals - a.goals);
}

async function getLast5Matches(teamId) {
  const data = await apiFetch(
    `https://v3.football.api-sports.io/fixtures?team=${teamId}&last=5`
  );
  return (data.response || []).sort((a, b) =>
    new Date(b.fixture.date) - new Date(a.fixture.date)
  );
}

async function getPlayerStatsInFixture(fixtureId, teamId) {
  const data = await apiFetch(
    `https://v3.football.api-sports.io/fixtures/players?fixture=${fixtureId}&team=${teamId}`
  );
  // Retourne le tableau des joueurs du match
  return data.response?.[0]?.players || [];
}

// ── Traitement principal par ligue ────────────────────────────────────────────

async function fetchLeague(league) {
  console.log(`\n📥 ${league.name}`);

  // Étape 1 : récupérer tous les tops joueurs
  const allPlayers = await getTopPlayers(league.id);
  console.log(`  📋 ${allPlayers.length} joueurs en base`);

  // Étape 2 : analyse détaillée sur le top 15
  const top15 = allPlayers.slice(0, 15);
  console.log(`  🔍 Analyse des 5 derniers matchs pour ${top15.length} joueurs...`);

  // Mettre en cache les fixtures par équipe pour éviter les doublons
  const fixtureCache = new Map();

  for (const player of top15) {
    if (!player.teamId) continue;

    // Récupérer les 5 derniers matchs de l'équipe (avec cache)
    if (!fixtureCache.has(player.teamId)) {
      const fixtures = await getLast5Matches(player.teamId);
      fixtureCache.set(player.teamId, fixtures);
    }
    const fixtures = fixtureCache.get(player.teamId);

    // Pour chaque match, récupérer les stats du joueur
    const recentMatches = [];
    for (const fixture of fixtures.slice(0, 5)) {
      const fId     = fixture.fixture.id;
      const homeId  = fixture.teams.home.id;
      const awayId  = fixture.teams.away.id;
      const teamId  = player.teamId;

      // Résultat de l'équipe
      const homeGoals = fixture.goals.home;
      const awayGoals = fixture.goals.away;
      let teamWon = false;
      if (teamId === homeId) teamWon = homeGoals > awayGoals;
      else                   teamWon = awayGoals > homeGoals;

      // Stats du joueur dans ce match
      const matchPlayers = await getPlayerStatsInFixture(fId, teamId);
      const pStats = matchPlayers.find(mp => mp.player?.id === player.id);

      if (!pStats) {
        recentMatches.push({ goals: 0, assists: 0, played: false, teamWon, date: fixture.fixture.date });
        continue;
      }

      const mins    = pStats.statistics?.[0]?.games?.minutes || 0;
      const goals   = pStats.statistics?.[0]?.goals?.total   || 0;
      const assists = pStats.statistics?.[0]?.goals?.assists  || 0;

      recentMatches.push({
        goals,
        assists,
        played:  mins > 0,
        teamWon,
        date:    fixture.fixture.date,
        minutes: mins,
      });
    }

    player.recentMatches  = recentMatches;
    player.trendScore     = calcTrendScore(recentMatches);
    player.form           = buildFormDots(recentMatches);
    player.recent_goals   = recentMatches.reduce((s, m) => s + m.goals,   0);
    player.recent_assists = recentMatches.reduce((s, m) => s + m.assists, 0);
    player.recentGames    = recentMatches.filter(m => m.played).length;

    console.log(`    ${player.name}: ${player.recent_goals}B ${player.recent_assists}P sur 5J → trend: ${player.trendScore}`);
  }

  // Étape 3 : compléter les joueurs sans analyse récente (rank 15+)
  for (const [i, player] of allPlayers.slice(15).entries()) {
    player.trendScore     = 0;
    player.form           = Array(5).fill('x');
    player.recent_goals   = 0;
    player.recent_assists = 0;
    player.recentGames    = 0;
    player.recentMatches  = [];
  }

  // Ajouter les infos ligue + signal saison
  const result = allPlayers.map((p, i) => ({
    ...p,
    leagueId:      league.id,
    leagueName:    league.name,
    leagueFlag:    league.flag,
    leagueFlagAlt: league.flagAlt,
    leagueCls:     league.cls,
    leagueLabel:   league.label,
    signal:        calcSeasonSignal(p.goals, p.assists, p.games, i),
    hot:           p.trendScore > 3 && p.recentGames >= 2,
  }));

  console.log(`  ✅ ${result.length} joueurs — top tendance: ${result.sort((a,b) => b.trendScore - a.trendScore)[0]?.name} (${result[0]?.trendScore})`);
  return result;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🚀 Début — ' + new Date().toISOString());

  if (!API_KEY) {
    console.error('❌ Clé API manquante (CLE_1)');
    process.exit(1);
  }

  const allPlayers = [];
  const errors     = [];

  for (const league of LEAGUES) {
    try {
      allPlayers.push(...await fetchLeague(league));
    } catch (err) {
      console.error(`❌ ${league.name}: ${err.message}`);
      errors.push({ league: league.name, error: err.message });
    }
  }

  // Tri final : trendScore pour le top, goals pour le reste
  allPlayers.sort((a, b) => b.trendScore - a.trendScore || b.goals - a.goals);

  fs.writeFileSync('data.json', JSON.stringify({
    updatedAt:    new Date().toISOString(),
    season:       SEASON,
    totalPlayers: allPlayers.length,
    totalRequests: reqCount,
    errors,
    players:      allPlayers,
  }));

  console.log(`\n✅ Terminé — ${allPlayers.length} joueurs | ${reqCount} requêtes utilisées`);
  if (errors.length) console.warn(`⚠️  ${errors.length} erreur(s)`, errors);
}

main().catch(err => { console.error('💥', err); process.exit(1); });
