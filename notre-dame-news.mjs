const shownByDefault = 5;
const maxArticles = 20;
const refreshGrace = 9 * 60 * 60 * 1000;
const publishers = new Map([
  ['Notre Dame Athletics', 'fightingirish.com'],
  ['NDNation', 'ndnation.com'],
  ['CBS Sports', 'www.cbssports.com'],
]);
const articleDate = new Intl.DateTimeFormat(undefined, {dateStyle: 'medium'});
const refreshDate = new Intl.DateTimeFormat(undefined, {dateStyle: 'medium', timeStyle: 'short'});

function validArticle(row, now) {
  if (typeof row?.title !== 'string' || !row.title.trim() || row.title.length > 300 ||
      typeof row.url !== 'string' || !publishers.has(row.source)) return false;
  const published = Date.parse(row.published_at);
  if (!Number.isFinite(published) || published > now) return false;
  try {
    const url = new URL(row.url);
    return url.origin === `https://${publishers.get(row.source)}` &&
      !url.username && !url.password && url.pathname !== '/';
  } catch {
    return false;
  }
}

function articleItem(row) {
  const item = document.createElement('li');
  const link = document.createElement('a');
  link.href = row.url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.textContent = row.title;
  const meta = document.createElement('div');
  meta.className = 'muted';
  const date = document.createElement('time');
  date.dateTime = row.published_at;
  date.textContent = articleDate.format(new Date(row.published_at));
  meta.append(row.source, ' · ', date);
  item.append(link, meta);
  return item;
}

export async function mountNews(section, isCurrent) {
  const status = section.querySelector('[role="status"]');
  const list = section.querySelector('ul');
  const toggle = section.querySelector('button');
  const unavailable = 'Notre Dame news is temporarily unavailable. Check back after the next refresh.';
  try {
    // Use the Pages project path and revalidate each visit to the Command Center.
    const response = await fetch(new URL('./data/notre-dame-news.json', import.meta.url), {cache: 'no-cache'});
    if (!response.ok) throw new Error('News snapshot unavailable');
    const snapshot = await response.json();
    if (!isCurrent()) return;
    if (!Array.isArray(snapshot?.articles)) throw new Error('Invalid news snapshot');

    const now = Date.now();
    const lastSuccess = snapshot.last_success_at ? Date.parse(snapshot.last_success_at) : NaN;
    const articles = snapshot.articles.filter(row => validArticle(row, now)).slice(0, maxArticles);
    if (!Number.isFinite(lastSuccess)) {
      status.textContent = unavailable;
      return;
    }
    const time = document.createElement('time');
    time.dateTime = snapshot.last_success_at;
    time.textContent = refreshDate.format(lastSuccess);
    status.replaceChildren('Last successful refresh · ', time);
    if (snapshot.status === 'stale' || now - lastSuccess > refreshGrace) {
      status.append(articles.length ? ' · Stale news (saved headlines)' : ' · News refresh overdue');
    } else if (snapshot.status === 'partial') {
      status.append(' · Some feeds are unavailable. Saved headlines may be shown.');
    }
    if (!articles.length) {
      status.append(snapshot.status === 'stale' ? ' · ' + unavailable : ' · No recent Notre Dame football articles found.');
      return;
    }

    const items = articles.map(articleItem);
    items.slice(shownByDefault).forEach(item => { item.hidden = true; });
    list.replaceChildren(...items);
    if (items.length > shownByDefault) {
      toggle.hidden = false;
      toggle.addEventListener('click', () => {
        const expanded = toggle.getAttribute('aria-expanded') !== 'true';
        items.slice(shownByDefault).forEach(item => { item.hidden = !expanded; });
        toggle.setAttribute('aria-expanded', String(expanded));
        toggle.textContent = expanded ? 'Show Less' : 'Show More';
      });
    }
  } catch {
    if (isCurrent()) status.textContent = unavailable;
  }
}
