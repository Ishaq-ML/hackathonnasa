const pageSize = 18;

export function mountCatalog({ byId, view, world, normalize, openCase, openEntry, cases }) {
  const panel = byId('browse-panel');
  const input = byId('browse-filter');
  const results = byId('browse-results');
  const pages = byId('browse-pages');
  let page = 1;
  let request = 0;
  let previousHazard;

  async function refresh() {
    const version = ++request;
    if (panel.hidden) return;
    const { hazard, minMagnitude, days, caseId } = view();
    if (hazard !== previousHazard) {
      if (previousHazard) input.value = '';
      previousHazard = hazard;
      page = 1;
    }
    try {
      await world.load(hazard);
    } catch {
      if (version === request) {
        results.replaceChildren();
        pages.replaceChildren();
        byId('browse-count').textContent = 'The catalog could not load.';
      }
      return;
    }
    if (version !== request || panel.hidden) return;
    const query = normalize(input.value.trim());
    const detailed = cases.filter(item => item.hazard === hazard &&
      normalize([item.place, item.location, ...item.aliases].join(' ')).includes(query));
    const records = world.visibleItems(hazard, minMagnitude, days).filter(item => normalize(item.name).includes(query));
    const entries = [...detailed, ...records];
    const pageCount = Math.max(1, Math.ceil(entries.length / pageSize));
    page = Math.min(page, pageCount);
    const items = entries.slice((page - 1) * pageSize, page * pageSize).map(item => {
      if (item.modes) return { id: item.id, detail: true, title: item.place, description: item.date, mark: '◎' };
      const { title, description } = world.details(hazard, item);
      return { id: item.id, title: hazard === 'Earthquakes' ? item.name : title.replace(/^Flood report · /, ''),
        mark: hazard === 'Earthquakes' ? item.magnitude.toFixed(1) : '•',
        description: hazard === 'Earthquakes' ? description.slice(item.name.length + 3) : description };
    });
    results.replaceChildren(...items.map(item => {
      const row = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset[item.detail ? 'case' : 'entry'] = item.id;
      if (item.id === caseId) button.setAttribute('aria-current', 'true');
      const badge = document.createElement('span');
      badge.className = 'row-mark';
      badge.textContent = item.mark;
      if (hazard === 'Earthquakes' && !item.detail) badge.setAttribute('aria-label', `Magnitude ${item.mark}`);
      else badge.setAttribute('aria-hidden', 'true');
      const copy = document.createElement('div');
      const title = document.createElement('strong');
      title.textContent = item.title;
      const detail = document.createElement('span');
      detail.textContent = item.description;
      copy.append(title, detail);
      button.append(badge, copy);
      row.append(button);
      return row;
    }));
    byId('browse-count').textContent = entries.length
      ? `${entries.length.toLocaleString()} results${hazard === 'Earthquakes' ? ` · M${minMagnitude.toFixed(1)}+` : ''}`
      : 'No observations match this place.';
    pages.hidden = pageCount === 1;
    pages.innerHTML = `<button type="button" class="quiet" data-step="-1"${page === 1 ? ' disabled' : ''}>Previous</button><span>${page} / ${pageCount}</span><button type="button" class="quiet" data-step="1"${page === pageCount ? ' disabled' : ''}>Next</button>`;
  }

  input.addEventListener('input', () => {
    page = 1;
    refresh();
  });
  pages.addEventListener('click', event => {
    const button = event.target.closest('[data-step]');
    if (!button) return;
    page += Number(button.dataset.step);
    results.scrollTop = 0;
    refresh();
  });
  results.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (button?.dataset.case) openCase(button.dataset.case);
    if (button?.dataset.entry) openEntry(view().hazard, button.dataset.entry).catch(() => {});
  });
  return refresh;
}
