import { describe, expect, it } from 'vitest';
import { REALM_HOUSES } from '../../setup/houses';
import { roster } from '../../setup/rosters';
import { NAME_MAX_LENGTH } from '../../knight/look';
import {
  CLUB_IDS,
  CLUBS,
  clubLevel,
  DIVISION_TIER,
  DIVISIONS,
  divisionOf,
  startingWorld,
  type CareerKnight,
} from './clubs';

const world = startingWorld();
const knights: CareerKnight[] = Object.values(world.squads).flat();

describe('the career realm', () => {
  it('has 24 clubs, eight to each of three divisions, the eight houses in the Great Houses', () => {
    expect(CLUBS).toHaveLength(24);
    expect(new Set(CLUB_IDS).size).toBe(24);
    expect(new Set(CLUBS.map((c) => c.name)).size).toBe(24);
    expect(new Set(CLUBS.map((c) => c.colour)).size).toBe(24);
    expect(new Set(CLUBS.map((c) => c.crest)).size).toBe(24);
    expect(world.divisions.map((d) => d.length)).toEqual([8, 8, 8]);
    expect(new Set(world.divisions.flat()).size).toBe(24);
    expect([...(world.divisions[2] ?? [])].sort()).toEqual(REALM_HOUSES.map((h) => h.id).sort());
    expect(CLUBS.slice(0, 8).map((c) => c.id)).toEqual(REALM_HOUSES.map((h) => h.id));
    for (const club of CLUB_IDS)
      expect(divisionOf(world, club)).toBe(CLUBS.find((c) => c.id === club)?.startDivision);
  });

  it('keeps every house’s four roster faces, and gives every club six knights with unique names and helmets', () => {
    for (const house of REALM_HOUSES) {
      const squad = world.squads[house.id] ?? [];
      for (const look of Object.values(roster(house))) expect(squad.map((k) => k.look)).toContainEqual(look);
    }
    for (const squad of Object.values(world.squads)) {
      expect(squad).toHaveLength(6);
      expect(new Set(squad.map((k) => k.look.helmet)).size).toBe(6);
    }
    expect(new Set(knights.map((k) => k.look.name)).size).toBe(knights.length);
    expect(new Set(knights.map((k) => k.id)).size).toBe(knights.length);
    expect(knights.every((k) => k.look.name.length <= NAME_MAX_LENGTH && !k.forged)).toBe(true);
    expect(world.nextKnight).toBe(knights.length);
  });

  it('casts each division around its tier, a tier either side, so strength rises division by division', () => {
    const levels = DIVISIONS.map(
      (d) => (world.divisions[d] ?? []).reduce((s, c) => s + clubLevel(world, c), 0) / 8,
    );
    expect(levels[0]).toBeLessThan(levels[1] ?? 0);
    expect(levels[1]).toBeLessThan(levels[2] ?? 0);
    for (const d of DIVISIONS)
      for (const club of world.divisions[d] ?? [])
        for (const k of world.squads[club] ?? [])
          expect(Math.abs(k.tier - DIVISION_TIER[d])).toBeLessThanOrEqual(1);
    expect(knights.every((k) => k.age >= 18 && k.age <= 32)).toBe(true);
  });

  // Golden: any change to the cast (seed, order, names, tiers, ages) shows here. New clubs go at the end.
  it('casts the same faces, tiers and ages on every machine', () => {
    expect(startingWorld()).toBe(world);
    const line = (club: string) =>
      (world.squads[club] ?? []).map((k) => `${k.look.name}/${k.tier}/${k.age}/${k.look.helmet}`).join(',');
    expect(line('ashby')).toMatchInlineSnapshot(
      `"Ros Reed/2/25/5,Pru Ward/1/20/3,Noll Dale/3/27/2,Nan Yew/2/29/8,Cis Dale/1/23/7,Ida Dyke/3/18/0"`,
    );
    expect(line('wattle')).toMatchInlineSnapshot(
      `"Jack Dale/2/20/0,Ser Lot Stone/0/21/1,Ser Hal Holt/1/22/6,Jack Yew/1/32/7,Ser Ned Hale/1/31/5,Tess Wren/1/24/4"`,
    );
    expect(line('ember')).toMatchInlineSnapshot(
      `"Ser Osric/4/27/0,Gunnhild/3/25/6,Ser Baldric/2/22/1,Mab the Quick/4/20/3,Ser Lot Cobb/4/25/7,Bea Bell/2/26/9"`,
    );
  });
});
