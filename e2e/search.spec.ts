import { expect, test } from '@playwright/test';
import { SearchPage } from './pages/SearchPage';

let search: SearchPage;

test.beforeEach(async ({ page }) => {
  search = new SearchPage(page);
  await search.goto();
});

test('shows the demo mode notice when no API keys are set', async ({ page }) => {
  await expect(page.getByText('Demo mode:')).toBeVisible();
  await expect(page.getByText(/Cached prices: demo · Live prices: demo/)).toBeVisible();
});

test('the default Tilburg to Colombia search finds prices', async () => {
  await search.waitForAirports();
  await expect(search.from.getByText('Near Tilburg')).toBeVisible();
  await expect(search.to.getByText('Colombia')).toBeVisible();

  await search.searchAndWait();

  await expect(search.bestPrice).toBeVisible();
  await expect(search.routeMatrix).toBeVisible();
  await expect(search.bestOptions.getByRole('listitem')).not.toHaveCount(0);
  await expect(search.usageLine).toContainText('and 25 live checks');
});

test('searches one route on specific dates and drills into the price calendar', async ({ page }) => {
  await search.pickAirport(search.from, 'AMS');
  await search.pickAirport(search.to, 'BOG');
  await search.useSpecificDates('± 3 days');
  await expect(search.searchSummary).toHaveText('1 route × 49 date combinations · up to 25 live checks');

  await search.searchAndWait();

  await expect(search.routeMatrix.getByRole('rowheader', { name: 'AMS' })).toBeVisible();
  await expect(search.routeMatrix.getByRole('columnheader', { name: 'BOG' })).toBeVisible();

  // Any priced cell will do: all of them open the same per-dates view.
  await search.priceCalendar.getByRole('gridcell', { name: /^€/ }).first().click();
  await expect(page.getByRole('heading', { name: /^All airports for / })).toBeVisible();
  await expect(page.getByRole('list', { name: 'All routes for the selected dates' }).getByRole('listitem')).toHaveCount(
    1,
  );
});

test('swapping From and To is remembered after a reload', async ({ page }) => {
  await page.getByRole('button', { name: 'Swap from and to' }).click();
  await expect(search.from.getByText('Colombia')).toBeVisible();
  await expect(search.to.getByText('Near Tilburg')).toBeVisible();

  await page.reload();

  await expect(search.from.getByText('Colombia')).toBeVisible();
  await expect(search.to.getByText('Near Tilburg')).toBeVisible();
});

test('turning off every departure airport disables the search', async () => {
  await search.waitForAirports();
  const selected = search.from.getByRole('button', { pressed: true });
  while (await selected.count()) await selected.first().click();
  await expect(search.from.getByText(/airports selected/)).toHaveText(/^0 of \d+ airports selected/);

  await expect(search.searchSummary).toHaveText(/^0 routes × /);
  await expect(search.searchButton).toBeDisabled();
});

test('shows the server error when a search is rejected', async ({ page }) => {
  await page.route('**/api/search', (route) =>
    route.fulfill({ status: 400, json: { error: 'liveBudget: Too big: expected number to be <=150' } }),
  );

  await search.searchButton.click();

  await expect(page.getByText('liveBudget: Too big: expected number to be <=150')).toBeVisible();
});

test('explains when the server cannot be reached', async ({ page }) => {
  await page.route('**/api/config', (route) => route.abort('connectionrefused'));

  await page.reload();

  await expect(page.getByText(/^Cannot reach the server:/)).toBeVisible();
  await expect(search.searchButton).toBeHidden();
});
