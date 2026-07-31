import { discoveryDemoFixtures, discoveryDemoId } from '../../scripts/seed-discovery-demo';

describe('Discovery demo seed fixtures', () => {
  it('provides distinct eligible-looking Photographer inputs', () => {
    expect(discoveryDemoFixtures).toHaveLength(8);
    expect(new Set(discoveryDemoFixtures.map((fixture) => fixture.displayName)).size).toBe(
      discoveryDemoFixtures.length,
    );
    for (const fixture of discoveryDemoFixtures) {
      expect(fixture.serviceCodes.length).toBeGreaterThanOrEqual(1);
      expect(fixture.minPrice).toBeLessThanOrEqual(fixture.maxPrice);
      expect(fixture.latitude).toBeGreaterThanOrEqual(-90);
      expect(fixture.latitude).toBeLessThanOrEqual(90);
      expect(fixture.longitude).toBeGreaterThanOrEqual(-180);
      expect(fixture.longitude).toBeLessThanOrEqual(180);
    }
  });

  it('generates stable, separated UUID namespaces', () => {
    const userId = discoveryDemoId('user', 1);
    const photographerRoleId = discoveryDemoId('photographerRole', 1);
    expect(userId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9]{12}$/);
    expect(photographerRoleId).not.toBe(userId);
    expect(discoveryDemoId('user', 1)).toBe(userId);
  });
});
