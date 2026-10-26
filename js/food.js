// Temporary food page: the full meal planner ships in the next update.
export default {
  name: 'food',
  view() {
    return '<h1 class="page-title">Food</h1><p class="note">The meal plan, prep days and grocery lists are coming in the next update.</p>';
  },
  click() { return false; },
  change() { return false; },
};
export const todayCard = () => '';
export const mealsFor = () => ({});
export const prepFor = () => null;
export const totals = () => ({ k: 0, p: 0 });
