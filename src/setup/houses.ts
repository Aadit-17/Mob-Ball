export interface House {
  readonly id: string;
  readonly name: string;
  readonly colour: string;
}

export const HOUSES: readonly House[] = [
  { id: 'ember', name: 'Emberlyn', colour: '#e8453c' },
  { id: 'corvane', name: 'Corvane', colour: '#3d3d6b' },
  { id: 'thorn', name: 'Thornwick', colour: '#3f9a4a' },
  { id: 'grey', name: 'Greystone', colour: '#3f8fd8' },
];

export function houseById(id: string): House {
  const house = HOUSES.find((h) => h.id === id) ?? HOUSES[0];
  if (!house) throw new Error('No houses defined');
  return house;
}
