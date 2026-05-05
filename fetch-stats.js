// fetch-stats.js — Tendance Stats
// Source : SofaScore API non-officielle + Apify SofaScore Scraper PRO
// Logique : matchs d'hier → buteurs/passeurs → stockage cumulatif

const fs = require('fs');

const APIFY_TOKEN = process.env.APIFY_TOKEN;
const DATA_FILE   = 'data.json';

// IDs SofaScore des 6 compétitions
const TOURNAMENTS = [
  { id: 34,   name: 'Ligue 1',          flag: 'fr',     flagAlt: 'FR', cls: 'l1',  label: 'L1'   },
  { id: 17,   name: 'Premier League',   flag: 'gb-eng', flagAlt: 'EN', cls: 'pl',  label: 'PL'   },
  { id: 8,    name: 'La Liga',          flag: 'es',     flagAlt: 'ES', cls: 'lg',  label: 'LIGA' },
  { id: 23,   name: 'Serie A',          flag: 'it',     flagAlt: 'IT', cls: 'sa',  label: 'SA'   },
  { id: 35,   name: 'Bundesliga',       flag: 'de',     flagAlt: 'DE', cls: 'bl',  label: 'BL'   },
  { id: 7,    name: 'Ligue des Champions', flag: 'eu',  flagAlt: 'CL', cls: 'cl',  label: 'LDC'  },
];

let reqCount = 0;

// ── Calculs ───────────────────────────────────────────────────────────────────

function calcTrendScore(last5) {
  if (!last5 || last5.length === 0) return 0;
  let score = 0;
  last5.forEach((m, i) => {
    const weight = i === 0 ? 1.0 : 0.9;
    score += (m.goals + m.assists) * weight;
    if (m.teamWon) score += 0.5;
  });
  if (!last5[0].played) score -= 3;
  const wins = last5.filter(m => m.teamWon).length;
  if (wins >= 4)      score += 2;
  else if (wins >= 3) score += 1;
  return parseFloat(score.toFixed(2));
}

function buildFormDots(last5) {
  return last5.map(m => {
    if (!m.played)     return 'x';
    if (m.goals > 0)   return 'g';
    if (m.assists > 0) return 'a';
    return 'x';
  });
}

// ── Charger data.json ─────────────────────────────────────────────────────────

function loadData() {
  if (fs.existsSync(DATA_FILE)) {
    try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
    catch (e) { console.warn('⚠️  data.json corrompu'); }
  }
  return { matches: [], players: {} };
}

// ── SofaScore API : matchs d'une date par tournoi ─────────────────────────────

async function getMatchesByDate(tournamentId, date) {
  reqCount++;
  const url = `https://api.sofascore.com/api/v1/sport/football/scheduled-events/${date}`;
  console.log(`  [${reqCount}] SofaScore API: ${url}`);
  await new Promise(r => setTimeout(r, 1000));
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
      }
    });
    if (!res.ok) { console.warn(`  ⚠️  HTTP ${res.status}`); return []; }
    const data = await res.json();
    // Filtrer par tournoi et matchs terminés
    return (data.events || []).filter(e =>
      e.tournament?.uniqueTournament?.id === tournamentId &&
      e.status?.type === 'finished'
    );
  } catch(e) {
    console.warn(`  ⚠️  Erreur SofaScore: ${e.message}`);
    return [];
  }
}

// ── Apify : scraper les détails d'un match SofaScore ─────────────────────────

async function scrapeMatchDetails(matchUrl) {
  reqCount++;
  console.log(`  [${reqCount}] Apify scrape: ${matchUrl}`);
  try {
    const res = await fetch(
      `https://api.apify.com/v2/acts/azzouzana~sofascore-scraper-pro/run-sync-get-dataset-items?token=${APIFY_TOKEN}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ startUrls: [matchUrl] }),
      }
    );
    if (!res.ok) { console.warn(`  ⚠️  Apify HTTP ${res.status}`); return null; }
    const items = await res.json();
    return items?.[0] || null;
  } catch(e) {
    console.warn(`  ⚠️  Apify erreur: ${e.message}`);
    return null;
  }
}

// ── Extraire buteurs + passeurs depuis les incidents ─────────────────────────

function extractGoalsAndAssists(item, tournament) {
  const players = [];
  if (!item?.data) return players;

  const incidents   = item.data.incidents || [];
  const homeTeam    = item.data.event?.homeTeam;
  const awayTeam    = item.data.event?.awayTeam;
  const homeScore   = item.data.event?.homeScore?.current ?? 0;
  const awayScore   = item.data.event?.awayScore?.current ?? 0;
  const matchDate   = item.data.event?.startTimestamp
    ? new Date(item.data.event.startTimestamp * 1000).toISOString()
    : new Date().toISOString();

  // Compteurs par joueur
  const goalsMap   = {};
  const assistsMap = {};
  const infoMap    = {};

  for (const inc of incidents) {
    if (inc.incidentType !== 'goal') continue;
    if (inc.incidentClass === 'ownGoal') continue; // ignorer CSC

    const isHome = inc.isHome;
    const team   = isHome ? homeTeam : awayTeam;
    const teamWon = isHome ? homeScore > awayScore : awayScore > homeScore;

    // Buteur
    if (inc.player?.id) {
      const pid = inc.player.id;
      goalsMap[pid]  = (goalsMap[pid] || 0) + 1;
      infoMap[pid]   = infoMap[pid] || {
        id:       pid,
        name:     inc.player.name,
        photo:    `https://api.sofascore.com/api/v1/player/${pid}/image`,
        teamName: team?.name || '',
        teamWon,
        leagueId:      tournament.id,
        leagueName:    tournament.name,
        leagueFlag:    tournament.flag,
        leagueFlagAlt: tournament.flagAlt,
        leagueCls:     tournament.cls,
        leagueLabel:   tournament.label,
      };
    }

    // Passeur décisif
    for (const shot of (inc.shotList || [])) {
      if (shot.eventType === 'assist' && shot.player?.id) {
        const aid = shot.player.id;
        assistsMap[aid] = (assistsMap[aid] || 0) + 1;
        infoMap[aid] = infoMap[aid] || {
          id:       aid,
          name:     shot.player.name,
          photo:    `https://api.sofascore.com/api/v1/player/${aid}/image`,
          teamName: team?.name || '',
          teamWon,
          leagueId:      tournament.id,
          leagueName:    tournament.name,
          leagueFlag:    tournament.flag,
          leagueFlagAlt: tournament.flagAlt,
          leagueCls:     tournament.cls,
          leagueLabel:   tournament.label,
        };
      }
    }
  }

  // Construire la liste finale
  const allIds = new Set([...Object.keys(goalsMap), ...Object.keys(assistsMap)]);
  for (const id of allIds) {
    const info = infoMap[id];
    if (!info) continue;
    players.push({
      ...info,
      goals:   goalsMap[id]   || 0,
      assists: assistsMap[id] || 0,
      played:  true,
      date:    matchDate,
    });
  }

  return players;
}

// ── Recalculer le classement depuis l'historique ──────────────────────────────

function rebuildPlayers(matches) {
  const playerMatches = {};

  for (const match of matches) {
    for (const p of (match.players || [])) {
      if (!playerMatches[p.id]) {
        playerMatches[p.id] = { info: p, matches: [] };
      }
      if (p.goals > 0 || p.assists > 0) playerMatches[p.id].info = p;
      playerMatches[p.id].matches.push({
        goals:   p.goals,
        assists: p.assists,
        played:  p.played,
        teamWon: p.teamWon,
        date:    p.date || match.date,
      });
    }
  }

  const players = [];
  for (const [, data] of Object.entries(playerMatches)) {
    const info = data.info;
    if (!info?.name) continue;

    data.matches.sort((a, b) => new Date(b.date) - new Date(a.date));
    const last5          = data.matches.slice(0, 5);
    const trendScore     = calcTrendScore(last5);
    const form           = buildFormDots(last5);
    const recent_goals   = last5.reduce((s, m) => s + m.goals,   0);
    const recent_assists = last5.reduce((s, m) => s + m.assists, 0);
    const totalGoals     = data.matches.reduce((s, m) => s + m.goals,   0);
    const totalAssists   = data.matches.reduce((s, m) => s + m.assists, 0);
    const totalGames     = data.matches.length;

    players.push({
      id:            info.id,
      name:          info.name,
      photo:         info.photo || '',
      teamName:      info.teamName || '',
      leagueId:      info.leagueId,
      leagueName:    info.leagueName,
      leagueFlag:    info.leagueFlag,
      leagueFlagAlt: info.leagueFlagAlt,
      leagueCls:     info.leagueCls,
      leagueLabel:   info.leagueLabel,
      totalGoals,
      totalAssists,
      totalGames,
      avg: totalGames > 0 ? parseFloat((totalGoals / totalGames).toFixed(2)) : 0,
      recent_goals,
      recent_assists,
      trendScore,
      form,
      last5,
      signal: Math.min(98, Math.round(50 + trendScore * 10)),
      hot: trendScore > 2 && recent_goals + recent_assists >= 2,
    });
  }

  return players.sort((a, b) => b.trendScore - a.trendScore || b.totalGoals - a.totalGoals);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🚀 Début — ' + new Date().toISOString());
  if (!APIFY_TOKEN) { console.error('❌ APIFY_TOKEN manquant'); process.exit(1); }

  // Date d'hier
  const d = new Date();
  d.setDate(d.getDate() - 1);
  const yesterday = d.toISOString().slice(0, 10);
  console.log(`📅 Date cible : ${yesterday}`);

  const stored        = loadData();
  const storedIds     = new Set((stored.matches || []).map(m => m.fixtureId));
  const newMatches    = [];

  for (const tournament of TOURNAMENTS) {
    console.log(`\n⚽ ${tournament.name}`);

    // 1. Récupérer les matchs terminés hier
    const events = await getMatchesByDate(tournament.id, yesterday);
    console.log(`  📅 ${events.length} match(s) terminé(s)`);

    for (const event of events) {
      const fId = event.id;
      if (storedIds.has(fId)) { console.log(`  ⏭️  ${fId} déjà stocké`); continue; }

      const homeTeam  = event.homeTeam?.name || '?';
      const awayTeam  = event.awayTeam?.name || '?';
      const homeScore = event.homeScore?.current ?? 0;
      const awayScore = event.awayScore?.current ?? 0;
      const slug      = event.slug || `${event.homeTeam?.slug}-${event.awayTeam?.slug}`;
      const matchUrl  = `https://www.sofascore.com/football/match/${slug}/${event.customId}`;

      console.log(`  🎮 ${homeTeam} ${homeScore}-${awayScore} ${awayTeam}`);
      console.log(`     URL: ${matchUrl}`);

      // 2. Scraper les détails via Apify
      const detail  = await scrapeMatchDetails(matchUrl);
      if (!detail) { console.warn(`  ⚠️  Pas de détails pour ce match`); continue; }

      // 3. Extraire buteurs + passeurs
      const players = extractGoalsAndAssists(detail, tournament);
      const contributors = players.filter(p => p.goals > 0 || p.assists > 0);
      console.log(`  👥 ${contributors.length} joueur(s) avec contribution`);
      contributors.forEach(p => console.log(`     ${p.name}: ${p.goals}B ${p.assists}P`));

      newMatches.push({
        fixtureId:  fId,
        date:       new Date(event.startTimestamp * 1000).toISOString(),
        leagueId:   tournament.id,
        leagueName: tournament.name,
        homeTeam,
        awayTeam,
        homeGoals:  homeScore,
        awayGoals:  awayScore,
        players,
      });
    }
  }

  if (newMatches.length === 0) {
    console.log('\n😴 Aucun nouveau match — data.json inchangé');
    stored.updatedAt     = new Date().toISOString();
    stored.totalRequests = reqCount;
    fs.writeFileSync(DATA_FILE, JSON.stringify(stored));
    return;
  }

  // Fusionner et garder 100 matchs max par ligue
  const allMatches = [...(stored.matches || []), ...newMatches];
  const byLeague   = {};
  for (const m of allMatches) {
    if (!byLeague[m.leagueId]) byLeague[m.leagueId] = [];
    byLeague[m.leagueId].push(m);
  }
  const trimmed = [];
  for (const lm of Object.values(byLeague)) {
    lm.sort((a, b) => new Date(b.date) - new Date(a.date));
    trimmed.push(...lm.slice(0, 100));
  }

  const players = rebuildPlayers(trimmed);

  fs.writeFileSync(DATA_FILE, JSON.stringify({
    updatedAt:       new Date().toISOString(),
    totalMatches:    trimmed.length,
    totalPlayers:    players.length,
    totalRequests:   reqCount,
    newMatchesToday: newMatches.length,
    matches:         trimmed,
    players,
  }));

  console.log(`\n✅ ${newMatches.length} match(s) | ${players.length} joueurs | ${reqCount} requêtes`);
  if (players.length > 0) {
    console.log(`🏆 Top tendance : ${players[0].name} (trend: ${players[0].trendScore})`);
  }
}

main().catch(err => { console.error('💥', err); process.exit(1); });
