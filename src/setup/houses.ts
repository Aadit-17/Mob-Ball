export interface House {
  readonly id: string;
  readonly name: string;
  readonly colour: string;
}

/** The four great houses: the player's choice of house, and the banners that hang in the hall. */
export const HOUSES: readonly House[] = [
  { id: 'ember', name: 'Emberlyn', colour: '#e8453c' },
  { id: 'corvane', name: 'Corvane', colour: '#3d3d6b' },
  { id: 'thorn', name: 'Thornwick', colour: '#3f9a4a' },
  { id: 'grey', name: 'Greystone', colour: '#3f8fd8' },
];

/** Every house in the realm: the great four, then the lesser houses who enter the Realm Cup. */
export const REALM_HOUSES: readonly House[] = [
  ...HOUSES,
  { id: 'mud', name: 'Mudford', colour: '#a8743a' },
  { id: 'hollow', name: 'Hollowmere', colour: '#9a5fd0' },
  { id: 'ox', name: 'Oxbridge', colour: '#d4508e' },
  { id: 'salt', name: 'Saltcliff', colour: '#1f9e99' },
];

export function houseById(id: string): House {
  const house = REALM_HOUSES.find((h) => h.id === id) ?? HOUSES[0];
  if (!house) throw new Error('No houses defined');
  return house;
}
