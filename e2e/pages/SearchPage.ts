import { expect, type Locator, type Page } from '@playwright/test';

export class SearchPage {
  readonly from: Locator;
  readonly to: Locator;
  readonly searchButton: Locator;
  readonly searchSummary: Locator;
  readonly usageLine: Locator;
  readonly bestPrice: Locator;
  readonly routeMatrix: Locator;
  readonly bestOptions: Locator;
  readonly priceCalendar: Locator;

  constructor(readonly page: Page) {
    this.from = page.getByRole('group', { name: 'From', exact: true });
    this.to = page.getByRole('group', { name: 'To', exact: true });
    this.searchButton = page.getByRole('button', { name: 'Search flights' });
    this.searchSummary = page.getByText(/\d+ routes? × \d+ date combinations?/);
    this.usageLine = page.getByText(/^Used \d+ cached lookups and \d+ live checks\.$/);
    this.bestPrice = page.getByText('Best price found');
    this.routeMatrix = page.getByRole('table', { name: 'Cheapest price per departure and arrival airport' });
    this.bestOptions = page.getByRole('list', { name: 'Cheapest options' });
    this.priceCalendar = page.getByRole('grid', { name: 'Cheapest price by departure date and trip length' });
  }

  async goto() {
    await this.page.goto('/');
    await expect(this.searchButton).toBeVisible();
  }

  /** Airports load after the page does; the route count and search button depend on them. */
  async waitForAirports() {
    await expect(this.from.getByText(/airports selected/)).toBeVisible();
    await expect(this.to.getByText(/airports selected/)).toBeVisible();
  }

  /** Replaces whatever is in a From/To field with a single airport picked from the suggestions. */
  async pickAirport(field: Locator, code: string) {
    const remove = field.getByRole('button', { name: /^Remove / });
    while (await remove.count()) await remove.first().click();
    await field.getByRole('combobox').fill(code);
    await field.getByRole('option', { name: new RegExp(`^${code} · `) }).click();
    await expect(field.getByRole('button', { name: new RegExp(`^${code}\\b`), pressed: true })).toBeVisible();
  }

  async useSpecificDates(flexibility: 'Exact dates' | '± 1 day' | '± 2 days' | '± 3 days') {
    await this.page.getByRole('button', { name: 'Specific dates' }).click();
    await this.page.getByLabel('Flexibility').selectOption({ label: flexibility });
  }

  async searchAndWait() {
    await this.searchButton.click();
    await expect(this.usageLine).toBeVisible({ timeout: 30_000 });
  }
}
