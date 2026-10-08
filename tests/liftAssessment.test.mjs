import test from 'node:test';
import assert from 'node:assert/strict';
import { assessLift, SLING_LENGTHS } from '../src/lib/liftAssessment.js';
import { CRANE_MODELS, cranePoint } from '../src/lib/craneCatalog.js';

const base = { length: 4, count: 1, hitch: 'axial', ratedCapacity: '2900', angle: '90', labelVerified: true, balanced: true, chokeVerified: true, craneMode: 'manual', craneModel: 'Grúa de prueba', configuration: 'Tabla verificada', boom: '10', radius: '8', craneCapacity: '6000', chartVerified: true, load: '2500', belowAccessories: '0', craneAccessories: '0' };
const calculate = (changes = {}) => assessLift({ ...base, ...changes });
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);

test('both systems must pass; limiting capacity includes accessory weights', () => {
  assert.equal(calculate().status, 'within');
  const slingFail = calculate({ load: '3000' });
  assert.equal(slingFail.status, 'exceeded');
  assert.equal(slingFail.slingsPass, false);
  assert.equal(slingFail.cranePass, true);
  const craneFail = calculate({ craneCapacity: '2400' });
  assert.equal(craneFail.status, 'exceeded');
  assert.equal(craneFail.slingsPass, true);
  assert.equal(craneFail.cranePass, false);
  const accessories = calculate({ count: 2, belowAccessories: '100', craneAccessories: '600', craneCapacity: '3000' });
  assert.equal(accessories.slingLoad, 2600);
  assert.equal(accessories.craneLoad, 3200);
  assert.equal(accessories.allowablePayload, 2300);
  assert.equal(accessories.limiting, 'Grúa');
});

test('angular derating, four-sling conservative credit and hitch-specific label rating', () => {
  near(calculate({ count: 2, angle: '30' }).slingCapacity, 2900);
  near(calculate({ count: 2, angle: '60' }).slingCapacity, 5800 * Math.sqrt(3) / 2);
  const four = calculate({ count: 4 });
  assert.equal(four.effectiveCount, 3);
  assert.equal(four.slingCapacity, 8700);
  assert.equal(calculate({ hitch: 'choker', ratedCapacity: '2320' }).status, 'exceeded');
  assert.equal(calculate({ hitch: 'basket', ratedCapacity: '5800', angle: '90' }).slingCapacity, 5800);
  near(calculate({ hitch: 'basket', ratedCapacity: '5800', angle: '30' }).slingCapacity, 2900);
  for (const length of SLING_LENGTHS) assert.equal(calculate({ length }).slingCapacity, 2900);
});

test('missing evidence, unknown angle and unsupported chart point cannot return within', () => {
  for (const changes of [{ labelVerified: false }, { chartVerified: false }, { count: 2, balanced: false }, { hitch: 'choker', chokeVerified: false }, { count: 2, angle: '' }, { load: '' }, { craneMode: 'catalog', craneModel: 'f660-25', radius: '8' }]) {
    assert.equal(calculate(changes).status, 'incomplete');
  }
  for (const angle of ['0', '29.9', '91', '-45']) assert.equal(calculate({ count: 2, angle }).status, 'invalid');
});

test('catalog lookup uses exact documented point and ignores a fabricated manual capacity', () => {
  const result = calculate({ craneMode: 'catalog', craneModel: 'f660-25', radius: '13,8', craneCapacity: '999999' });
  assert.equal(result.craneCapacity, 3925);
  assert.equal(result.status, 'within');
  assert.equal(cranePoint('f660-25', 13.81), null);
  assert.equal(cranePoint('missing', 13.8), null);
  assert.equal(cranePoint('pk32080-a', 7.9).capacity, 3840);
  assert.equal(cranePoint('f545-25', 14.2).capacity, 3080);
  assert.equal(CRANE_MODELS.length, 10);
});

test('decimal comma works; invalid values and overflow fail closed', () => {
  assert.equal(calculate({ load: '2500,5' }).slingLoad, 2500.5);
  for (const load of ['0', '-1', 'Infinity', '1e9', '2.500', '2500kg']) {
    // Dot is a decimal separator; 2.500 means 2.5 kg, never 2500 kg.
    if (load === '2.500') { assert.equal(calculate({ load }).slingLoad, 2.5); continue; }
    assert.equal(calculate({ load }).status, 'invalid');
  }
  assert.equal(calculate({ count: 5 }).status, 'invalid');
  assert.equal(calculate({ belowAccessories: '-1' }).status, 'invalid');
  assert.equal(calculate({ load: '9'.repeat(400) }).status, 'invalid');
  assert.equal(calculate({ ratedCapacity: '9'.repeat(308), count: 4 }).status, 'invalid');
  assert.equal(calculate({ load: '2900' }).status, 'within');
});
