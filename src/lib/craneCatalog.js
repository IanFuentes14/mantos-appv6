const f660Source = 'https://www.fassi.com/wp-content/uploads/gru/3924/F660RA-he-dynamic-99-ce-kg-m.pdf';
const f365Source = 'https://www.fassi.com/phocadownload/cranes/CE_kg_m/F365A%20e-dynamic%20-%20F365RA%20e-dynamic.pdf';
const palfingerSource = 'https://www.palfinger.com/apac/en/our-products/cranes/loader-cranes/models/pk-32080.html';
const existingImages = [
  new URL('../../Captura de pantalla 2026-07-23 153510.png', import.meta.url).href,
  new URL('../../Captura de pantalla 2026-07-23 153610.png', import.meta.url).href,
  new URL('../../Captura de pantalla 2026-07-23 153703.png', import.meta.url).href,
  new URL('../../Captura de pantalla 2026-07-23 153731.png', import.meta.url).href,
];
function model(id, brand, series, label, points, source, condition, image) {
  return { id, brand, series, label, points: points.map(([radius, capacity]) => ({ radius, capacity })), source, condition, image };
}

// Discrete documented hydraulic reach points only. Manual extensions, jib,
// interpolated radii and other boom angles are intentionally not inferred.
export const CRANE_MODELS = [
  model('f365a-22', 'Fassi', 'F365A.2', 'F365A.2.22', [[2.7,11500],[3.35,9500],[4.35,7840],[6.2,5490],[8.15,4170],[10.25,3200],[12.35,2550]], f365Source, 'Tabla Fassi F365A e-dynamic .22. Alcances hidráulicos publicados; sin jib ni prolongas manuales.'),
  model('f365a-23', 'Fassi', 'F365A.2', 'F365A.2.23', [[2.5,11500],[3.3,9500],[4.4,7600],[6.25,5300],[8.2,4005],[10.2,3215],[12.3,2550],[14.6,2000],[16.9,1600]], f365Source, 'Tabla Fassi F365A e-dynamic .23. Alcances hidráulicos publicados; sin jib ni prolongas manuales.'),
  model('f365a-24', 'Fassi', 'F365A.2', 'F365A.2.24', [[2.45,11500],[3.2,9500],[4.5,7300],[6.35,5045],[8.3,3765],[10.3,2980],[12.25,2480],[14.55,1900],[16.85,1500],[19.3,1200]], f365Source, 'Tabla Fassi F365A e-dynamic .24. Alcances hidráulicos publicados; sin jib ni prolongas manuales.'),
  model('f365a-25', 'Fassi', 'F365A.2', 'F365A.2.25', [[2.4,11500],[3.15,9500],[4.6,7040],[6.45,4830],[8.4,3560],[10.4,2785],[12.4,2285],[14.6,1865],[16.9,1450],[19.2,1200],[21.4,950]], f365Source, 'Tabla Fassi F365A e-dynamic .25. Alcances hidráulicos publicados; sin jib ni prolongas manuales.'),
  model('f365a-26', 'Fassi', 'F365A.2', 'F365A.2.26', [[2.35,11500],[3.05,9500],[4.65,6800],[6.5,4635],[8.45,3385],[10.45,2615],[12.45,2120],[14.65,1700],[16.7,1440],[19.1,1100],[21.55,900],[24,670]], f365Source, 'Tabla Fassi F365A e-dynamic .26. Alcances hidráulicos publicados; sin jib ni prolongas manuales.'),
  model('f365a-27', 'Fassi', 'F365A.2', 'F365A.2.27', [[2.3,11500],[3.05,9400],[4.75,6545],[6.6,4440],[8.55,3215],[10.55,2460],[12.55,1970],[14.75,1555],[16.95,1280],[18.85,1120],[21.3,940],[23.75,670]], f365Source, 'Tabla Fassi F365A e-dynamic .27. Alcances hidráulicos publicados; sin jib ni prolongas manuales.'),
  model('f365a-28', 'Fassi', 'F365A.2', 'F365A.2.28', [[2.25,11500],[3.05,9250],[4.75,6445],[6.6,4340],[8.55,3110],[10.55,2285],[12.55,1800],[14.75,1440],[16.95,1165],[18.9,1005],[20.9,885],[22.9,650],[24.9,300]], f365Source, 'Tabla Fassi F365A e-dynamic .28. Alcances hidráulicos publicados; sin jib ni prolongas manuales.'),
  model('f660-25', 'Fassi', 'F660RA', 'F660RA.2.25', [[3.5,16000],[4.2,13520],[5.85,9650],[7.65,7295],[9.55,5740],[11.65,4660],[13.8,3925]], f660Source, 'Diagrama existente a 10°. Pluma principal, extensiones hidráulicas; sin jib ni prolongas manuales.', existingImages[0]),
  model('f660-26', 'Fassi', 'F660RA', 'F660RA.2.26', [[3.4,16000],[4.3,13095],[5.95,9300],[7.7,6980],[9.65,5440],[11.7,4375],[13.85,3640],[16.1,3100]], f660Source, 'Diagrama existente a 10°. Pluma principal, extensiones hidráulicas; sin jib ni prolongas manuales.', existingImages[1]),
  model('f660-27', 'Fassi', 'F660RA', 'F660RA.2.27', [[3.35,16000],[4.45,12565],[6.1,8935],[7.85,6680],[9.75,5180],[11.85,4135],[14,3400],[16.25,2875],[18.25,2500]], f660Source, 'Diagrama existente a 10°. Pluma principal, extensiones hidráulicas; sin jib ni prolongas manuales.', existingImages[2]),
  model('f660-28', 'Fassi', 'F660RA', 'F660RA.2.28', [[3.3,16000],[4.5,12300],[6.15,8715],[7.9,6485],[9.8,5000],[11.9,3955],[14.05,3230],[16.3,2700],[18.3,2330],[20.3,2055]], f660Source, 'Diagrama existente a 10°. Pluma principal, extensiones hidráulicas; sin jib ni prolongas manuales.', existingImages[3]),
  model('pk32080-a', 'Palfinger', 'PK 32080', 'PK 32080 A', [[3.5,8500],[4.2,7200],[6,5010],[7.9,3840]], palfingerSource, 'Alcances publicados con pluma a 20°. Versión A, sin jib ni extensiones mecánicas.'),
  model('pk32080-b', 'Palfinger', 'PK 32080', 'PK 32080 B', [[3.6,8300],[4.3,6920],[6.1,4780],[8,3630],[9.9,2900]], palfingerSource, 'Alcances publicados con pluma a 20°. Versión B, sin jib ni extensiones mecánicas.'),
];

export function cranePoint(modelId, radius) {
  const crane = CRANE_MODELS.find((item) => item.id === modelId);
  return crane?.points.find((point) => point.radius === Number(String(radius).replace(',', '.'))) || null;
}
