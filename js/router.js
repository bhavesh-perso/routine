// Hash router: #/name/arg/more → { name, arg: 'arg/more' }.
export function parseHash(hash) {
  const parts = String(hash || '').replace(/^#\/?/, '').split('/').filter(Boolean);
  return { name: parts[0] || 'today', arg: parts.slice(1).join('/') };
}
export function startRouter(render) {
  let last = '';
  const go = () => {
    const r = parseHash(location.hash);
    const changed = r.name + '/' + r.arg !== last;
    last = r.name + '/' + r.arg;
    render(r, changed);
  };
  addEventListener('hashchange', go);
  go();
}
