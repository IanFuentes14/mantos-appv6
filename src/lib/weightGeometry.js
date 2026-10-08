export const LIFTING_MATERIALS = [
  { name: 'PVC', density: 1400 },
  { name: 'HDPE', density: 950 },
  { name: 'Hormigon', density: 2400 },
  { name: 'Cobre', density: 8960 },
  { name: 'Acero carbono', density: 7850 },
  { name: 'Acero inox', density: 8000 },
  { name: 'Hierro', density: 7860 },
  { name: 'Plomo', density: 11340 },
];

export const UNIT_FACTORS = { cm: 0.01, m: 1, in: 0.0254 };
export const WEIGHT_SHAPES = [
  { id: 'cuboid', name: 'Cuboide', hint: 'Bloque rectangular', fields: [['length', 'Largo'], ['width', 'Ancho'], ['height', 'Alto']], formula: 'V = largo × ancho × alto' },
  { id: 'cube', name: 'Cubo', hint: 'Lados iguales', fields: [['side', 'Lado']], formula: 'V = lado³' },
  { id: 'cylinder', name: 'Cilindro', hint: 'Macizo o tubo hueco', fields: [['diameter', 'Diámetro exterior'], ['height', 'Longitud']], formula: 'V = π × (diámetro / 2)² × longitud' },
  { id: 'sphere', name: 'Esfera', hint: 'Cuerpo esférico', fields: [['diameter', 'Diámetro']], formula: 'V = (4 / 3) × π × (diámetro / 2)³' },
  { id: 'cone', name: 'Cono', hint: 'Base circular', fields: [['diameter', 'Diámetro de base'], ['height', 'Altura perpendicular']], formula: 'V = π × (diámetro / 2)² × altura / 3' },
  { id: 'pyramid', name: 'Pirámide', hint: 'Base rectangular', fields: [['length', 'Largo de base'], ['width', 'Ancho de base'], ['height', 'Altura perpendicular']], formula: 'V = largo de base × ancho de base × altura / 3' },
];

export function parseDimension(value) {
  if (String(value ?? '').trim() === '') return NaN;
  return Number(String(value).trim().replace(',', '.'));
}

export function convertDimension(value, from, to) {
  if (String(value ?? '').trim() === '') return '';
  const number = parseDimension(value);
  if (!Number.isFinite(number)) return value;
  return String(Number((number * UNIT_FACTORS[from] / UNIT_FACTORS[to]).toPrecision(12)));
}

export function calculateWeightGeometry(shapeId, values, unit, density, hollow = false) {
  const shape = WEIGHT_SHAPES.find((item) => item.id === shapeId);
  if (!shape || !UNIT_FACTORS[unit] || !Number.isFinite(density) || density <= 0) return { status: 'invalid', errors: {}, message: 'Revise la forma, unidad y material.' };
  const fields = hollow && shapeId === 'cylinder' ? [...shape.fields, ['thickness', 'Espesor de pared']] : shape.fields;
  const dimensions = {};
  const errors = {};
  let missing = false;
  for (const [key] of fields) {
    if (String(values[key] ?? '').trim() === '') { missing = true; continue; }
    const value = parseDimension(values[key]);
    if (!Number.isFinite(value) || value <= 0) errors[key] = 'Ingrese un número mayor que cero.';
    else dimensions[key] = value * UNIT_FACTORS[unit];
  }
  if (hollow && dimensions.thickness && dimensions.diameter && dimensions.thickness >= dimensions.diameter / 2) errors.thickness = 'El espesor debe ser menor que la mitad del diámetro exterior.';
  if (Object.keys(errors).length) return { status: 'invalid', errors };
  if (missing) return { status: 'incomplete', errors };
  const { length, width, height, side, diameter, thickness } = dimensions;
  let volume;
  switch (shapeId) {
    case 'cuboid': volume = length * width * height; break;
    case 'cube': volume = side ** 3; break;
    case 'cylinder': volume = hollow ? Math.PI * height * thickness * (diameter - thickness) : Math.PI * (diameter / 2) ** 2 * height; break;
    case 'sphere': volume = 4 / 3 * Math.PI * (diameter / 2) ** 3; break;
    case 'cone': volume = Math.PI * (diameter / 2) ** 2 * height / 3; break;
    case 'pyramid': volume = length * width * height / 3; break;
  }
  const weight = volume * density;
  if (![volume, weight].every((number) => Number.isFinite(number) && number > 0)) return { status: 'invalid', errors: {}, message: 'Las dimensiones exceden el rango de cálculo. Revise los valores.' };
  return { status: 'ready', errors, volume, weight };
}
