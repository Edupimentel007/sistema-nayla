export type Specialty = 'unhas' | 'sobrancelhas' | 'cilios';

type Template = { name: string; durationMinutes: number; price: number; category: Specialty };
const make = (category: Specialty, items: [string, number, number][]): Template[] =>
  items.map(([name, durationMinutes, price]) => ({ name, durationMinutes, price, category }));

export const catalog: Template[] = [
  ...make('unhas', [
    ['Manicure tradicional', 45, 35],
    ['Pedicure tradicional', 60, 45],
    ['Mão e pé', 90, 75],
    ['Esmaltação em gel', 60, 75],
    ['Alongamento em gel', 150, 180],
    ['Alongamento em fibra de vidro', 180, 220],
    ['Alongamento em acrílico', 150, 190],
    ['Manutenção de alongamento', 120, 120],
    ['Banho de gel', 90, 100],
    ['Blindagem de unhas', 75, 90],
    ['Nail art', 45, 45],
    ['Spa dos pés', 75, 95],
    ['Remoção de alongamento', 60, 60],
  ]),
  ...make('sobrancelhas', [
    ['Design de sobrancelhas', 45, 45],
    ['Design com henna', 60, 65],
    ['Coloração de sobrancelhas', 45, 50],
    ['Brow lamination', 75, 120],
    ['Micropigmentação', 180, 450],
    ['Retoque de micropigmentação', 120, 220],
    ['Depilação facial', 45, 55],
  ]),
  ...make('cilios', [
    ['Extensão de cílios clássica', 150, 180],
    ['Extensão de cílios volume brasileiro', 180, 220],
    ['Extensão de cílios volume russo', 180, 250],
    ['Extensão de cílios híbrida', 180, 230],
    ['Manutenção de cílios', 120, 120],
    ['Lash lifting', 90, 140],
    ['Coloração de cílios', 45, 60],
    ['Remoção de extensão de cílios', 45, 55],
  ]),
];
