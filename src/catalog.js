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
    const { hazard, minMagnitude } = view();
    if (hazard !== previousHazard) {
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
    const records = world.visibleItems(hazard, minMagnitude).filter(item => normalize(item.name).includes(query));
    const items = [
      ...detailed.map(item => ({ id: item.id, detail: true, title: item.place, description: item.date })),
      ...records.map(item => {
        const { title, description } = world.details(hazard, item);
        return { id: item.id, title: hazard === 'Earthquakes' ? item.name : title,
          description: hazard === 'Earthquakes' ? title + ' · ' + description.slice(item.name.length + 3) : description };
      }),
    ];
    const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
    page = Math.min(page, pageCount);
    results.replaceChildren(...items.slice((page - 1) * pageSize, page * pageSize).map(item => {
      const row = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset[item.detail ? 'case' : 'entry'] = item.id;
      const title = document.createElement('strong');
      title.textContent = item.title;
      const detail = document.createElement('span');
      detail.textContent = item.description;
      button.append(title, detail);
      row.append(button);
      return row;
    }));
    byId('browse-count').textContent = items.length
      ? `${items.length.toLocaleString()} results${hazard === 'Earthquakes' ? ` · M${minMagnitude.toFixed(1)}+` : ''}`
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
    if (button?.dataset.entry) openEntry(view().hazard, button.dataset.entry);
  });
  return refresh;
}
