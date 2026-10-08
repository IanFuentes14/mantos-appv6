import { cranePoint, CRANE_MODELS } from './craneCatalog.js';

export const SLING_LENGTHS = [1.2, 4, 6, 10];
export const SLING_HITCHES = [
  { id: 'axial', name: 'Axial', hint: 'Tiro directo' },
  { id: 'choker', name: 'Lazo', hint: 'Carga abrazada' },
  { id: 'basket', name: 'Canasta', hint: 'Apoyo en U' },
];
export const YAGAN_REFERENCE = {
  1.2: { axial: '2800', choker: '2240', basket: '5600' },
  4: { axial: '2900', choker: '2320', basket: '5800' },
  6: { axial: '2900', choker: '2320', basket: '5800' },
  10: { axial: '2800', choker: '2200', basket: '5600' },
};

export function yaganCapacity(length, hitch) {
  return YAGAN_REFERENCE[Number(length)]?.[hitch] ?? '';
}

function decimal(value) {
  const text = String(value ?? '').trim();
  if (!/^\d+(?:[.,]\d+)?$/.test(text)) return NaN;
  return Number(text.replace(',', '.'));
}

// The estimate assumes static, symmetrical loading. Four slings are credited
// as three; this is an application estimate, not a manufacturer's assembly rating.
export function assessLift(input) {
  const errors = {};
  const missing = [];
  function number(key, label, allowZero = false) {
    if (String(input[key] ?? '').trim() === '') { missing.push(label); return NaN; }
    const value = decimal(input[key]);
    if (!Number.isFinite(value) || (allowZero ? value < 0 : value <= 0)) errors[key] = allowZero ? 'Ingrese cero o un número positivo, sin separador de miles.' : 'Ingrese un número mayor que cero, sin separador de miles.';
    return value;
  }
  const count = Number(input.count);
  if (!Number.isInteger(count) || count < 1 || count > 4) errors.count = 'Seleccione de 1 a 4 eslingas.';
  if (!SLING_LENGTHS.includes(Number(input.length))) errors.length = 'Seleccione un largo disponible.';
  const hitch = SLING_HITCHES.find((item) => item.id === input.hitch);
  if (!hitch) errors.hitch = 'Seleccione el posicionamiento.';
  const angleNeeded = count > 1 || input.hitch === 'basket';
  const angle = angleNeeded ? number('angle', 'Ángulo de trabajo') : 90;
  if (Number.isFinite(angle) && (angle < 30 || angle > 90)) errors.angle = 'Use un ángulo entre 30° y 90° respecto de la horizontal. Otros casos requieren evaluación especializada.';
  const rated = number('ratedCapacity', 'Capacidad de la etiqueta');
  const radius = number('radius', 'Radio de trabajo');
  const manual = input.craneMode === 'manual';
  let boom = null;
  let crane;
  if (manual) {
    boom = number('boom', 'Largo de pluma');
    crane = number('craneCapacity', 'Capacidad de la tabla de la grúa');
    if (!String(input.craneModel ?? '').trim()) missing.push('Modelo de grúa');
    if (!String(input.configuration ?? '').trim()) missing.push('Configuración de la grúa');
  } else {
    const model = CRANE_MODELS.find((item) => item.id === input.craneModel);
    const point = cranePoint(input.craneModel, input.radius);
    if (!model) missing.push('Modelo de grúa');
    else if (!point) missing.push('Un alcance documentado en la tabla');
    crane = point?.capacity;
  }
  const load = number('load', 'Peso de la carga');
  const below = number('belowAccessories', 'Accesorios que soportan las eslingas', true);
  const deductions = number('craneAccessories', 'Otras deducciones de la grúa', true);
  if (Object.keys(errors).length) return { status: 'invalid', errors, missing };
  if (missing.length) return { status: 'incomplete', errors, missing };
  const effectiveCount = Math.min(count, 3);
  const angleFactor = Math.sin(angle * Math.PI / 180);
  const perSlingCapacity = rated * angleFactor;
  const slingCapacity = perSlingCapacity * effectiveCount;
  const slingLoad = load + below;
  const craneLoad = slingLoad + deductions;
  const perSlingLoad = slingLoad / effectiveCount;
  const allowablePayload = Math.max(0, Math.min(slingCapacity, crane - deductions) - below);
  const slingUse = slingLoad / slingCapacity * 100;
  const craneUse = craneLoad / crane * 100;
  if (![slingCapacity, slingLoad, craneLoad, perSlingLoad, allowablePayload, slingUse, craneUse].every(Number.isFinite) || slingCapacity <= 0) {
    return { status: 'invalid', errors: { load: 'Los valores exceden el rango de cálculo. Revise los datos.' }, missing: [] };
  }
  const slingsPass = slingLoad <= slingCapacity;
  const cranePass = craneLoad <= crane;
  return {
    status: slingsPass && cranePass ? 'within' : 'exceeded', errors, missing,
    slingsPass, cranePass, effectiveCount, angle, angleFactor, rated, boom, radius,
    perSlingCapacity, slingCapacity, slingLoad, craneLoad, perSlingLoad, allowablePayload,
    slingUse, craneUse, craneCapacity: crane,
    limiting: slingCapacity <= crane - deductions ? 'Eslingas' : 'Grúa',
  };
}
