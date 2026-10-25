const routes = {};
export const addRoute = (name, fn) => { routes[name] = fn; };
export function startRouter(main, tabs) {
  const go = () => {
    const name = location.hash.slice(2) || 'today';
    const fn = routes[name] || routes.today;
    tabs.forEach(a => a.toggleAttribute('aria-current', a.dataset.tab === (routes[name] ? name : 'today')));
    main.innerHTML = fn();
  };
  addEventListener('hashchange', go);
  go();
  return go;
}
