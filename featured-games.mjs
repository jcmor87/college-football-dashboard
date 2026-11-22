const AP_POLL = 'AP Top 25';
const LIMIT = 5;

export function selectFeaturedGames({poll, teams = [], games = [], week}) {
  const ranks = new Map(teams
    .filter(team => team.id != null && Number.isInteger(team.rank) && team.rank >= 1 && team.rank <= 25)
    .map(team => [String(team.id), team.rank]));
  if (poll !== AP_POLL || !ranks.size) return {status: 'no-poll', games: []};

  // Earlier snapshots do not have game team IDs. Only an exact, unique
  // directory name can identify a team in those snapshots.
  const idsByName = new Map();
  for (const {id, name} of teams) {
    idsByName.set(name, idsByName.has(name) ? null : id);
  }
  const getRank = (id, name) => {
    const teamId = id ?? idsByName.get(name);
    return teamId == null ? null : ranks.get(String(teamId)) ?? null;
  };
  const rankedGames = [];
  for (const game of games) {
    if (week != null && game.week != null && game.week !== week) continue;
    const awayRank = getRank(game.away_id, game.away);
    const homeRank = getRank(game.home_id, game.home);
    const rankedTeams = Number(awayRank !== null) + Number(homeRank !== null);
    if (!rankedTeams) continue;
    const kickoff = Date.parse(game.date);
    rankedGames.push({
      ...game, awayRank, homeRank, rankedTeams,
      kickoff: Number.isFinite(kickoff) ? kickoff : Infinity,
    });
  }

  rankedGames.sort((a, b) => b.rankedTeams - a.rankedTeams || a.kickoff - b.kickoff);
  return {status: rankedGames.length ? 'available' : 'no-games', games: rankedGames.slice(0, LIMIT)};
}
