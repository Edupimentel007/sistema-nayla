import { z } from 'zod';

// The final category is intentionally open ended: owners can name their own
// non-surgical beauty services without exposing unrelated catalog templates.
export const specialtyValues = [
  'unhas', 'sobrancelhas', 'cilios', 'cabelos', 'terapia_capilar',
  'maquiagem', 'depilacao', 'estetica_facial', 'estetica_corporal',
  'massagens', 'micropigmentacao', 'bronzeamento', 'podologia', 'outros',
] as const;
export const specialtySchema = z.enum(specialtyValues);
export type Specialty = z.infer<typeof specialtySchema>;

type Template = { id: string; name: string; durationMinutes: number; price: number; category: Specialty };
const serviceSlug = (name: string) => name.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const make = (category: Specialty, items: [string, number, number][]): Template[] =>
  items.map(([name, durationMinutes, price]) => ({
    id: `${category}:${serviceSlug(name)}`, name, durationMinutes, price, category,
  }));

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
  ...make('cabelos', [
    ['Corte feminino', 60, 90],
    ['Escova', 60, 65],
    ['Penteado', 90, 160],
    ['Coloração', 150, 220],
    ['Retoque de raiz', 120, 140],
    ['Mechas', 240, 400],
    ['Progressiva', 210, 350],
  ]),
  ...make('terapia_capilar', [
    ['Avaliação capilar', 45, 70],
    ['Hidratação capilar', 90, 110],
    ['Nutrição capilar', 90, 120],
    ['Reconstrução capilar', 90, 130],
    ['Spa capilar', 90, 150],
  ]),
  ...make('maquiagem', [
    ['Maquiagem social', 90, 180],
    ['Maquiagem para evento', 120, 230],
    ['Maquiagem de noiva', 180, 450],
    ['Maquiagem expressa', 45, 100],
    ['Aula de automaquiagem', 120, 240],
  ]),
  ...make('depilacao', [
    ['Depilação de buço', 20, 25],
    ['Depilação de axilas', 30, 35],
    ['Depilação de pernas', 60, 90],
    ['Depilação de virilha', 45, 80],
    ['Depilação facial com linha', 45, 70],
  ]),
  ...make('estetica_facial', [
    ['Limpeza de pele', 90, 150],
    ['Hidratação facial', 60, 110],
    ['Esfoliação facial', 45, 80],
    ['Máscara facial', 45, 75],
    ['Massagem facial', 45, 95],
  ]),
  ...make('estetica_corporal', [
    ['Esfoliação corporal', 60, 130],
    ['Hidratação corporal', 60, 130],
    ['Drenagem linfática manual', 60, 150],
    ['Massagem modeladora', 60, 150],
  ]),
  ...make('massagens', [
    ['Massagem relaxante', 60, 140],
    ['Massagem com pedras quentes', 75, 180],
    ['Massagem de costas', 30, 80],
    ['Spa dos pés', 60, 100],
  ]),
  ...make('micropigmentacao', [
    ['Micropigmentação de sobrancelhas', 180, 450],
    ['Micropigmentação labial', 180, 500],
    ['Micropigmentação dos olhos', 180, 480],
    ['Retoque de micropigmentação', 120, 220],
  ]),
  ...make('bronzeamento', [
    ['Bronzeamento a jato', 60, 130],
    ['Aplicação de autobronzeador', 60, 110],
    ['Esfoliação pré-bronzeamento', 45, 75],
  ]),
  ...make('podologia', [
    ['Cuidados básicos dos pés', 60, 110],
    ['Corte técnico de unhas dos pés', 45, 85],
    ['Hidratação dos pés', 45, 70],
  ]),
];
